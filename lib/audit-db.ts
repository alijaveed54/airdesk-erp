import {
  createClient,
} from "@libsql/client";
import { getSession } from "@/lib/auth";
import {
  savePendingAuditBatch,
} from "@/lib/audit-pending";
import type {
  AuditEvent,
  AuditQuery,
  JsonValue,
} from "@/lib/audit-types";

let sqlClient:
  | ReturnType<typeof createClient>
  | null = null;
let schemaPromise:
  | Promise<void>
  | null = null;

function getTursoConfig() {
  const url = String(
    process.env.TURSO_DATABASE_URL || ""
  ).trim();
  const authToken = String(
    process.env.TURSO_AUTH_TOKEN || ""
  ).trim();

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is missing. Add the Turso database URL to Vercel and .env.local."
    );
  }

  if (
    !authToken &&
    !url.startsWith("file:") &&
    !url.startsWith("http://127.0.0.1") &&
    !url.startsWith("http://localhost")
  ) {
    throw new Error(
      "TURSO_AUTH_TOKEN is missing. Add the private Turso database token to Vercel and .env.local."
    );
  }

  return {
    url,
    authToken: authToken || undefined,
  };
}

function getSql() {
  if (!sqlClient) {
    sqlClient = createClient(
      getTursoConfig()
    );
  }

  return sqlClient;
}

function jsonText(
  value: JsonValue | undefined,
  fallback: JsonValue
) {
  return JSON.stringify(
    value === undefined
      ? fallback
      : value
  );
}

function parseJsonValue(
  value: unknown,
  fallback: JsonValue
): JsonValue {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return fallback;
  }
}

function textValue(
  value: unknown
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value);
}

function normalizeAuditRow(
  row: Record<string, unknown>
): Record<string, JsonValue> {
  return {
    id: textValue(row.id),
    event_group_id: textValue(
      row.event_group_id
    ),
    created_at: textValue(
      row.created_at
    ),
    actor_username: textValue(
      row.actor_username
    ),
    actor_full_name: textValue(
      row.actor_full_name
    ),
    actor_role: textValue(
      row.actor_role
    ),
    company_name: textValue(
      row.company_name
    ),
    base_id: textValue(row.base_id),
    table_name: textValue(
      row.table_name
    ),
    record_id: textValue(
      row.record_id
    ),
    record_label: textValue(
      row.record_label
    ),
    module: textValue(row.module),
    action: textValue(row.action),
    operation: textValue(
      row.operation
    ),
    old_data: parseJsonValue(
      row.old_data,
      null
    ),
    new_data: parseJsonValue(
      row.new_data,
      null
    ),
    changed_fields: parseJsonValue(
      row.changed_fields,
      {}
    ),
    source_host: textValue(
      row.source_host
    ),
    metadata: parseJsonValue(
      row.metadata,
      {}
    ),
  };
}

export function getAuditSource() {
  const configured = String(
    process.env.AUDIT_SOURCE || ""
  ).trim();

  if (configured) {
    return configured;
  }

  const vercelEnvironment = String(
    process.env.VERCEL_ENV || ""
  ).trim();

  if (vercelEnvironment) {
    return `vercel-${vercelEnvironment}`;
  }

  return "localhost";
}

export async function ensureAuditSchema() {
  if (schemaPromise) {
    return schemaPromise;
  }

  schemaPromise = (async () => {
    const sql = getSql();

    await sql.batch(
      [
        {
          sql: `
            CREATE TABLE IF NOT EXISTS audit_events (
              id TEXT PRIMARY KEY,
              event_group_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              actor_username TEXT NOT NULL DEFAULT '',
              actor_full_name TEXT NOT NULL DEFAULT '',
              actor_role TEXT NOT NULL DEFAULT '',
              company_name TEXT NOT NULL DEFAULT '',
              base_id TEXT NOT NULL DEFAULT '',
              table_name TEXT NOT NULL DEFAULT '',
              record_id TEXT NOT NULL DEFAULT '',
              record_label TEXT NOT NULL DEFAULT '',
              module TEXT NOT NULL DEFAULT '',
              action TEXT NOT NULL DEFAULT '',
              operation TEXT NOT NULL CHECK (
                operation IN ('CREATE', 'UPDATE', 'DELETE')
              ),
              old_data TEXT NOT NULL DEFAULT 'null',
              new_data TEXT NOT NULL DEFAULT 'null',
              changed_fields TEXT NOT NULL DEFAULT '{}',
              source_host TEXT NOT NULL DEFAULT '',
              metadata TEXT NOT NULL DEFAULT '{}'
            )
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
            ON audit_events (created_at DESC)
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS audit_events_actor_idx
            ON audit_events (actor_username, created_at DESC)
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS audit_events_company_idx
            ON audit_events (company_name, created_at DESC)
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS audit_events_table_idx
            ON audit_events (table_name, created_at DESC)
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS audit_events_record_idx
            ON audit_events (record_id, created_at DESC)
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS audit_events_module_action_idx
            ON audit_events (module, action, created_at DESC)
          `,
          args: [],
        },
      ],
      "write"
    );
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

function insertStatement(
  event: AuditEvent
) {
  return {
    sql: `
      INSERT OR IGNORE INTO audit_events (
        id,
        event_group_id,
        created_at,
        actor_username,
        actor_full_name,
        actor_role,
        company_name,
        base_id,
        table_name,
        record_id,
        record_label,
        module,
        action,
        operation,
        old_data,
        new_data,
        changed_fields,
        source_host,
        metadata
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    args: [
      event.id,
      event.eventGroupId,
      event.createdAt,
      event.actorUsername,
      event.actorFullName,
      event.actorRole,
      event.companyName,
      event.baseId,
      event.tableName,
      event.recordId,
      event.recordLabel,
      event.module,
      event.action,
      event.operation,
      jsonText(event.oldData, null),
      jsonText(event.newData, null),
      jsonText(
        event.changedFields,
        {}
      ),
      event.sourceHost,
      jsonText(event.metadata, {}),
    ],
  };
}

export async function insertAuditEvents(
  events: AuditEvent[],
  options: {
    skipFallback?: boolean;
  } = {}
) {
  if (!events.length) {
    return {
      inserted: 0,
      queued: false,
    };
  }

  try {
    await ensureAuditSchema();

    const sql = getSql();
    const chunkSize = 100;

    for (
      let index = 0;
      index < events.length;
      index += chunkSize
    ) {
      const chunk = events.slice(
        index,
        index + chunkSize
      );

      await sql.batch(
        chunk.map(insertStatement),
        "write"
      );
    }

    return {
      inserted: events.length,
      queued: false,
    };
  } catch (error) {
    console.error(
      "Turso audit insert failed:",
      error
    );

    if (!options.skipFallback) {
      try {
        const queued =
          await savePendingAuditBatch({
            events,
            error,
          });

        return {
          inserted: 0,
          queued,
        };
      } catch (fallbackError) {
        console.error(
          "R2 audit fallback failed:",
          fallbackError
        );
      }
    }

    throw error;
  }
}

export async function getAuditActor(
  baseId = ""
) {
  try {
    const session = await getSession();
    const bases = [
      session?.selectedBase,
      ...(session?.permissions || []),
      ...(session?.availableBases || []),
    ].filter(Boolean);

    const matchingBase = baseId
      ? bases.find(
          (base) =>
            String(
              base?.baseId || ""
            ) === baseId
        )
      : session?.selectedBase;

    return {
      actorUsername:
        session?.username ||
        "System",
      actorFullName:
        session?.fullName || "",
      actorRole:
        session?.role || "System",
      companyName:
        matchingBase?.baseName ||
        session?.selectedBase
          ?.baseName ||
        "",
    };
  } catch {
    return {
      actorUsername: "System",
      actorFullName: "",
      actorRole: "System",
      companyName: "",
    };
  }
}

function cleanFilter(
  value: unknown
) {
  const cleaned = String(
    value || ""
  ).trim();

  return cleaned || null;
}

function validDateOrNull(
  value: unknown,
  endOfDay = false
) {
  const cleaned = cleanFilter(value);

  if (!cleaned) {
    return null;
  }

  const date = new Date(
    endOfDay &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      cleaned
    )
      ? `${cleaned}T23:59:59.999Z`
      : cleaned
  );

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

function escapedLikePattern(
  value: string
) {
  const escaped = value.replace(
    /[\\%_]/g,
    (character) =>
      `\\${character}`
  );

  return `%${escaped}%`;
}

export async function queryAuditEvents(
  input: AuditQuery
) {
  await ensureAuditSchema();

  const sql = getSql();
  const page = Math.max(
    Number(input.page || 1) || 1,
    1
  );
  const limit = Math.min(
    Math.max(
      Number(input.limit || 50) || 50,
      1
    ),
    100
  );
  const offset = (page - 1) * limit;

  const user = cleanFilter(input.user);
  const moduleName = cleanFilter(
    input.module
  );
  const action = cleanFilter(
    input.action
  );
  const company = cleanFilter(
    input.company
  );
  const table = cleanFilter(
    input.table
  );
  const record = cleanFilter(
    input.record
  );
  const baseId = cleanFilter(
    input.baseId
  );
  const recordIds = Array.from(
    new Set(
      (input.recordIds || [])
        .map((value) =>
          String(value || "").trim()
        )
        .filter(Boolean)
    )
  ).slice(0, 250);
  const operation = cleanFilter(
    input.operation
  );
  const from = validDateOrNull(
    input.from
  );
  const to = validDateOrNull(
    input.to,
    true
  );

  const conditions: string[] = [];
  const args: Array<
    string | number
  > = [];

  if (user) {
    const pattern =
      escapedLikePattern(user);
    conditions.push(
      `(actor_username LIKE ? ESCAPE '\\' COLLATE NOCASE OR actor_full_name LIKE ? ESCAPE '\\' COLLATE NOCASE)`
    );
    args.push(pattern, pattern);
  }

  if (moduleName) {
    conditions.push(
      `module LIKE ? ESCAPE '\\' COLLATE NOCASE`
    );
    args.push(
      escapedLikePattern(moduleName)
    );
  }

  if (action) {
    conditions.push(
      `action LIKE ? ESCAPE '\\' COLLATE NOCASE`
    );
    args.push(
      escapedLikePattern(action)
    );
  }

  if (company) {
    conditions.push(
      `company_name LIKE ? ESCAPE '\\' COLLATE NOCASE`
    );
    args.push(
      escapedLikePattern(company)
    );
  }

  if (table) {
    conditions.push(
      `table_name LIKE ? ESCAPE '\\' COLLATE NOCASE`
    );
    args.push(
      escapedLikePattern(table)
    );
  }

  if (baseId) {
    conditions.push(
      `base_id = ?`
    );
    args.push(baseId);
  }

  const recordConditions: string[] = [];
  const recordArgs: Array<
    string | number
  > = [];

  if (record) {
    const pattern =
      escapedLikePattern(record);

    recordConditions.push(
      `record_id LIKE ? ESCAPE '\\' COLLATE NOCASE`,
      `record_label LIKE ? ESCAPE '\\' COLLATE NOCASE`,
      `old_data LIKE ? ESCAPE '\\' COLLATE NOCASE`,
      `new_data LIKE ? ESCAPE '\\' COLLATE NOCASE`,
      `changed_fields LIKE ? ESCAPE '\\' COLLATE NOCASE`,
      `metadata LIKE ? ESCAPE '\\' COLLATE NOCASE`
    );

    recordArgs.push(
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern
    );
  }

  if (recordIds.length) {
    recordConditions.push(
      `record_id IN (${recordIds
        .map(() => "?")
        .join(", ")})`
    );
    recordArgs.push(...recordIds);
  }

  if (recordConditions.length) {
    conditions.push(
      `(${recordConditions.join(
        " OR "
      )})`
    );
    args.push(...recordArgs);
  }

  if (operation) {
    conditions.push(
      `operation = ?`
    );
    args.push(operation.toUpperCase());
  }

  if (from) {
    conditions.push(
      `created_at >= ?`
    );
    args.push(from);
  }

  if (to) {
    conditions.push(
      `created_at <= ?`
    );
    args.push(to);
  }

  const whereClause =
    conditions.length
      ? `WHERE ${conditions.join(
          " AND "
        )}`
      : "";

  const selectSql = `
    SELECT
      id,
      event_group_id,
      created_at,
      actor_username,
      actor_full_name,
      actor_role,
      company_name,
      base_id,
      table_name,
      record_id,
      record_label,
      module,
      action,
      operation,
      old_data,
      new_data,
      changed_fields,
      source_host,
      metadata
    FROM audit_events
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const countSql = `
    SELECT COUNT(*) AS count
    FROM audit_events
    ${whereClause}
  `;

  const [rowsResult, countResult] =
    await sql.batch(
      [
        {
          sql: selectSql,
          args: [
            ...args,
            limit,
            offset,
          ],
        },
        {
          sql: countSql,
          args,
        },
      ],
      "read"
    );

  const rows = rowsResult.rows.map(
    (row) =>
      normalizeAuditRow(
        row as Record<
          string,
          unknown
        >
      )
  );

  const countRow =
    countResult.rows[0] as
      | Record<string, unknown>
      | undefined;
  const total = Number(
    countRow?.count || 0
  );

  return {
    rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(
        Math.ceil(total / limit),
        1
      ),
    },
  };
}
