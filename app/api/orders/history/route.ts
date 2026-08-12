import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import { queryAuditEvents } from "@/lib/audit-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SchemaField = {
  id: string;
  name: string;
  type?: string;
  options?: {
    linkedTableId?: string;
  };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: SchemaField[];
};

const schemaCache = new Map<string, SchemaTable[]>();

const HISTORY_ROLE_LABELS = new Set([
  "admin",
  "manager",
  "employee",
  "staff",
  "warehouse",
  "accounts",
  "supplier",
  "system",
]);

function normalizeHistoryUserValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function historyUserLooksLikeRole(value: unknown, role: unknown) {
  const normalizedValue = normalizeHistoryUserValue(value);
  const normalizedRole = normalizeHistoryUserValue(role);

  return (
    !normalizedValue ||
    normalizedValue === normalizedRole ||
    HISTORY_ROLE_LABELS.has(normalizedValue)
  );
}

async function loadOrderHistoryUserNames(rows: AuditRow[]) {
  const token = String(process.env.AUTH_AIRTABLE_TOKEN || "").trim();
  const baseId = String(process.env.AUTH_AIRTABLE_BASE_ID || "").trim();
  const names = new Map<string, string>();

  const usernames = Array.from(
    new Set(
      rows
        .map((row) => String(row.actor_username || "").trim())
        .filter(
          (username) =>
            Boolean(username) && normalizeHistoryUserValue(username) !== "system"
        )
    )
  );

  if (!token || !baseId || usernames.length === 0) {
    return names;
  }

  for (let index = 0; index < usernames.length; index += 20) {
    const chunk = usernames.slice(index, index + 20);
    const formulaParts = chunk.map(
      (username) =>
        `LOWER({Username})=LOWER('${escapeAirtableString(username)}')`
    );
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula:
        formulaParts.length === 1
          ? formulaParts[0]
          : `OR(${formulaParts.join(",")})`,
    });
    params.append("fields[]", "Username");
    params.append("fields[]", "Full Name");

    try {
      const response = await fetch(
        airtableUrl(baseId, "ERP Users", params),
        {
          headers: airtableHeaders(token),
          cache: "no-store",
        }
      );
      const data = await response.json();

      if (!response.ok) {
        console.error(
          "Unable to resolve order-history user names:",
          data?.error?.message || response.status
        );
        continue;
      }

      for (const record of data.records || []) {
        const username = String(record.fields?.Username || "").trim();
        const fullName = String(record.fields?.["Full Name"] || "").trim();

        if (username && fullName) {
          names.set(normalizeHistoryUserValue(username), fullName);
        }
      }
    } catch (error) {
      console.error("Unable to resolve order-history user names:", error);
    }
  }

  return names;
}

function resolveOrderHistoryUserName(
  row: AuditRow,
  userNames: Map<string, string>
) {
  const username = String(row.actor_username || "").trim();
  const recordedFullName = String(row.actor_full_name || "").trim();
  const role = String(row.actor_role || "").trim();
  const registeredFullName =
    userNames.get(normalizeHistoryUserValue(username)) || "";

  if (
    registeredFullName &&
    !historyUserLooksLikeRole(registeredFullName, role)
  ) {
    return registeredFullName;
  }

  if (
    recordedFullName &&
    !historyUserLooksLikeRole(recordedFullName, role)
  ) {
    return recordedFullName;
  }

  return username || "System";
}

function firstText(value: unknown): string {
  if (Array.isArray(value)) {
    return firstText(value[0]);
  }

  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return firstText(item.name ?? item.value ?? item.text ?? item.id);
  }

  return String(value ?? "").trim();
}

function linkedRecordIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values
    .map((item) => firstText(item))
    .filter((item) => item.startsWith("rec"));
}

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function getSchema(baseId: string, token: string) {
  const cached = schemaCache.get(baseId);
  if (cached) return cached;

  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to load Airtable schema");
  }

  const tables = (data.tables || []) as SchemaTable[];
  schemaCache.set(baseId, tables);
  return tables;
}

function primaryField(table: SchemaTable) {
  return (
    table.fields.find((field) => field.id === table.primaryFieldId) ||
    table.fields[0]
  );
}


const AIRTABLE_RECORD_ID_PATTERN = /^rec[a-zA-Z0-9]{10,}$/;

type AuditRow = Record<string, any>;

function normalizeFieldName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAirtableRecordId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    AIRTABLE_RECORD_ID_PATTERN.test(value.trim())
  );
}

function collectRecordIdsDeep(value: unknown, output = new Set<string>()) {
  if (isAirtableRecordId(value)) {
    output.add(value.trim());
    return output;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        collectRecordIdsDeep(JSON.parse(trimmed), output);
      } catch {
        // Keep non-JSON strings unchanged.
      }
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectRecordIdsDeep(item, output);
    return output;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectRecordIdsDeep(item, output);
    }
  }

  return output;
}

function replaceLinkedIds(
  value: unknown,
  labels: Map<string, string>
): unknown {
  if (isAirtableRecordId(value)) {
    return labels.get(value.trim()) || "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        return replaceLinkedIds(JSON.parse(trimmed), labels);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => replaceLinkedIds(item, labels))
      .filter((item) => item !== "" && item !== null && item !== undefined);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, replaceLinkedIds(item, labels)])
        .filter(([, item]) => item !== "" && item !== null && item !== undefined)
    );
  }

  return value;
}

function fieldByName(table: SchemaTable, fieldName: string) {
  const normalized = normalizeFieldName(fieldName);
  return table.fields.find(
    (field) => normalizeFieldName(field.name) === normalized
  );
}

async function loadPrimaryLabels({
  baseId,
  token,
  table,
  recordIds,
}: {
  baseId: string;
  token: string;
  table: SchemaTable;
  recordIds: string[];
}) {
  const labels = new Map<string, string>();
  const primary = primaryField(table);
  if (!primary || recordIds.length === 0) return labels;

  for (let index = 0; index < recordIds.length; index += 20) {
    const chunk = recordIds.slice(index, index + 20);
    const formulaParts = chunk.map((id) => `RECORD_ID()='${id}'`);
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula:
        formulaParts.length === 1
          ? formulaParts[0]
          : `OR(${formulaParts.join(",")})`,
    });
    params.append("fields[]", primary.name);

    const response = await fetch(airtableUrl(baseId, table.name, params), {
      headers: airtableHeaders(token),
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      console.error(
        `Unable to resolve linked labels from ${table.name}:`,
        data?.error?.message || response.status
      );
      continue;
    }

    for (const record of data.records || []) {
      const label = firstText(record.fields?.[primary.name]);
      if (label) labels.set(String(record.id), label);
    }
  }

  return labels;
}

async function hydrateHistoryLinkedLabels({
  baseId,
  token,
  schema,
  rows,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  rows: AuditRow[];
}) {
  const idsByTable = new Map<string, Set<string>>();

  function addIds(tableId: string, value: unknown) {
    if (!tableId) return;
    const bucket = idsByTable.get(tableId) || new Set<string>();
    for (const id of collectRecordIdsDeep(value)) bucket.add(id);
    idsByTable.set(tableId, bucket);
  }

  for (const row of rows) {
    const sourceTable = schema.find(
      (table) => table.name === String(row.table_name || "")
    );
    if (!sourceTable) continue;

    addIds(sourceTable.id, row.record_id);

    const changedFields =
      row.changed_fields && typeof row.changed_fields === "object"
        ? (row.changed_fields as Record<string, unknown>)
        : {};

    for (const [fieldName, change] of Object.entries(changedFields)) {
      const field = fieldByName(sourceTable, fieldName);
      if (
        field?.type === "multipleRecordLinks" &&
        field.options?.linkedTableId
      ) {
        addIds(field.options.linkedTableId, change);
      }
    }
  }

  const labelsByTable = new Map<string, Map<string, string>>();

  for (const [tableId, ids] of idsByTable) {
    const table = schema.find((item) => item.id === tableId);
    if (!table) continue;

    labelsByTable.set(
      tableId,
      await loadPrimaryLabels({
        baseId,
        token,
        table,
        recordIds: Array.from(ids),
      })
    );
  }

  return rows.map((row) => {
    const sourceTable = schema.find(
      (table) => table.name === String(row.table_name || "")
    );
    if (!sourceTable) return row;

    const sourceLabels = labelsByTable.get(sourceTable.id) || new Map();
    const recordId = String(row.record_id || "");
    const resolvedRecordLabel = sourceLabels.get(recordId) || "";

    const hydrateFieldObject = (value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }

      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([fieldName, fieldValue]) => {
            const field = fieldByName(sourceTable, fieldName);
            const linkedTableId =
              field?.type === "multipleRecordLinks"
                ? field.options?.linkedTableId || ""
                : "";

            if (!linkedTableId) return [fieldName, fieldValue];

            return [
              fieldName,
              replaceLinkedIds(
                fieldValue,
                labelsByTable.get(linkedTableId) || new Map()
              ),
            ];
          }
        )
      );
    };

    return {
      ...row,
      record_label:
        !row.record_label || isAirtableRecordId(row.record_label)
          ? resolvedRecordLabel || row.record_label
          : row.record_label,
      changed_fields: hydrateFieldObject(row.changed_fields),
      old_data: hydrateFieldObject(row.old_data),
      new_data: hydrateFieldObject(row.new_data),
    };
  });
}


function isOrderEntryTableName(tableName: string) {
  return normalizeFieldName(tableName).includes("orderentry");
}

function findOrderItemSkuField(table: SchemaTable) {
  const exactCandidates = new Set([
    "sku",
    "itemcode",
    "itemsku",
    "productcode",
    "productsku",
    "product",
  ]);

  return (
    table.fields.find((field) =>
      exactCandidates.has(normalizeFieldName(field.name))
    ) ||
    table.fields.find((field) => {
      const normalized = normalizeFieldName(field.name);
      return normalized.includes("sku") || normalized === "itemcode";
    })
  );
}

function extractSkuFromHydratedRow(row: AuditRow) {
  const skuNames = new Set([
    "sku",
    "itemcode",
    "itemsku",
    "productcode",
    "productsku",
    "product",
  ]);

  const sources = [row.changed_fields, row.new_data, row.old_data];

  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      continue;
    }

    for (const [fieldName, rawValue] of Object.entries(
      source as Record<string, unknown>
    )) {
      if (!skuNames.has(normalizeFieldName(fieldName))) continue;

      if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
        const change = rawValue as Record<string, unknown>;
        const changedValue =
          change.new ?? change.to ?? change.old ?? change.from ?? rawValue;
        const label = firstText(changedValue);
        if (label && !isAirtableRecordId(label)) return label;
      }

      const label = firstText(rawValue);
      if (label && !isAirtableRecordId(label)) return label;
    }
  }

  return "";
}

async function resolveOrderItemSkus({
  baseId,
  token,
  schema,
  rows,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  rows: AuditRow[];
}) {
  const recordIdsByTable = new Map<string, Set<string>>();

  for (const row of rows) {
    const tableName = String(row.table_name || "");
    const recordId = String(row.record_id || "");

    if (!isOrderEntryTableName(tableName) || !isAirtableRecordId(recordId)) {
      continue;
    }

    const bucket = recordIdsByTable.get(tableName) || new Set<string>();
    bucket.add(recordId);
    recordIdsByTable.set(tableName, bucket);
  }

  const result = new Map<string, string>();

  for (const [tableName, recordIds] of recordIdsByTable) {
    const table = schema.find((item) => item.name === tableName);
    if (!table) continue;

    const skuField = findOrderItemSkuField(table);
    if (!skuField) continue;

    const rawSkuByRecord = new Map<string, unknown>();
    const ids = Array.from(recordIds);

    for (let index = 0; index < ids.length; index += 20) {
      const chunk = ids.slice(index, index + 20);
      const formulaParts = chunk.map((id) => `RECORD_ID()='${id}'`);
      const params = new URLSearchParams({
        pageSize: "100",
        filterByFormula:
          formulaParts.length === 1
            ? formulaParts[0]
            : `OR(${formulaParts.join(",")})`,
      });
      params.append("fields[]", skuField.name);

      const response = await fetch(airtableUrl(baseId, table.name, params), {
        headers: airtableHeaders(token),
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        console.error(
          `Unable to resolve order-item SKU from ${table.name}:`,
          data?.error?.message || response.status
        );
        continue;
      }

      for (const record of data.records || []) {
        rawSkuByRecord.set(
          String(record.id || ""),
          record.fields?.[skuField.name]
        );
      }
    }

    let linkedLabels = new Map<string, string>();

    if (skuField.type === "multipleRecordLinks" && skuField.options?.linkedTableId) {
      const linkedTable = schema.find(
        (item) => item.id === skuField.options?.linkedTableId
      );
      const linkedIds = Array.from(
        new Set(
          Array.from(rawSkuByRecord.values()).flatMap((value) =>
            linkedRecordIds(value)
          )
        )
      );

      if (linkedTable && linkedIds.length > 0) {
        linkedLabels = await loadPrimaryLabels({
          baseId,
          token,
          table: linkedTable,
          recordIds: linkedIds,
        });
      }
    }

    for (const [recordId, rawSku] of rawSkuByRecord) {
      let label = "";

      if (linkedLabels.size > 0) {
        label = linkedRecordIds(rawSku)
          .map((id) => linkedLabels.get(id) || "")
          .filter(Boolean)
          .join(", ");
      } else {
        label = firstText(rawSku);
      }

      if (label && !isAirtableRecordId(label)) {
        result.set(`${tableName}:${recordId}`, label);
      }
    }
  }

  return result;
}

async function resolveOrderRecordContext({
  baseId,
  token,
  baseName,
  configuredOrderEntry,
  configuredInvoice,
  orderNo,
}: {
  baseId: string;
  token: string;
  baseName: string;
  configuredOrderEntry: string;
  configuredInvoice: string;
  orderNo: string;
}) {
  const schema = await getSchema(baseId, token);
  const normalizedBaseName = baseName.trim().toLowerCase();
  const isI5qDqBase =
    normalizedBaseName.includes("i5q") ||
    normalizedBaseName.includes("dq") ||
    normalizedBaseName.includes("04-10-2026");

  const orderEntryTableName = isI5qDqBase
    ? "DQ Order Entry"
    : configuredOrderEntry || "BS Order Entry";
  const invoiceTableName = isI5qDqBase
    ? "DQ Invoice"
    : configuredInvoice || "BS Invoice";

  const orderEntryTable = schema.find(
    (table) => table.name === orderEntryTableName
  );
  const invoiceTable = schema.find(
    (table) => table.name === invoiceTableName
  );

  if (!orderEntryTable || !invoiceTable) {
    return {
      invoiceId: "",
      itemRecordIds: [] as string[],
    };
  }

  const invoicePrimary = primaryField(invoiceTable);
  const invoiceLinkField = orderEntryTable.fields.find(
    (field) =>
      field.type === "multipleRecordLinks" &&
      field.options?.linkedTableId === invoiceTable.id
  );

  if (!invoicePrimary || !invoiceLinkField) {
    return {
      invoiceId: "",
      itemRecordIds: [] as string[],
    };
  }

  const invoiceParams = new URLSearchParams({
    pageSize: "2",
    filterByFormula: `LOWER({${invoicePrimary.name}})=LOWER('${escapeAirtableString(orderNo)}')`,
  });
  invoiceParams.append("fields[]", invoicePrimary.name);

  const invoiceResponse = await fetch(
    airtableUrl(baseId, invoiceTable.name, invoiceParams),
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );
  const invoiceData = await invoiceResponse.json();

  if (!invoiceResponse.ok) {
    throw new Error(
      invoiceData?.error?.message || "Unable to resolve order for history"
    );
  }

  const invoiceId = String(invoiceData.records?.[0]?.id || "");

  if (!invoiceId) {
    return {
      invoiceId: "",
      itemRecordIds: [] as string[],
    };
  }

  const itemRecordIds: string[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    params.append("fields[]", invoiceLinkField.name);
    if (offset) params.set("offset", offset);

    const response = await fetch(
      airtableUrl(baseId, orderEntryTable.name, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || "Unable to resolve order items for history"
      );
    }

    for (const record of data.records || []) {
      const linkedIds = linkedRecordIds(
        record.fields?.[invoiceLinkField.name]
      );

      if (linkedIds.includes(invoiceId)) {
        itemRecordIds.push(String(record.id));
      }
    }

    offset = String(data.offset || "");
  } while (offset);

  return {
    invoiceId,
    itemRecordIds,
  };
}

export async function GET(request: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view order history",
        },
        { status: 403 }
      );
    }

    const orderNo =
      request.nextUrl.searchParams.get("orderNo")?.trim() || "";

    if (!orderNo) {
      return NextResponse.json(
        {
          success: false,
          message: "Order number required",
        },
        { status: 400 }
      );
    }

    const context = await resolveOrderRecordContext({
      baseId: airtable.baseId,
      token: airtable.token,
      baseName: airtable.baseName || "",
      configuredOrderEntry: airtable.tables?.orderEntry || "",
      configuredInvoice: airtable.tables?.invoice || "",
      orderNo,
    });

    const commonQuery = {
      baseId: airtable.baseId,
      module: "",
      action: "",
      company: "",
      table: "",
      user: "",
      operation: "",
      from: "",
      to: "",
      page: 1,
      limit: 100,
    };

    const [directResult, linkedResult] = await Promise.all([
      queryAuditEvents({
        ...commonQuery,
        record: orderNo,
        recordIds: [
          context.invoiceId,
          ...context.itemRecordIds,
        ].filter(Boolean),
      }),
      context.invoiceId
        ? queryAuditEvents({
            ...commonQuery,
            record: context.invoiceId,
            recordIds: [],
          })
        : Promise.resolve({ rows: [] }),
    ]);

    const mergedRows = Array.from(
      new Map(
        [...directResult.rows, ...linkedResult.rows].map((row) => [
          String(row.id || ""),
          row,
        ])
      ).values()
    ).sort((first, second) =>
      String(second.created_at || "").localeCompare(
        String(first.created_at || "")
      )
    );

    const schema = await getSchema(airtable.baseId, airtable.token);
    const hydratedRows = await hydrateHistoryLinkedLabels({
      baseId: airtable.baseId,
      token: airtable.token,
      schema,
      rows: mergedRows.slice(0, 100),
    });
    const itemSkuByRecord = await resolveOrderItemSkus({
      baseId: airtable.baseId,
      token: airtable.token,
      schema,
      rows: hydratedRows,
    });
    const historyUserNames = await loadOrderHistoryUserNames(hydratedRows);

    const history = hydratedRows.map((row) => ({
      id: String(row.id || ""),
      date: String(row.created_at || ""),
      user: resolveOrderHistoryUserName(row, historyUserNames),
      role: String(row.actor_role || "System"),
      module: String(row.module || ""),
      action: String(row.action || ""),
      operation: String(row.operation || ""),
      table: String(row.table_name || ""),
      recordId: String(row.record_id || ""),
      recordLabel: String(row.record_label || ""),
      itemSku:
        itemSkuByRecord.get(
          `${String(row.table_name || "")}:${String(row.record_id || "")}`
        ) || extractSkuFromHydratedRow(row),
      oldValue: row.old_data,
      newValue: row.new_data,
      changedFields: row.changed_fields,
      source: String(row.source_host || ""),
    }));

    return NextResponse.json({
      success: true,
      history,
      matchedRecords: {
        invoice: context.invoiceId ? 1 : 0,
        items: context.itemRecordIds.length,
      },
    });
  } catch (error) {
    console.error("Order history error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "History loading failed",
      },
      { status: 500 }
    );
  }
}
