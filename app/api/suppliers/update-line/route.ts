import { NextResponse } from "next/server";
import {
  airtableFetch,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import { createAuditLog } from "@/lib/audit";

const ALLOWED_SUPPLIER_TABLES = new Set([
  "app2hjpuQoeEL1Rn2|BS Order Entry",
  "appiz6tozkQO2TQXt|FAB Order Entry",
]);

function getTodayBillNo() {
  const date = new Date();

  return `${String(date.getDate()).padStart(2, "0")}${String(
    date.getMonth() + 1
  ).padStart(2, "0")}${date.getFullYear()}`;
}

export async function PATCH(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReceive && !airtable.canDispatch && !airtable.canEdit) {
      return NextResponse.json(
        { success: false, message: "Permission denied" },
        { status: 403 }
      );
    }

    const { lineId, action, baseId, tableName } = await request.json();

    if (!lineId) {
      return NextResponse.json(
        { success: false, message: "Line ID is required" },
        { status: 400 }
      );
    }

    if (!baseId || !tableName) {
      return NextResponse.json(
        {
          success: false,
          message: "Record source base/table information is required",
        },
        { status: 400 }
      );
    }

    if (!ALLOWED_SUPPLIER_TABLES.has(`${baseId}|${tableName}`)) {
      return NextResponse.json(
        { success: false, message: "Invalid supplier source base/table" },
        { status: 403 }
      );
    }

    if (action !== "dispatch" && action !== "stock_out") {
      return NextResponse.json(
        { success: false, message: "Invalid supplier update action" },
        { status: 400 }
      );
    }

    const billNo = action === "dispatch" ? getTodayBillNo() : "STOCK OUT";

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
        },
      },
    });

    await createAuditLog({
      module: "Supplier",
      action:
        action === "dispatch" ? "Supplier Receive" : "Supplier Stock Out",
      recordId: lineId,
      recordLabel: lineId,
      newValue: JSON.stringify({
        baseId,
        tableName,
        bill_no: billNo,
        received_in_wh_1: "Yes",
      }),
    });

    return NextResponse.json({
      success: true,
      record,
      billNo,
    });
  } catch (error) {
    return handleApiError(error, "Supplier line update failed");
  }
}
