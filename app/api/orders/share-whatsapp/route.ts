import { NextResponse } from "next/server";
import { getCurrentAirtableBase, airtableUrl, airtableHeaders } from "@/lib/airtable";
import { getSession } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import {
  loadSupplierWhatsAppContexts,
  sendSupplierPendingWhatsAppImage,
  type SupplierWhatsAppContext,
} from "@/lib/supplier-whatsapp";

type ShareOrderBody = {
  orderId?: unknown;
  tableName?: unknown;
};

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (String(session.role || "").trim().toLowerCase() === "supplier") {
      return NextResponse.json(
        {
          success: false,
          message: "Supplier users cannot send order photos to WhatsApp.",
        },
        { status: 403 },
      );
    }

    const airtable = await getCurrentAirtableBase();
    if (!airtable.canView && !airtable.canDispatch && !airtable.canEdit) {
      return NextResponse.json(
        { success: false, message: "Permission denied" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as ShareOrderBody;
    const orderId = String(body.orderId || "").trim();
    const invoiceTableName = String(body.tableName || "").trim();

    if (!orderId || !orderId.startsWith("rec") || !invoiceTableName) {
      return NextResponse.json(
        { success: false, message: "Valid order ID and table name are required" },
        { status: 400 },
      );
    }

    const invoiceRes = await fetch(
      `${airtableUrl(airtable.baseId, invoiceTableName)}/${encodeURIComponent(orderId)}`,
      {
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
      },
    );
    const invoiceData = await invoiceRes.json().catch(() => null);

    if (!invoiceRes.ok || !invoiceData) {
      return NextResponse.json(
        { success: false, message: "Order invoice record not found" },
        { status: 404 },
      );
    }

    const schemaRes = await fetch(
      `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(airtable.baseId)}/tables`,
      {
        headers: { Authorization: `Bearer ${airtable.token}` },
        cache: "no-store",
      },
    );
    const schemaData = await schemaRes.json();
    const tables = (schemaData.tables || []) as Array<{
      id: string;
      name: string;
      fields: Array<{ id: string; name: string; type: string; options?: { linkedTableId?: string } }>;
    }>;

    const invoiceTable = tables.find((t) => t.name === invoiceTableName);
    if (!invoiceTable) {
      return NextResponse.json(
        { success: false, message: "Invoice table schema not found" },
        { status: 404 },
      );
    }

    let itemRecordIds: string[] = [];
    let itemsTableName = "";

    for (const field of invoiceTable.fields || []) {
      if (field.type === "multipleRecordLinks" && field.options?.linkedTableId) {
        const linkedTable = tables.find((t) => t.id === field.options?.linkedTableId);
        if (linkedTable) {
          const linkedNameLower = linkedTable.name.trim().toLowerCase();
          if (linkedNameLower.includes("order entry") && !linkedNameLower.includes("return")) {
            const linkValues = invoiceData.fields?.[field.name];
            if (Array.isArray(linkValues)) {
              const ids = linkValues.map((id) => String(id || "").trim()).filter((id) => id.startsWith("rec"));
              if (ids.length > 0) {
                itemRecordIds = ids;
                itemsTableName = linkedTable.name;
                break;
              }
            }
          }
        }
      }
    }

    if (itemRecordIds.length === 0 || !itemsTableName) {
      return NextResponse.json(
        { success: false, message: "No linked order items found for this order" },
        { status: 400 },
      );
    }

    const contextsMap = await loadSupplierWhatsAppContexts({
      baseId: airtable.baseId,
      tableName: itemsTableName,
      recordIds: itemRecordIds,
      token: airtable.token,
    });

    const contexts = itemRecordIds
      .map((id) => contextsMap.get(id))
      .filter((c): c is SupplierWhatsAppContext => Boolean(c));

    if (contexts.length === 0) {
      return NextResponse.json(
        { success: false, message: "Could not load WhatsApp item details or photos" },
        { status: 400 },
      );
    }

    const results: Array<{ success: boolean; message?: string }> = [];
    for (let i = 0; i < contexts.length; i += 3) {
      const chunk = contexts.slice(i, i + 3);
      const chunkRes = await Promise.all(
        chunk.map(async (ctx) => {
          try {
            return await sendSupplierPendingWhatsAppImage(ctx);
          } catch (err) {
            return {
              success: false,
              action: "dispatch" as const,
              targetGroup: "",
              message: err instanceof Error ? err.message : "Failed to send WhatsApp image",
            };
          }
        }),
      );
      results.push(...chunkRes);
    }

    const sent = results.filter((r) => r.success).length;
    const failures = results.filter((r) => !r.success).map((r) => r.message || "Failed");

    const orderNo = String(invoiceData.fields["order_no."] || invoiceData.fields["Order No."] || orderId);

    await createAuditLog({
      module: "Orders",
      action: "Order WhatsApp Share",
      recordLabel: `Order ${orderNo}`,
      newValue: JSON.stringify({ orderNo, sent, failed: failures.length }),
      note: `Order ${orderNo} items shared to WhatsApp: ${sent} sent`,
    });

    return NextResponse.json({
      success: true,
      sent,
      failed: failures.length,
      message: `Successfully sent ${sent} item(s) to WhatsApp`,
    });
  } catch (error) {
    console.error("Order WhatsApp share failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Order WhatsApp share failed",
      },
      { status: 500 },
    );
  }
}