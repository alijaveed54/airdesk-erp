import { NextResponse } from "next/server";
import {
  airtableFetch,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import { getSession } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
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
    if (action !== "dispatch" && action !== "stock_out") {
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
      action === "dispatch"
        ? requestedManualBillNo || getTodayBillNo()
        : "STOCK OUT";
    const supplierActivity =
      action === "stock_out" ? "Sold Out" : "Dispatched";
    const activityDateTime = new Date().toISOString();

    const record = await airtableFetch({
      baseId,
      token: airtable.token,
      table: tableName,
      recordId: lineId,
      method: "PATCH",
      fields: {
        fields: {
          bill_no: billNo,
          received_in_wh_1: "Yes",
          "Supplier Activity": supplierActivity,
          "Activity DateTime": activityDateTime,
          ...getSoldOutFieldUpdate(tableName, action),
        },
        typecast: true,
      },
    });

    let whatsapp: SupplierWhatsAppResult;
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

    await createAuditLog({
      module: "Supplier",
      action:
        action === "dispatch" ? "Supplier Receive" : "Supplier Stock Out",
      recordId: lineId,
      recordLabel: context?.orderNo || lineId,
      newValue: JSON.stringify({
        baseId,
        tableName,
        bill_no: billNo,
        supplier_activity: supplierActivity,
        activity_date_time: activityDateTime,
        bill_number_source:
          action === "dispatch" && requestedManualBillNo
            ? "manual"
            : "automatic",
        received_in_wh_1: "Yes",
        sold_out_field:
          action === "stock_out"
            ? getSoldOutFieldUpdate(tableName, action)
            : undefined,
        whatsapp: {
          success: whatsapp.success,
          targetGroup: whatsapp.targetGroup,
          idMessage: whatsapp.idMessage || "",
          message: whatsapp.message || "",
        },
      }),
    });

    return NextResponse.json({
      success: true,
      record,
      billNo,
      whatsapp,
      warning: whatsapp.success ? "" : whatsapp.message || "WhatsApp send failed",
    });
  } catch (error) {
    return handleApiError(error, "Supplier line update failed");
  }
}
