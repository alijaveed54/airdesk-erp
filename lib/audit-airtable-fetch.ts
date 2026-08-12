import {
  buildFieldChanges,
  redactAuditValue,
} from "@/lib/audit-redaction";
import {
  getAuditActor,
  getAuditSource,
  insertAuditEvents,
} from "@/lib/audit-db";
import type {
  AuditEvent,
  AuditOperation,
  JsonValue,
} from "@/lib/audit-types";

type AirtableRecord = {
  id: string;
  fields?: Record<string, unknown>;
  deleted?: boolean;
};

type AirtableTarget = {
  baseId: string;
  tableName: string;
  recordId: string;
  url: URL;
};

const MUTATION_METHODS = new Set([
  "POST",
  "PATCH",
  "DELETE",
]);

const EXCLUDED_TABLE_PARTS = [
  "facebook",
  "activity log",
  "audit log",
  "audit_events",
];

const ORIGINAL_FETCH_KEY =
  Symbol.for(
    "mysmar.audit.original-fetch"
  );
const INSTALLED_KEY =
  Symbol.for(
    "mysmar.audit.fetch-installed"
  );

type AuditGlobal = typeof globalThis & {
  [key: symbol]: unknown;
};

function nativeFetch(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const globalObject =
    globalThis as AuditGlobal;
  const original =
    globalObject[
      ORIGINAL_FETCH_KEY
    ];

  if (typeof original === "function") {
    return (
      original as typeof fetch
    )(input, init);
  }

  return globalThis.fetch(
    input,
    init
  );
}

export function installGlobalAirtableAudit() {
  const globalObject =
    globalThis as AuditGlobal;

  if (globalObject[INSTALLED_KEY]) {
    return;
  }

  globalObject[ORIGINAL_FETCH_KEY] =
    globalThis.fetch.bind(
      globalThis
    );
  globalObject[INSTALLED_KEY] = true;
  globalThis.fetch =
    auditedFetch as typeof fetch;
}

function inputUrl(
  input: RequestInfo | URL
) {
  if (input instanceof URL) {
    return input.toString();
  }

  if (
    typeof input === "string"
  ) {
    return input;
  }

  return input.url;
}

function parseAirtableTarget(
  input: RequestInfo | URL
): AirtableTarget | null {
  try {
    const url = new URL(
      inputUrl(input)
    );

    if (
      url.hostname !==
      "api.airtable.com"
    ) {
      return null;
    }

    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) =>
        decodeURIComponent(part)
      );

    if (
      parts[0] !== "v0" ||
      !parts[1] ||
      !parts[2] ||
      parts[1] === "meta"
    ) {
      return null;
    }

    return {
      baseId: parts[1],
      tableName: parts[2],
      recordId: parts[3] || "",
      url,
    };
  } catch {
    return null;
  }
}

function isExcludedTable(
  tableName: string
) {
  const normalized = tableName
    .trim()
    .toLowerCase();

  return EXCLUDED_TABLE_PARTS.some(
    (part) =>
      normalized.includes(part)
  );
}

function parseJsonBody(
  body: BodyInit | null | undefined
) {
  if (
    typeof body !== "string" ||
    !body.trim()
  ) {
    return null;
  }

  try {
    return JSON.parse(body) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function responseRecords(
  data: unknown
): AirtableRecord[] {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return [];
  }

  const object = data as Record<
    string,
    unknown
  >;

  if (Array.isArray(object.records)) {
    return object.records.filter(
      (item): item is AirtableRecord =>
        Boolean(
          item &&
          typeof item === "object" &&
          typeof (
            item as AirtableRecord
          ).id === "string"
        )
    );
  }

  if (typeof object.id === "string") {
    return [
      object as unknown as AirtableRecord,
    ];
  }

  return [];
}

function requestRecordMap(
  body: Record<
    string,
    unknown
  > | null,
  pathRecordId: string
) {
  const output = new Map<
    string,
    Record<string, unknown>
  >();

  if (
    body &&
    Array.isArray(body.records)
  ) {
    for (const item of body.records) {
      if (
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const record = item as Record<
        string,
        unknown
      >;
      const recordId = String(
        record.id || ""
      ).trim();
      const fields =
        record.fields &&
        typeof record.fields ===
          "object" &&
        !Array.isArray(record.fields)
          ? (record.fields as Record<
              string,
              unknown
            >)
          : {};

      if (recordId) {
        output.set(recordId, fields);
      }
    }
  }

  if (
    pathRecordId &&
    body?.fields &&
    typeof body.fields === "object" &&
    !Array.isArray(body.fields)
  ) {
    output.set(
      pathRecordId,
      body.fields as Record<
        string,
        unknown
      >
    );
  }

  return output;
}

function targetRecordIds({
  method,
  target,
  requestMap,
}: {
  method: string;
  target: AirtableTarget;
  requestMap: Map<
    string,
    Record<string, unknown>
  >;
}) {
  const ids = new Set<string>();

  if (target.recordId) {
    ids.add(target.recordId);
  }

  for (const recordId of
    requestMap.keys()) {
    ids.add(recordId);
  }

  if (method === "DELETE") {
    for (const recordId of
      target.url.searchParams.getAll(
        "records[]"
      )) {
      if (recordId) {
        ids.add(recordId);
      }
    }
  }

  return Array.from(ids);
}

async function loadOldRecords({
  target,
  recordIds,
  headers,
}: {
  target: AirtableTarget;
  recordIds: string[];
  headers?: HeadersInit;
}) {
  const output = new Map<
    string,
    AirtableRecord
  >();

  if (!recordIds.length) {
    return output;
  }

  const requestHeaders = new Headers(
    headers
  );
  requestHeaders.delete(
    "content-length"
  );

  const safeIds = recordIds
    .map((recordId) =>
      recordId.replace(
        /'/g,
        "\\'"
      )
    );
  const formula =
    safeIds.length === 1
      ? `RECORD_ID()='${safeIds[0]}'`
      : `OR(${safeIds
          .map(
            (recordId) =>
              `RECORD_ID()='${recordId}'`
          )
          .join(",")})`;
  const params = new URLSearchParams({
    pageSize: "100",
    filterByFormula: formula,
  });
  const url =
    `https://api.airtable.com/v0/` +
    `${encodeURIComponent(
      target.baseId
    )}/` +
    `${encodeURIComponent(
      target.tableName
    )}?${params.toString()}`;

  try {
    const response =
      await nativeFetch(url, {
        method: "GET",
        headers: requestHeaders,
        cache: "no-store",
      });

    if (!response.ok) {
      console.warn(
        `Audit pre-read failed for ${target.tableName}: HTTP ${response.status}`
      );
      return output;
    }

    const data =
      await response.json() as {
        records?: AirtableRecord[];
      };

    for (const record of
      data.records || []) {
      if (record?.id) {
        output.set(
          record.id,
          record
        );
      }
    }
  } catch (error) {
    console.warn(
      `Audit pre-read failed for ${target.tableName}:`,
      error
    );
  }

  return output;
}

function firstText(
  value: unknown
): string {
  if (Array.isArray(value)) {
    return firstText(value[0]);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const object = value as Record<
      string,
      unknown
    >;

    return firstText(
      object.name ??
      object.value ??
      object.text ??
      object.id
    );
  }

  return String(value ?? "").trim();
}

function recordLabel(
  fields: Record<string, unknown>,
  recordId: string
) {
  const candidates = [
    "Order No.",
    "Order No",
    "Order Number",
    "order_no",
    "Invoice No.",
    "Invoice No",
    "Invoice Number",
    "Number",
    "number",
    "SKU",
    "Item Code",
    "Bill No",
    "Bill No.",
    "bill_no",
    "Username",
    "Name",
    "Customer Name",
    "Contact",
  ];

  const normalized = new Map(
    Object.keys(fields).map((key) => [
      key.trim().toLowerCase(),
      key,
    ])
  );

  for (const candidate of candidates) {
    const actual = normalized.get(
      candidate.toLowerCase()
    );

    if (!actual) {
      continue;
    }

    const value = firstText(
      fields[actual]
    );

    if (value) {
      return value;
    }
  }

  return recordId;
}

function moduleForTable(
  tableName: string
) {
  const table = tableName
    .trim()
    .toLowerCase();

  if (table.includes("order entry")) {
    return "Order Items";
  }

  if (
    table.includes("invoice") ||
    table === "orders" ||
    table.endsWith(" orders")
  ) {
    return "Orders";
  }

  if (table.includes("customer")) {
    return "Customers";
  }

  if (table.includes("product")) {
    return "Products";
  }

  if (
    table.includes("stock") ||
    table.includes("inventory")
  ) {
    return "Inventory";
  }

  if (table.includes("supplier")) {
    return "Suppliers";
  }

  if (
    table.includes("user") ||
    table.includes("base access")
  ) {
    return "Users";
  }

  return tableName;
}

function entityForTable(
  tableName: string
) {
  const moduleName =
    moduleForTable(tableName);

  switch (moduleName) {
    case "Order Items":
      return "Order Item";
    case "Orders":
      return "Order";
    case "Customers":
      return "Customer";
    case "Products":
      return "Product";
    case "Inventory":
      return "Inventory Record";
    case "Suppliers":
      return "Supplier Record";
    case "Users":
      return tableName
        .toLowerCase()
        .includes("access")
        ? "User Access"
        : "User";
    default:
      return "Record";
  }
}


function isEmptyAuditValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function isSupplierActivityUndo(
  changedFields: Record<string, unknown>
) {
  for (const [fieldName, rawChange] of Object.entries(changedFields)) {
    const normalizedName = fieldName
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ");

    if (normalizedName !== "supplier activity") {
      continue;
    }

    if (
      !rawChange ||
      typeof rawChange !== "object" ||
      Array.isArray(rawChange)
    ) {
      continue;
    }

    const change = rawChange as {
      old?: unknown;
      new?: unknown;
    };

    return (
      !isEmptyAuditValue(change.old) &&
      isEmptyAuditValue(change.new)
    );
  }

  return false;
}

function actionForEvent({
  operation,
  tableName,
  changedFields,
}: {
  operation: AuditOperation;
  tableName: string;
  changedFields: Record<
    string,
    unknown
  >;
}) {
  const entity = entityForTable(
    tableName
  );

  if (operation === "CREATE") {
    return `${entity} Created`;
  }

  if (operation === "DELETE") {
    return `${entity} Deleted`;
  }

  if (isSupplierActivityUndo(changedFields)) {
    return "Supplier Activity Undo";
  }

  const names = Object.keys(
    changedFields
  )
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  const rules: Array<
    [RegExp, string]
  > = [
    [
      /order\s*(no|number)/,
      "Order Number Changed",
    ],
    [
      /order\s*status|status/,
      "Order Status Changed",
    ],
    [
      /courier|driver/,
      "Courier Changed",
    ],
    [
      /dispatch/,
      "Dispatch Updated",
    ],
    [
      /received/,
      "Received Status Updated",
    ],
    [
      /sold\s*out/,
      "Sold Out Updated",
    ],
    [
      /stock\s*out/,
      "Stock Out Updated",
    ],
    [
      /supplier/,
      "Supplier Changed",
    ],
    [
      /quantity|\bqty\b/,
      "Quantity Changed",
    ],
    [
      /bill\s*(no|number)/,
      "Bill Number Changed",
    ],
    [
      /password/,
      "Password Changed",
    ],
    [
      /role|permission|base\s*access/,
      "User Access Changed",
    ],
    [
      /price|amount|vat|discount|shipping|advance/,
      "Financial Field Changed",
    ],
  ];

  for (const [pattern, action] of rules) {
    if (pattern.test(names)) {
      return action;
    }
  }

  return `${entity} Updated`;
}

function isAutomaticLoginMetadataOnly({
  operation,
  tableName,
  changedFields,
}: {
  operation: AuditOperation;
  tableName: string;
  changedFields: Record<
    string,
    unknown
  >;
}) {
  if (
    operation !== "UPDATE" ||
    !tableName
      .trim()
      .toLowerCase()
      .includes("user")
  ) {
    return false;
  }

  const keys = Object.keys(
    changedFields
  );

  return (
    keys.length > 0 &&
    keys.every((key) => {
      const normalized = key
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ");

      return (
        normalized === "last login" ||
        normalized === "login count"
      );
    })
  );
}

function operationFromMethod(
  method: string
): AuditOperation {
  if (method === "POST") {
    return "CREATE";
  }

  if (method === "DELETE") {
    return "DELETE";
  }

  return "UPDATE";
}


async function saveMutationAudit({
  method,
  target,
  oldRecords,
  requestMap,
  responseData,
}: {
  method: string;
  target: AirtableTarget;
  oldRecords: Map<
    string,
    AirtableRecord
  >;
  requestMap: Map<
    string,
    Record<string, unknown>
  >;
  responseData: unknown;
}) {
  const operation =
    operationFromMethod(method);
  const returned =
    responseRecords(responseData);
  const returnedMap = new Map(
    returned.map((record) => [
      record.id,
      record,
    ])
  );

  const ids = new Set<string>([
    ...oldRecords.keys(),
    ...requestMap.keys(),
    ...returnedMap.keys(),
  ]);

  if (
    method === "DELETE" &&
    !ids.size
  ) {
    for (const recordId of
      target.url.searchParams.getAll(
        "records[]"
      )) {
      ids.add(recordId);
    }
  }

  const actor = await getAuditActor(
    target.baseId
  );
  const now = new Date().toISOString();
  const eventGroupId =
    crypto.randomUUID();
  const moduleName =
    moduleForTable(target.tableName);
  const events: AuditEvent[] = [];

  for (const recordId of ids) {
    const oldRecord =
      oldRecords.get(recordId);
    const newRecord =
      returnedMap.get(recordId);
    const requestedFields =
      requestMap.get(recordId) || {};

    const oldFields =
      oldRecord?.fields || {};
    const newFields =
      operation === "DELETE"
        ? {}
        : newRecord?.fields ||
          requestedFields;

    const fieldNames =
      operation === "DELETE"
        ? Object.keys(oldFields)
        : Object.keys(
            requestedFields
          );

    const changedFields =
      buildFieldChanges({
        oldFields:
          operation === "CREATE"
            ? {}
            : oldFields,
        newFields:
          operation === "DELETE"
            ? {}
            : newFields,
        fieldNames:
          fieldNames.length
            ? fieldNames
            : undefined,
      });

    if (
      operation === "UPDATE" &&
      Object.keys(changedFields)
        .length === 0
    ) {
      continue;
    }

    if (
      isAutomaticLoginMetadataOnly({
        operation,
        tableName:
          target.tableName,
        changedFields,
      })
    ) {
      continue;
    }

    const changedKeys =
      Object.keys(changedFields);
    const changedOldFields =
      Object.fromEntries(
        changedKeys.map((key) => [
          key,
          oldFields[key],
        ])
      );
    const changedNewFields =
      Object.fromEntries(
        changedKeys.map((key) => [
          key,
          newFields[key],
        ])
      );

    const oldData =
      operation === "CREATE"
        ? null
        : redactAuditValue(
            operation === "UPDATE"
              ? changedOldFields
              : oldFields
          );
    const newData =
      operation === "DELETE"
        ? null
        : redactAuditValue(
            operation === "UPDATE"
              ? changedNewFields
              : newFields
          );

    const labelFields = {
      ...oldFields,
      ...newFields,
    };

    events.push({
      id: crypto.randomUUID(),
      eventGroupId,
      createdAt: now,
      actorUsername:
        actor.actorUsername,
      actorFullName:
        actor.actorFullName,
      actorRole: actor.actorRole,
      companyName:
        actor.companyName,
      baseId: target.baseId,
      tableName: target.tableName,
      recordId,
      recordLabel: recordLabel(
        labelFields,
        recordId
      ),
      module: moduleName,
      action: actionForEvent({
        operation,
        tableName:
          target.tableName,
        changedFields,
      }),
      operation,
      oldData,
      newData,
      changedFields,
      sourceHost: getAuditSource(),
      metadata: {
        airtableMethod: method,
        changedFieldNames:
          Object.keys(changedFields),
        tableName:
          target.tableName,
      },
    });
  }

  if (!events.length) {
    return;
  }

  await insertAuditEvents(events);
}

export async function auditedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = String(
    init?.method ||
    (
      typeof Request !==
        "undefined" &&
      input instanceof Request
        ? input.method
        : "GET"
    )
  ).toUpperCase();

  const target =
    parseAirtableTarget(input);

  if (
    !target ||
    !MUTATION_METHODS.has(method) ||
    isExcludedTable(
      target.tableName
    )
  ) {
    return nativeFetch(
      input,
      init
    );
  }

  const body = parseJsonBody(
    init?.body
  );
  const requestMap =
    requestRecordMap(
      body,
      target.recordId
    );
  const recordIds =
    targetRecordIds({
      method,
      target,
      requestMap,
    });

  const oldRecords =
    method === "POST"
      ? new Map<
          string,
          AirtableRecord
        >()
      : await loadOldRecords({
          target,
          recordIds,
          headers: init?.headers,
        });

  const response =
    await nativeFetch(
      input,
      init
    );

  if (!response.ok) {
    return response;
  }

  try {
    const clone = response.clone();
    const text = await clone.text();
    const data = text
      ? JSON.parse(text)
      : null;

    await saveMutationAudit({
      method,
      target,
      oldRecords,
      requestMap,
      responseData: data,
    });
  } catch (error) {
    console.error(
      "Automatic Airtable audit failed:",
      error
    );
  }

  return response;
}
