import {
  NextRequest,
  NextResponse,
} from "next/server";
import { getSession } from "@/lib/auth";
import {
  insertAuditEvents,
  queryAuditEvents,
} from "@/lib/audit-db";
import {
  deletePendingAuditKey,
  listPendingAuditKeys,
  readPendingAuditBatch,
} from "@/lib/audit-pending";
import type {
  JsonValue,
} from "@/lib/audit-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();

  if (!session) {
    throw {
      status: 401,
      message: "Not authenticated",
    };
  }

  if (
    !session.superAdmin &&
    session.role !== "Admin"
  ) {
    throw {
      status: 403,
      message:
        "Admin access required",
    };
  }

  return session;
}

async function flushPendingAudit(
  limit = 25
) {
  const keys =
    await listPendingAuditKeys(
      limit
    );
  let restored = 0;

  for (const key of keys) {
    try {
      const events =
        await readPendingAuditBatch(
          key
        );

      if (!events?.length) {
        await deletePendingAuditKey(
          key
        );
        continue;
      }

      await insertAuditEvents(events, {
        skipFallback: true,
      });
      await deletePendingAuditKey(
        key
      );
      restored += events.length;
    } catch (error) {
      console.error(
        `Pending audit restore failed for ${key}:`,
        error
      );
    }
  }

  return restored;
}

function stringifyValue(
  value: JsonValue
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function compatibilityRecord(
  row: Record<string, JsonValue>
) {
  return {
    id: String(row.id || ""),
    fields: {
      Date: row.created_at,
      User: row.actor_username,
      "Full Name":
        row.actor_full_name,
      Role: row.actor_role,
      Company: row.company_name,
      Module: row.module,
      Action: row.action,
      Operation: row.operation,
      "Airtable Table":
        row.table_name,
      "Record ID": row.record_id,
      "Record Label":
        row.record_label,
      "Old Value": stringifyValue(
        row.old_data
      ),
      "New Value": stringifyValue(
        row.new_data
      ),
      "Changed Fields":
        stringifyValue(
          row.changed_fields
        ),
      Source: row.source_host,
      Note: "",
      Metadata: stringifyValue(
        row.metadata
      ),
    },
  };
}

export async function GET(
  request: NextRequest
) {
  try {
    await requireAdmin();

    let restored = 0;

    try {
      restored =
        await flushPendingAudit(25);
    } catch (error) {
      console.error(
        "Pending audit flush skipped:",
        error
      );
    }

    const params =
      request.nextUrl.searchParams;

    const result =
      await queryAuditEvents({
        user:
          params.get("user") || "",
        module:
          params.get("module") || "",
        action:
          params.get("action") || "",
        company:
          params.get("company") || "",
        table:
          params.get("table") || "",
        record:
          params.get("record") || "",
        operation:
          params.get("operation") || "",
        from:
          params.get("from") || "",
        to: params.get("to") || "",
        page: Number(
          params.get("page") || 1
        ),
        limit: Number(
          params.get("limit") || 50
        ),
      });

    return NextResponse.json({
      success: true,
      records: result.rows.map(
        compatibilityRecord
      ),
      pagination:
        result.pagination,
      restoredPendingEvents:
        restored,
    });
  } catch (error) {
    const known = error as {
      status?: number;
      message?: string;
    };

    return NextResponse.json(
      {
        success: false,
        message:
          known?.message ||
          "Activity log failed",
      },
      {
        status: known?.status || 500,
      }
    );
  }
}
