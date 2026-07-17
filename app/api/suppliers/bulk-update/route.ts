import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import { createAuditLog } from "@/lib/audit";

type SupplierUpdateRecord = {
  lineId: string;
  baseId: string;
  tableName: string;
};

const ALLOWED_SUPPLIER_TABLES = new Set([
  "app2hjpuQoeEL1Rn2|BS Order Entry",
  "appiz6tozkQO2TQXt|FAB Order Entry",
]);

function getTodayBillNo() {
  const now = new Date();

  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();

  return `${day}${month}${year}`;
}

export async function PATCH(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReceive && !airtable.canDispatch && !airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to update supplier pending",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { records, action } = body as {
      records: SupplierUpdateRecord[];
      action: "dispatch" | "stock_out";
    };

    if (action !== "dispatch" && action !== "stock_out") {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid supplier update action",
        },
        { status: 400 }
      );
    }

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No records selected.",
        },
        { status: 400 }
      );
    }

    for (const record of records) {
      if (!record.lineId || !record.baseId || !record.tableName) {
        return NextResponse.json(
          {
            success: false,
            message: "One or more selected records have missing source details.",
          },
          { status: 400 }
        );
      }

      if (
        !ALLOWED_SUPPLIER_TABLES.has(
          `${record.baseId}|${record.tableName}`
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "One or more selected records have an invalid source.",
          },
          { status: 403 }
        );
      }
    }

    const billNo =
      action === "stock_out" ? "STOCK OUT" : getTodayBillNo();

    const groupedRecords = new Map<string, SupplierUpdateRecord[]>();

    for (const record of records) {
      const key = `${record.baseId}|${record.tableName}`;
      const group = groupedRecords.get(key) || [];

      group.push(record);
      groupedRecords.set(key, group);
    }

    let updated = 0;

    for (const [groupKey, group] of groupedRecords.entries()) {
      const separatorIndex = groupKey.indexOf("|");
      const baseId = groupKey.slice(0, separatorIndex);
      const tableName = groupKey.slice(separatorIndex + 1);

      const airtableRecords = group.map((record) => ({
        id: record.lineId,
        fields: {
          received_in_wh_1: "Yes",
          bill_no: billNo,
        },
      }));

      for (let index = 0; index < airtableRecords.length; index += 10) {
        const batch = airtableRecords.slice(index, index + 10);

        const response = await fetch(airtableUrl(baseId, tableName), {
          method: "PATCH",
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
          body: JSON.stringify({
            records: batch,
          }),
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
            },
            { status: response.status }
          );
        }

        updated += batch.length;
      }
    }

    await createAuditLog({
      module: "Supplier",
      action:
        action === "stock_out" ? "Bulk Stock Out" : "Bulk Receive",
      recordLabel: `${updated} line(s)`,
      newValue: JSON.stringify({
        received_in_wh_1: "Yes",
        bill_no: billNo,
        sources: Array.from(groupedRecords.keys()),
      }),
      note: `Updated ${updated} supplier pending line(s)`,
    });

    return NextResponse.json({
      success: true,
      updated,
      billNo,
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
      { status: error?.status || 500 }
    );
  }
}
