import { NextResponse } from "next/server";
import { getCurrentAirtableBase } from "@/lib/airtable";
import { getSession } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import {
  loadSupplierWhatsAppContexts,
  sendSupplierPendingWhatsAppImage,
  type SupplierWhatsAppContext,
  type SupplierWhatsAppResult,
} from "@/lib/supplier-whatsapp";

type ShareRecord = {
  lineId: string;
  baseId: string;
  tableName: string;
};

const ALLOWED_SUPPLIER_TABLES = new Set([
  "app2hjpuQoeEL1Rn2|BS Order Entry",
  "appiz6tozkQO2TQXt|FAB Order Entry",
]);

async function sendBatch(contexts: SupplierWhatsAppContext[]) {
  const results: SupplierWhatsAppResult[] = [];

  for (let index = 0; index < contexts.length; index += 3) {
    const chunk = contexts.slice(index, index + 3);
    const chunkResults = await Promise.all(
      chunk.map(async (context) => {
        try {
          return await sendSupplierPendingWhatsAppImage(context);
        } catch (error) {
          return {
            success: false,
            action: "dispatch" as const,
            targetGroup: "",
            message:
              error instanceof Error
                ? error.message
                : "WhatsApp image send failed",
          };
        }
      }),
    );

    results.push(...chunkResults);
  }

  return results;
}

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
          message:
            "Supplier users cannot send pending items to the internal WhatsApp group.",
        },
        { status: 403 },
      );
    }

    const airtable = await getCurrentAirtableBase();
    if (!airtable.canDispatch && !airtable.canEdit && !airtable.canReceive) {
      return NextResponse.json(
        { success: false, message: "Permission denied" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const records = Array.isArray(body?.records)
      ? (body.records as ShareRecord[])
      : [];

    if (records.length === 0) {
      return NextResponse.json(
        { success: false, message: "No pending items selected." },
        { status: 400 },
      );
    }

    if (records.length > 1000) {
      return NextResponse.json(
        {
          success: false,
          message: "Maximum 1000 items can be sent at one time.",
        },
        { status: 400 },
      );
    }

    for (const record of records) {
      if (!record?.lineId || !record?.baseId || !record?.tableName) {
        return NextResponse.json(
          {
            success: false,
            message: "One or more items have missing source details.",
          },
          { status: 400 },
        );
      }

      if (!ALLOWED_SUPPLIER_TABLES.has(`${record.baseId}|${record.tableName}`)) {
        return NextResponse.json(
          { success: false, message: "One or more items have an invalid source." },
          { status: 403 },
        );
      }
    }

    const grouped = new Map<string, ShareRecord[]>();
    for (const record of records) {
      const key = `${record.baseId}|${record.tableName}`;
      const group = grouped.get(key) || [];
      group.push(record);
      grouped.set(key, group);
    }

    const contextsByRecordId = new Map<string, SupplierWhatsAppContext>();
    const failures: string[] = [];

    for (const [groupKey, group] of grouped.entries()) {
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
          if (context) {
            contextsByRecordId.set(record.lineId, context);
          } else {
            failures.push(`${record.lineId}: supplier item could not be loaded`);
          }
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to prepare WhatsApp item";
        for (const record of group) {
          failures.push(`${record.lineId}: ${message}`);
        }
      }
    }

    const contexts = records
      .map((record) => contextsByRecordId.get(record.lineId))
      .filter((context): context is SupplierWhatsAppContext => Boolean(context));

    const results = await sendBatch(contexts);
    const sent = results.filter((result) => result.success).length;

    failures.push(
      ...results
        .filter((result) => !result.success)
        .map((result) => result.message || "WhatsApp image send failed"),
    );

    await createAuditLog({
      module: "Supplier",
      action: "Supplier Pending WhatsApp Share",
      recordLabel: `${records.length} pending item(s)`,
      newValue: JSON.stringify({
        requested: records.length,
        sent,
        failed: failures.length,
        sources: Array.from(grouped.keys()),
      }),
      note: `Pending supplier items sent to Dispatch WhatsApp group: ${sent} sent, ${failures.length} failed`,
    });

    return NextResponse.json({
      success: true,
      requested: records.length,
      sent,
      failed: failures.length,
      failures: failures.slice(0, 20),
    });
  } catch (error) {
    console.error("Supplier pending WhatsApp share failed:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Supplier pending WhatsApp share failed",
      },
      { status: 500 },
    );
  }
}
