import { auditedFetch as fetch } from "@/lib/audit-airtable-fetch";
import {
  airtableHeaders,
  airtableUrl,
} from "@/lib/airtable";

type SchemaField = {
  id: string;
  name: string;
  type: string;
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

type SyncContext = {
  baseId: string;
  token: string;
  orderEntryTableName: string;
  invoiceTableName: string;
};

type ResolutionSchemaFailure = {
  reason: string;
};

type ResolutionSchemaSuccess = {
  schema: SchemaTable[];
  orderEntryTable: SchemaTable;
  invoiceTable: SchemaTable;
  entryInvoiceLink: SchemaField;
};

type SyncSchemaSuccess = ResolutionSchemaSuccess & {
  receivedWhField: SchemaField;
  invoiceInstockField: SchemaField;
  invoiceItemsLink?: SchemaField;
  invoicePrimaryField: SchemaField;
};

type ResolveContext = SyncContext & {
  recordIds: string[];
};

type CheckedInvoice = {
  invoiceId: string;
  orderLabel: string;
  previous: string;
  next: string;
  totalItems: number;
  inStockItems: number;
  strategy: string;
};

type SyncResult = {
  success: boolean;
  skipped: boolean;
  reason?: string;
  invoiceIds: string[];
  checked: CheckedInvoice[];
  updated: Array<{
    invoiceId: string;
    previous: string;
    next: string;
    totalItems: number;
    inStockItems: number;
    strategy: string;
  }>;
};

const schemaCache = new Map<string, SchemaTable[]>();

const READ_ONLY_TYPES = new Set([
  "formula",
  "rollup",
  "multipleLookupValues",
  "count",
  "createdTime",
  "lastModifiedTime",
  "createdBy",
  "lastModifiedBy",
  "autoNumber",
  "button",
]);

function normalizeName(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[.]+/g, "")
    .replace(/\s+/g, " ");
}

function firstText(value: unknown): string {
  if (Array.isArray(value)) {
    return firstText(value[0]);
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return firstText(
      source.name ??
        source.value ??
        source.text ??
        source.label ??
        source.id
    );
  }

  return String(value ?? "").trim();
}

function isYesValue(value: unknown): boolean {
  if (value === true || value === 1) return true;

  return [
    "yes",
    "true",
    "1",
    "checked",
    "received",
    "instock",
    "in stock",
  ].includes(firstText(value).toLowerCase());
}

function linkedRecordIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values
    .map((item) => firstText(item))
    .filter((item) => item.startsWith("rec"));
}

function makeRecordIdFormula(ids: string[]) {
  const formulas = ids.map(
    (id) => `RECORD_ID()='${String(id).replace(/'/g, "\\'")}'`
  );

  return formulas.length === 1
    ? formulas[0]
    : `OR(${formulas.join(",")})`;
}

function escapeFormulaText(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function chunks<T>(items: T[], size: number) {
  const output: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }

  return output;
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
    throw new Error(
      data?.error?.message ||
        data?.error?.error?.message ||
        "Unable to load Airtable schema for Instock sync"
    );
  }

  const tables = (data.tables || []) as SchemaTable[];
  schemaCache.set(baseId, tables);
  return tables;
}

function findField(
  fields: SchemaField[],
  candidates: string[],
  writableOnly = false
) {
  const lookup = new Map(
    fields.map((field) => [normalizeName(field.name), field])
  );

  for (const candidate of candidates) {
    const field = lookup.get(normalizeName(candidate));

    if (
      field &&
      (!writableOnly || !READ_ONLY_TYPES.has(field.type))
    ) {
      return field;
    }
  }

  return undefined;
}

function findLinkedField(
  sourceTable: SchemaTable,
  targetTable: SchemaTable,
  preferredNames: string[]
) {
  const fields = sourceTable.fields.filter(
    (field) =>
      field.type === "multipleRecordLinks" &&
      field.options?.linkedTableId === targetTable.id
  );

  if (fields.length <= 1) return fields[0];

  const preferred = preferredNames.map(normalizeName);

  return fields
    .map((field) => {
      const name = normalizeName(field.name);
      let score = 0;

      if (preferred.includes(name)) score += 500;
      if (preferred.some((item) => name.includes(item))) score += 200;
      if (name.includes("return")) score -= 1000;

      return { field, score };
    })
    .sort((first, second) => second.score - first.score)[0]?.field;
}

function valueForInstockField(
  field: SchemaField,
  value: "Full" | "Partial" | ""
): unknown {
  if (field.type === "singleSelect") {
    return value || null;
  }

  if (field.type === "multipleSelects") {
    return value ? [value] : [];
  }

  if (field.type === "checkbox") {
    return value === "Full";
  }

  return value;
}

function normalizedInstock(value: unknown) {
  const normalized = firstText(value).toLowerCase();

  if (normalized === "full") return "Full";
  if (normalized === "partial" || normalized === "partially") return "Partial";
  return "";
}

async function fetchRecordsByIds({
  baseId,
  token,
  tableName,
  ids,
  fields,
}: {
  baseId: string;
  token: string;
  tableName: string;
  ids: string[];
  fields: string[];
}) {
  const output: any[] = [];

  for (const idChunk of chunks(
    Array.from(new Set(ids.filter((id) => id.startsWith("rec")))),
    40
  )) {
    if (!idChunk.length) continue;

    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: makeRecordIdFormula(idChunk),
    });

    for (const fieldName of Array.from(new Set(fields.filter(Boolean)))) {
      params.append("fields[]", fieldName);
    }

    const response = await fetch(
      airtableUrl(baseId, tableName, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          `Unable to load records from ${tableName} for Instock sync`
      );
    }

    output.push(...(data.records || []));
  }

  return output;
}

async function fetchAllByFormula({
  baseId,
  token,
  tableName,
  formula,
  fields,
}: {
  baseId: string;
  token: string;
  tableName: string;
  formula: string;
  fields: string[];
}) {
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: formula,
    });

    for (const fieldName of Array.from(new Set(fields.filter(Boolean)))) {
      params.append("fields[]", fieldName);
    }

    if (offset) params.set("offset", offset);

    const response = await fetch(
      airtableUrl(baseId, tableName, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          `Unable to filter ${tableName} for Instock sync`
      );
    }

    records.push(...(data.records || []));
    offset = String(data.offset || "");
  } while (offset);

  return records;
}

async function getResolutionSchema({
  baseId,
  token,
  orderEntryTableName,
  invoiceTableName,
}: SyncContext): Promise<ResolutionSchemaSuccess | ResolutionSchemaFailure> {
  const schema = await getSchema(baseId, token);
  const orderEntryTable = schema.find(
    (table) => table.name === orderEntryTableName
  );
  const invoiceTable = schema.find(
    (table) => table.name === invoiceTableName
  );

  if (!orderEntryTable || !invoiceTable) {
    return {
      reason: `Order Entry or Invoice table not found (${orderEntryTableName} / ${invoiceTableName})`,
    } as const;
  }

  const entryInvoiceLink = findLinkedField(
    orderEntryTable,
    invoiceTable,
    ["Order Number", "Order No", "Invoice", "Order"]
  );

  if (!entryInvoiceLink) {
    return {
      reason: "Linked invoice field was not found in Order Entry",
    } as const;
  }

  return {
    schema,
    orderEntryTable,
    invoiceTable,
    entryInvoiceLink,
  } as const;
}

async function getSyncSchema(
  context: SyncContext
): Promise<SyncSchemaSuccess | ResolutionSchemaFailure> {
  const resolution = await getResolutionSchema(context);

  if ("reason" in resolution) {
    return resolution;
  }

  const receivedWhField = findField(resolution.orderEntryTable.fields, [
    "received_in_wh_1",
    "Received in WH 1",
    "Received In WH 1",
    "Received WH 1",
    "Warehouse Received",
  ]);
  const invoiceInstockField = findField(
    resolution.invoiceTable.fields,
    ["Instock", "In Stock", "Stock Status"],
    true
  );
  const invoiceItemsLink = findLinkedField(
    resolution.invoiceTable,
    resolution.orderEntryTable,
    ["SKU", "Items", "Order Items", "Order Entry"]
  );
  const invoicePrimaryField =
    resolution.invoiceTable.fields.find(
      (field) => field.id === resolution.invoiceTable.primaryFieldId
    ) || resolution.invoiceTable.fields[0];

  if (!receivedWhField) {
    return {
      reason: "Received in WH 1 field was not found in Order Entry",
    } as const;
  }

  if (!invoiceInstockField) {
    return {
      reason: "Writable Instock field was not found in Invoice",
    } as const;
  }

  if (!invoicePrimaryField) {
    return {
      reason: "Invoice primary field was not found",
    } as const;
  }

  return {
    ...resolution,
    receivedWhField,
    invoiceInstockField,
    invoiceItemsLink,
    invoicePrimaryField,
  } as const;
}

export async function resolveInvoiceIdsForOrderEntryRecords({
  baseId,
  token,
  orderEntryTableName,
  invoiceTableName,
  recordIds: incomingRecordIds,
}: ResolveContext): Promise<string[]> {
  const resolution = await getResolutionSchema({
    baseId,
    token,
    orderEntryTableName,
    invoiceTableName,
  });

  if ("reason" in resolution) {
    console.error("Instock invoice resolution skipped:", resolution.reason);
    return [];
  }

  const records = await fetchRecordsByIds({
    baseId,
    token,
    tableName: orderEntryTableName,
    ids: incomingRecordIds,
    fields: [resolution.entryInvoiceLink.name],
  });

  return Array.from(
    new Set(
      records.flatMap((record) =>
        linkedRecordIds(record.fields?.[resolution.entryInvoiceLink.name])
      )
    )
  );
}

async function loadInvoiceItems({
  baseId,
  token,
  orderEntryTableName,
  invoiceId,
  invoiceRecord,
  entryInvoiceLink,
  receivedWhField,
  invoiceItemsLink,
  invoicePrimaryField,
}: {
  baseId: string;
  token: string;
  orderEntryTableName: string;
  invoiceId: string;
  invoiceRecord: any;
  entryInvoiceLink: SchemaField;
  receivedWhField: SchemaField;
  invoiceItemsLink?: SchemaField;
  invoicePrimaryField: SchemaField;
}) {
  const requestedFields = [
    entryInvoiceLink.name,
    receivedWhField.name,
  ];

  if (invoiceItemsLink) {
    const reciprocalIds = linkedRecordIds(
      invoiceRecord.fields?.[invoiceItemsLink.name]
    );

    if (reciprocalIds.length) {
      const records = await fetchRecordsByIds({
        baseId,
        token,
        tableName: orderEntryTableName,
        ids: reciprocalIds,
        fields: requestedFields,
      });

      const linkedRecords = records.filter((record) =>
        linkedRecordIds(record.fields?.[entryInvoiceLink.name]).includes(
          invoiceId
        )
      );

      if (linkedRecords.length) {
        return {
          records: linkedRecords,
          strategy: `reciprocal:${invoiceItemsLink.name}`,
        };
      }
    }
  }

  const orderLabel = firstText(
    invoiceRecord.fields?.[invoicePrimaryField.name]
  );

  if (!orderLabel) {
    return {
      records: [],
      strategy: "invoice-primary-blank",
    };
  }

  const escapedOrderLabel = escapeFormulaText(orderLabel);
  const exactFormula =
    `LOWER(TRIM(ARRAYJOIN({${entryInvoiceLink.name}})))=` +
    `LOWER('${escapedOrderLabel}')`;

  try {
    const exactRecords = await fetchAllByFormula({
      baseId,
      token,
      tableName: orderEntryTableName,
      formula: exactFormula,
      fields: requestedFields,
    });

    const linkedRecords = exactRecords.filter((record) =>
      linkedRecordIds(record.fields?.[entryInvoiceLink.name]).includes(
        invoiceId
      )
    );

    if (linkedRecords.length) {
      return {
        records: linkedRecords,
        strategy: `formula-exact:${entryInvoiceLink.name}`,
      };
    }
  } catch (error) {
    console.error("Exact Instock formula lookup failed:", error);
  }

  const containsFormula =
    `FIND(LOWER('${escapedOrderLabel}'),` +
    `LOWER(ARRAYJOIN({${entryInvoiceLink.name}})))>0`;

  try {
    const containsRecords = await fetchAllByFormula({
      baseId,
      token,
      tableName: orderEntryTableName,
      formula: containsFormula,
      fields: requestedFields,
    });

    const linkedRecords = containsRecords.filter((record) =>
      linkedRecordIds(record.fields?.[entryInvoiceLink.name]).includes(
        invoiceId
      )
    );

    return {
      records: linkedRecords,
      strategy: linkedRecords.length
        ? `formula-contains:${entryInvoiceLink.name}`
        : "no-linked-items-found",
    };
  } catch (error) {
    console.error("Contains Instock formula lookup failed:", error);

    return {
      records: [],
      strategy: "formula-lookups-failed",
    };
  }
}

export async function syncInvoiceInstockStatuses({
  baseId,
  token,
  orderEntryTableName,
  invoiceTableName,
  invoiceIds: incomingInvoiceIds,
}: SyncContext & {
  invoiceIds: string[];
}): Promise<SyncResult> {
  const invoiceIds = Array.from(
    new Set(
      incomingInvoiceIds
        .map((id) => String(id || "").trim())
        .filter((id) => id.startsWith("rec"))
    )
  );

  if (!invoiceIds.length) {
    return {
      success: false,
      skipped: true,
      reason: "No linked invoice records were resolved",
      invoiceIds: [],
      checked: [],
      updated: [],
    };
  }

  const syncSchema = await getSyncSchema({
    baseId,
    token,
    orderEntryTableName,
    invoiceTableName,
  });

  if ("reason" in syncSchema) {
    return {
      success: false,
      skipped: true,
      reason: syncSchema.reason,
      invoiceIds,
      checked: [],
      updated: [],
    };
  }

  const invoiceFields = [
    syncSchema.invoicePrimaryField.name,
    syncSchema.invoiceInstockField.name,
    syncSchema.invoiceItemsLink?.name || "",
  ].filter(Boolean);

  const invoiceRecords = await fetchRecordsByIds({
    baseId,
    token,
    tableName: invoiceTableName,
    ids: invoiceIds,
    fields: invoiceFields,
  });

  const updates: Array<{
    id: string;
    fields: Record<string, unknown>;
  }> = [];
  const updated: SyncResult["updated"] = [];
  const checked: CheckedInvoice[] = [];

  for (const invoiceRecord of invoiceRecords) {
    const invoiceId = String(invoiceRecord.id || "");
    const orderLabel = firstText(
      invoiceRecord.fields?.[syncSchema.invoicePrimaryField.name]
    );

    const itemLoad = await loadInvoiceItems({
      baseId,
      token,
      orderEntryTableName,
      invoiceId,
      invoiceRecord,
      entryInvoiceLink: syncSchema.entryInvoiceLink,
      receivedWhField: syncSchema.receivedWhField,
      invoiceItemsLink: syncSchema.invoiceItemsLink,
      invoicePrimaryField: syncSchema.invoicePrimaryField,
    });

    const linkedItems = itemLoad.records;
    const inStockItems = linkedItems.filter((record) =>
      isYesValue(
        record.fields?.[syncSchema.receivedWhField.name]
      )
    ).length;

    const nextStatus: "Full" | "Partial" | "" =
      linkedItems.length > 0 && inStockItems === linkedItems.length
        ? "Full"
        : inStockItems > 0
          ? "Partial"
          : "";

    const previousStatus = normalizedInstock(
      invoiceRecord.fields?.[syncSchema.invoiceInstockField.name]
    );

    checked.push({
      invoiceId,
      orderLabel,
      previous: previousStatus,
      next: nextStatus,
      totalItems: linkedItems.length,
      inStockItems,
      strategy: itemLoad.strategy,
    });

    if (!linkedItems.length || previousStatus === nextStatus) {
      continue;
    }

    updates.push({
      id: invoiceId,
      fields: {
        [syncSchema.invoiceInstockField.name]:
          valueForInstockField(
            syncSchema.invoiceInstockField,
            nextStatus
          ),
      },
    });

    updated.push({
      invoiceId,
      previous: previousStatus,
      next: nextStatus,
      totalItems: linkedItems.length,
      inStockItems,
      strategy: itemLoad.strategy,
    });
  }

  for (const updateChunk of chunks(updates, 10)) {
    const response = await fetch(
      airtableUrl(baseId, invoiceTableName),
      {
        method: "PATCH",
        headers: airtableHeaders(token),
        cache: "no-store",
        body: JSON.stringify({
          records: updateChunk,
          typecast: true,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          "Unable to update Invoice Instock status"
      );
    }
  }

  const noItemsFound = checked.length > 0 &&
    checked.every((item) => item.totalItems === 0);

  return {
    success: !noItemsFound,
    skipped: noItemsFound,
    reason: noItemsFound
      ? "Invoice was resolved but its linked Order Entry items could not be loaded"
      : undefined,
    invoiceIds,
    checked,
    updated,
  };
}
