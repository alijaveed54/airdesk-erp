import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import { getSession } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import {
  loadSupplierWhatsAppContexts,
  sendSupplierWhatsAppNotification,
  supplierOwnedBy,
  type SupplierWhatsAppContext,
  type SupplierWhatsAppResult,
} from "@/lib/supplier-whatsapp";

type SupplierUpdateRecord = {
  lineId: string;
  baseId: string;
  tableName: string;
};

const ALLOWED_SUPPLIER_TABLES = new Set([
  "app2hjpuQoeEL1Rn2|BS Order Entry",
  "appiz6tozkQO2TQXt|FAB Order Entry",
]);

type SoldOutFieldConfig = {
  fieldName: string;
  value: string;
};

const SOLD_OUT_FIELD_BY_TABLE = new Map<string, SoldOutFieldConfig>([
  ["BS Order Entry", { fieldName: "Sold Out", value: "Yes" }],
  ["FAB Order Entry", { fieldName: "Sold out", value: "Sold out" }],
]);

function getSoldOutFieldUpdate(
  tableName: string,
  action: "dispatch" | "stock_out",
): Record<string, string> {
  if (action !== "stock_out") return {};
  const config = SOLD_OUT_FIELD_BY_TABLE.get(tableName);
  return config ? { [config.fieldName]: config.value } : {};
}

function getTodayBillNo() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}${month}${year}`;
}

function supplierCodeForSession(session: any, airtable: any, baseId: string) {
  return String(
    session?.permissions?.find((permission: any) => permission?.baseId === baseId)
      ?.supplierCode ||
      airtable?.supplierCode ||
      "",
  ).trim();
}

async function sendNotificationBatch(
  action: "dispatch" | "stock_out",
  contexts: SupplierWhatsAppContext[],
) {
  const results: SupplierWhatsAppResult[] = [];

  for (let index = 0; index < contexts.length; index += 3) {
    const chunk = contexts.slice(index, index + 3);
    const chunkResults = await Promise.all(
      chunk.map(async (context) => {
        try {
          return await sendSupplierWhatsAppNotification(action, context);
        } catch (error) {
          return {
            success: false,
            action,
            targetGroup: "",
            message:
              error instanceof Error
                ? error.message
                : "WhatsApp notification failed",
          } satisfies SupplierWhatsAppResult;
        }
      }),
    );
    results.push(...chunkResults);
  }

  return results;
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    const airtable = await getCurrentAirtableBase();
    if (!airtable.canReceive && !airtable.canDispatch && !airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to update supplier pending",
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { records, action, manualBillNo } = body as {
      records: SupplierUpdateRecord[];
      action: "dispatch" | "stock_out";
      manualBillNo?: string;
    };

    if (action !== "dispatch" && action !== "stock_out") {
      return NextResponse.json(
        { success: false, message: "Invalid supplier update action" },
        { status: 400 },
      );
    }
    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { success: false, message: "No records selected." },
        { status: 400 },
      );
    }

    for (const record of records) {
      if (!record.lineId || !record.baseId || !record.tableName) {
        return NextResponse.json(
          {
            success: false,
            message: "One or more selected records have missing source details.",
          },
          { status: 400 },
        );
      }
      if (!ALLOWED_SUPPLIER_TABLES.has(`${record.baseId}|${record.tableName}`)) {
        return NextResponse.json(
          {
            success: false,
            message: "One or more selected records have an invalid source.",
          },
          { status: 403 },
        );
      }
    }

    const requestedManualBillNo = String(manualBillNo || "").trim();
    if (requestedManualBillNo.length > 100) {
      return NextResponse.json(
        { success: false, message: "Manual Bill Number is too long." },
        { status: 400 },
      );
    }

    const currentRole = String(session.role || "").trim().toLowerCase();
    if (
      action === "dispatch" &&
      requestedManualBillNo &&
      currentRole === "supplier"
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Supplier users cannot customize Bill Number.",
        },
        { status: 403 },
      );
    }

    const billNo =
      action === "stock_out"
        ? "STOCK OUT"
        : requestedManualBillNo || getTodayBillNo();
    const supplierActivity =
      action === "stock_out" ? "Sold Out" : "Dispatched";
    const activityDateTime = new Date().toISOString();

    const groupedRecords = new Map<string, SupplierUpdateRecord[]>();
    for (const record of records) {
      const key = `${record.baseId}|${record.tableName}`;
      const group = groupedRecords.get(key) || [];
      group.push(record);
      groupedRecords.set(key, group);
    }

    const contextsByRecordId = new Map<string, SupplierWhatsAppContext>();
    const contextFailures = new Map<string, string>();

    for (const [groupKey, group] of groupedRecords.entries()) {
      const separatorIndex = groupKey.indexOf("|");
      const baseId = groupKey.slice(0, separatorIndex);
      const tableName = groupKey.slice(separatorIndex + 1);

      try {
        const contexts = await loadSupplierWhatsAppContexts({
          baseId,
          tableName,
          recordIds: group.map((record) => record.lineId),
          token: airtable.token,
        });
        for (const record of group) {
          const context = contexts.get(record.lineId);
          if (context) contextsByRecordId.set(record.lineId, context);
          else contextFailures.set(record.lineId, "Supplier record was not found");
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to prepare WhatsApp notification";
        for (const record of group) contextFailures.set(record.lineId, message);
      }

      if (currentRole === "supplier") {
        const supplierCode = supplierCodeForSession(session, airtable, baseId);
        if (!supplierCode) {
          return NextResponse.json(
            { success: false, message: "Supplier code is missing in permission" },
            { status: 403 },
          );
        }
        for (const record of group) {
          const context = contextsByRecordId.get(record.lineId);
          if (!context || !supplierOwnedBy(context, supplierCode)) {
            return NextResponse.json(
              {
                success: false,
                message: "You can update only your own supplier order lines",
              },
              { status: 403 },
            );
          }
        }
      }
    }

    let updated = 0;
    const whatsappResults: SupplierWhatsAppResult[] = [];

    for (const [groupKey, group] of groupedRecords.entries()) {
      const separatorIndex = groupKey.indexOf("|");
      const baseId = groupKey.slice(0, separatorIndex);
      const tableName = groupKey.slice(separatorIndex + 1);

      const airtableRecords = group.map((record) => ({
        id: record.lineId,
        fields: {
          received_in_wh_1: "Yes",
          bill_no: billNo,
          "Supplier Activity": supplierActivity,
          "Activity DateTime": activityDateTime,
          ...getSoldOutFieldUpdate(tableName, action),
        },
      }));

      for (let index = 0; index < airtableRecords.length; index += 10) {
        const batch = airtableRecords.slice(index, index + 10);
        const response = await fetch(airtableUrl(baseId, tableName), {
          method: "PATCH",
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
          body: JSON.stringify({ records: batch, typecast: true }),
        });
        const responseText = await response.text();
        let data: any = null;
        try {
          data = responseText ? JSON.parse(responseText) : null;
        } catch {
          data = null;
        }

        if (!response.ok) {
          return NextResponse.json(
            {
              success: false,
              message:
                data?.error?.message ||
                data?.error?.error?.message ||
                `Bulk update failed for ${tableName}`,
              error: data,
              baseId,
              tableName,
              updated,
              whatsapp: {
                sent: whatsappResults.filter((item) => item.success).length,
                failed: whatsappResults.filter((item) => !item.success).length,
              },
            },
            { status: response.status },
          );
        }

        updated += batch.length;

        const batchContexts: SupplierWhatsAppContext[] = [];
        for (const item of batch) {
          const context = contextsByRecordId.get(item.id);
          if (context) {
            batchContexts.push(context);
          } else {
            whatsappResults.push({
              success: false,
              action,
              targetGroup: "",
              message:
                contextFailures.get(item.id) ||
                "WhatsApp notification context was unavailable",
            });
          }
        }

        if (batchContexts.length) {
          whatsappResults.push(
            ...(await sendNotificationBatch(action, batchContexts)),
          );
        }
      }
    }

    const whatsappSent = whatsappResults.filter((item) => item.success).length;
    const whatsappFailed = whatsappResults.length - whatsappSent;

    await createAuditLog({
      module: "Supplier",
      action: action === "stock_out" ? "Bulk Stock Out" : "Bulk Receive",
      recordLabel: `${updated} line(s)`,
      newValue: JSON.stringify({
        received_in_wh_1: "Yes",
        bill_no: billNo,
        supplier_activity: supplierActivity,
        activity_date_time: activityDateTime,
        bill_number_source:
          action === "dispatch" && requestedManualBillNo
            ? "manual"
            : "automatic",
        sources: Array.from(groupedRecords.keys()),
        sold_out_fields:
          action === "stock_out"
            ? Array.from(groupedRecords.keys()).map((source) => {
                const separatorIndex = source.indexOf("|");
                const tableName = source.slice(separatorIndex + 1);
                return {
                  tableName,
                  fields: getSoldOutFieldUpdate(tableName, action),
                };
              })
            : undefined,
        whatsapp: {
          sent: whatsappSent,
          failed: whatsappFailed,
          failures: whatsappResults
            .filter((item) => !item.success)
            .slice(0, 20)
            .map((item) => item.message || "WhatsApp send failed"),
        },
      }),
      note: `Updated ${updated} supplier pending line(s); WhatsApp sent ${whatsappSent}, failed ${whatsappFailed}`,
    });

    return NextResponse.json({
      success: true,
      updated,
      billNo,
      whatsapp: {
        sent: whatsappSent,
        failed: whatsappFailed,
        failures: whatsappResults
          .filter((item) => !item.success)
          .slice(0, 20)
          .map((item) => item.message || "WhatsApp send failed"),
      },
    });
  } catch (error: any) {
    console.error("Supplier bulk update failed:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error?.message ||
          error?.error?.message ||
          "Supplier bulk update failed",
        error: error?.error,
      },
      { status: error?.status || 500 },
    );
  }
}
