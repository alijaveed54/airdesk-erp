import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import {
  resolveInvoiceIdsForOrderEntryRecords,
  syncInvoiceInstockStatuses,
} from "@/lib/order-instock-sync";

async function recordExists(
  baseId: string,
  token: string,
  tableName: string,
  recordId: string
) {
  const response = await fetch(
    `${airtableUrl(baseId, tableName)}/${recordId}`,
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );

  return response.ok;
}

async function deleteRecords(
  baseId: string,
  token: string,
  tableName: string,
  ids: string[]
) {
  const params = new URLSearchParams();

  for (const id of ids) {
    params.append("records[]", id);
  }

  const response = await fetch(
    `${airtableUrl(baseId, tableName)}?${params.toString()}`,
    {
      method: "DELETE",
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );

  const data = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function DELETE(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to delete order items",
        },
        { status: 403 }
      );
    }

    const body = await req.json();

    const ids = Array.isArray(body.ids)
      ? body.ids
          .map((id: unknown) => String(id || "").trim())
          .filter(Boolean)
      : [];

    if (ids.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Item IDs are required",
        },
        { status: 400 }
      );
    }

    const normalizedBaseName = String(
      airtable.baseName || ""
    )
      .trim()
      .toLowerCase();

    const isI5qDqBase =
      normalizedBaseName.includes("i5q") ||
      normalizedBaseName.includes("dq") ||
      normalizedBaseName.includes("04-10-2026");

    const targetTable = isI5qDqBase
      ? "DQ Order Entry"
      : airtable.tables?.orderEntry || "BS Order Entry";

    const invoiceTableName = isI5qDqBase
      ? "DQ Invoice"
      : airtable.tables?.invoice || "BS Invoice";

    let linkedInvoiceIds: string[] = [];

    try {
      linkedInvoiceIds =
        await resolveInvoiceIdsForOrderEntryRecords({
          baseId: airtable.baseId,
          token: airtable.token,
          orderEntryTableName: targetTable,
          invoiceTableName,
          recordIds: ids,
        });
    } catch (syncError) {
      console.error(
        "Unable to resolve invoice before order item delete:",
        syncError
      );
    }

    const result = await deleteRecords(
      airtable.baseId,
      airtable.token,
      targetTable,
      ids
    );

    console.log("========== ORDER ITEM DELETE ==========");
    console.log("Base:", airtable.baseName);
    console.log("Resolved Order Entry Table:", targetTable);
    console.log("Incoming IDs:", ids);
    console.log(
      "Delete Response:",
      JSON.stringify(result.data, null, 2)
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            result.data?.error?.message ||
            result.data?.error?.error?.message ||
            "Order items delete failed",
          error: result.data,
          table: targetTable,
          ids,
        },
        { status: result.status }
      );
    }

    let instockSync: unknown = null;

    try {
      instockSync = await syncInvoiceInstockStatuses({
        baseId: airtable.baseId,
        token: airtable.token,
        orderEntryTableName: targetTable,
        invoiceTableName,
        invoiceIds: linkedInvoiceIds,
      });
    } catch (syncError) {
      console.error("Invoice Instock sync after item delete failed:", syncError);
      instockSync = {
        success: false,
        message:
          syncError instanceof Error
            ? syncError.message
            : "Invoice Instock sync failed",
      };
    }

    return NextResponse.json({
      success: true,
      records: result.data?.records || [],
      table: targetTable,
      instockSync,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown Error",
      },
      { status: 500 }
    );
  }
}
