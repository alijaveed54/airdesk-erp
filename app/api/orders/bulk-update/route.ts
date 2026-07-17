import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import { createAuditLog } from "@/lib/audit";

export async function PATCH(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canDispatch && !airtable.canEdit) {
      return NextResponse.json(
        { success: false, message: "You do not have permission for bulk order update" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, orderIds, courier } = body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "Order IDs are required" },
        { status: 400 }
      );
    }

    let fields: Record<string, any> = {};

    if (action === "courier") {
      if (!courier) {
        return NextResponse.json(
          { success: false, message: "Courier is required" },
          { status: 400 }
        );
      }

      fields = ((airtable.tables?.invoice||"").toLowerCase().includes("fab") || (airtable.tables?.invoice||"").toLowerCase().includes("i5q") || (airtable.tables?.invoice||"").toLowerCase().includes("dq")) ? { "Driver Name": courier } : { Courier: courier };
    } else if (action === "dispatch") {
      fields = {
        order_status: "Dispatched",
        "Despatch Date": new Date().toISOString().slice(0, 10),
      };
    } else {
      return NextResponse.json(
        { success: false, message: "Invalid bulk action" },
        { status: 400 }
      );
    }

    const chunks: string[][] = [];

    for (let i = 0; i < orderIds.length; i += 10) {
      chunks.push(orderIds.slice(i, i + 10));
    }

    const updatedRecords: any[] = [];

    for (const chunk of chunks) {
      const response = await fetch(airtableUrl(airtable.baseId, airtable.tables?.invoice || "BS Invoice"), {
        method: "PATCH",
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
        body: JSON.stringify({
          records: chunk.map((id) => ({
            id,
            fields,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          {
            success: false,
            message: "Bulk update failed",
            error: data,
          },
          { status: response.status }
        );
      }

      updatedRecords.push(...(data.records || []));
    }

    await createAuditLog({
      module: "Orders",
      action: action === "dispatch" ? "Bulk Dispatch" : "Bulk Courier Update",
      recordLabel: `${orderIds.length} order(s)`,
      newValue: JSON.stringify(fields),
      note: `Updated ${updatedRecords.length} order(s)`,
    });

    return NextResponse.json({
      success: true,
      updated: updatedRecords.length,
      records: updatedRecords,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
