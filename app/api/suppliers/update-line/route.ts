import { NextResponse } from "next/server";
import {
  airtableFetch,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import { getSession } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import {
  resolveInvoiceIdsForOrderEntryRecords,
  syncInvoiceInstockStatuses,
} from "@/lib/order-instock-sync";
import {
  loadSupplierWhatsAppContexts,
  sendSupplierWhatsAppNotification,
  supplierOwnedBy,
  type SupplierWhatsAppResult,
} from "@/lib/supplier-whatsapp";

const ALLOWED_SUPPLIER_TABLES = new Set([
  "app2hjpuQoeEL1Rn2|BS Order Entry",
  "appiz6tozkQO2TQXt|FAB Order Entry",
]);

type SupplierUpdateAction = "dispatch" | "stock_out" | "instock";

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
  action: SupplierUpdateAction,
): Record<string, string> {
  if (action !== "stock_out") return {};
  const config = SOLD_OUT_FIELD_BY_TABLE.get(tableName);
  return config ? { [config.fieldName]: config.value } : {};
}

function getInstockFieldUpdate(tableName: string): Record<string, string> {
  const fields: Record<string, string> = {
    bill_no: "",
    received_in_wh_1: "Yes",
  };

  // BS Order Entry locked In Stock rule:
  // received_in_wh_1 = Yes
  // bill_no = blank
  // instock = Yes
  // Received In UAE = Yes
  if (tableName === "BS Order Entry") {
    fields.instock = "Yes";
    fields["Received In UAE"] = "Yes";
  }

  return fields;
}

function getTodayBillNo() {
  const date = new Date();
  return `${String(date.getDate()).padStart(2, "0")}${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}${date.getFullYear()}`;
}

function supplierCodeForSession(session: any, airtable: any, baseId: string) {
  return String(
    session?.permissions?.find((permission: any) => permission?.baseId === baseId)
      ?.supplierCode ||
      airtable?.supplierCode ||
      "",
  ).trim();
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
        { success: false, message: "Permission denied" },
        { status: 403 },
      );
    }

    const { lineId, action, baseId, tableName, manualBillNo } =
      await request.json();

    if (!lineId) {
      return NextResponse.json(
        { success: false, message: "Line ID is required" },
        { status: 400 },
      );
    }
    if (!baseId || !tableName) {
      return NextResponse.json(
        {
          success: false,
          message: "Record source base/table information is required",
        },
        { status: 400 },
      );
    }
    if (!ALLOWED_SUPPLIER_TABLES.has(`${baseId}|${tableName}`)) {
      return NextResponse.json(
        { success: false, message: "Invalid supplier source base/table" },
        { status: 403 },
      );
    }
    if (action !== "dispatch" && action !== "stock_out" && action !== "instock") {
      return NextResponse.json(
        { success: false, message: "Invalid supplier update action" },
        { status: 400 },
      );
    }

    const requestedManualBillNo = String(manualBillNo || "").trim();
    if (requestedManualBillNo.length > 100) {
      return NextResponse.json(
        { success: false, message: "Manual Bill Number is too long." },
        { status: 400 },
      );
    }

    const currentRole = String(session.role || "").trim().toLowerCase();
    if (action === "instock" && currentRole === "supplier") {
      return NextResponse.json(
        {
          success: false,
          message: "Supplier users cannot convert pending items to In Stock.",
        },
        { status: 403 },
      );
    }
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

    let context: Awaited<
      ReturnType<typeof loadSupplierWhatsAppContexts>
    > extends Map<string, infer T>
      ? T | undefined
      : never;
    let contextError = "";

    try {
      const contexts = await loadSupplierWhatsAppContexts({
        baseId,
        tableName,
        recordIds: [lineId],
        token: airtable.token,
      });
      context = contexts.get(lineId);
      if (!context) throw new Error("Supplier record was not found");
    } catch (error) {
      contextError =
        error instanceof Error
          ? error.message
          : "Unable to prepare WhatsApp notification";
    }

    if (currentRole === "supplier") {
      const supplierCode = supplierCodeForSession(session, airtable, baseId);
      if (!supplierCode) {
        return NextResponse.json(
          { success: false, message: "Supplier code is missing in permission" },
          { status: 403 },
        );
      }
      if (!context) {
        return NextResponse.json(
          {
            success: false,
            message: `Unable to verify supplier ownership: ${contextError}`,
          },
          { status: 403 },
        );
      }
      if (!supplierOwnedBy(context, supplierCode)) {
        return NextResponse.json(
          {
            success: false,
            message: "You can update only your own supplier order lines",
          },
          { status: 403 },
        );
      }
    }

    const billNo =
      action === "instock"
        ? ""
        : action === "dispatch"
          ? requestedManualBillNo || getTodayBillNo()
          : "STOCK OUT";
    const supplierActivity =
      action === "stock_out"
        ? "Sold Out"
        : action === "dispatch"
          ? "Dispatched"
          : "";
    const activityDateTime = new Date().toISOString();

    const updateFields: Record<string, string> =
      action === "instock"
        ? getInstockFieldUpdate(tableName)
        : {
            bill_no: billNo,
            received_in_wh_1: "Yes",
            "Supplier Activity": supplierActivity,
            "Activity DateTime": activityDateTime,
            ...getSoldOutFieldUpdate(tableName, action),
          };

    const record = await airtableFetch({
      baseId,
      token: airtable.token,
      table: tableName,
      recordId: lineId,
      method: "PATCH",
      fields: {
        fields: updateFields,
        typecast: true,
      },
    });

    let instockSync: unknown = null;
    if (action === "instock") {
      const invoiceTableName =
        tableName === "BS Order Entry" ? "BS Invoice" : "FAB Invoice";

      try {
        const invoiceIds = await resolveInvoiceIdsForOrderEntryRecords({
          baseId,
          token: airtable.token,
          orderEntryTableName: tableName,
          invoiceTableName,
          recordIds: [lineId],
        });

        instockSync = await syncInvoiceInstockStatuses({
          baseId,
          token: airtable.token,
          orderEntryTableName: tableName,
          invoiceTableName,
          invoiceIds,
        });
      } catch (syncError) {
        console.error(
          "Invoice Instock sync after supplier pending conversion failed:",
          syncError,
        );
        instockSync = {
          success: false,
          message:
            syncError instanceof Error
              ? syncError.message
              : "Invoice Instock sync failed",
        };
      }
    }

    let whatsapp: SupplierWhatsAppResult | null = null;
    if (action !== "instock") {
      if (!context) {
        whatsapp = {
          success: false,
          action,
          targetGroup: "",
          message: contextError || "WhatsApp notification context was unavailable",
        };
      } else {
        try {
          whatsapp = await sendSupplierWhatsAppNotification(action, context);
        } catch (error) {
          whatsapp = {
            success: false,
            action,
            targetGroup: "",
            message:
              error instanceof Error
                ? error.message
                : "WhatsApp notification failed",
          };
        }
      }
    }

    await createAuditLog({
      module: "Supplier",
      action:
        action === "instock"
          ? "Supplier Convert In Stock"
          : action === "dispatch"
            ? "Supplier Receive"
            : "Supplier Stock Out",
      recordId: lineId,
      recordLabel: context?.orderNo || lineId,
      newValue: JSON.stringify({
        baseId,
        tableName,
        bill_no: billNo,
        supplier_activity: action === "instock" ? undefined : supplierActivity,
        activity_date_time: action === "instock" ? undefined : activityDateTime,
        bill_number_source:
          action === "instock"
            ? "cleared-for-instock"
            : action === "dispatch" && requestedManualBillNo
              ? "manual"
              : "automatic",
        received_in_wh_1: "Yes",
        instock:
          action === "instock" && tableName === "BS Order Entry" ? "Yes" : undefined,
        received_in_uae:
          action === "instock" && tableName === "BS Order Entry" ? "Yes" : undefined,
        sold_out_field:
          action === "stock_out"
            ? getSoldOutFieldUpdate(tableName, action)
            : undefined,
        instock_sync: action === "instock" ? instockSync : undefined,
        whatsapp: whatsapp
          ? {
              success: whatsapp.success,
              targetGroup: whatsapp.targetGroup,
              idMessage: whatsapp.idMessage || "",
              message: whatsapp.message || "",
            }
          : undefined,
      }),
    });

    return NextResponse.json({
      success: true,
      record,
      billNo,
      instockSync,
      whatsapp,
      warning:
        action === "instock"
          ? ""
          : whatsapp?.success
            ? ""
            : whatsapp?.message || "WhatsApp send failed",
    });
  } catch (error) {
    return handleApiError(error, "Supplier line update failed");
  }
}
