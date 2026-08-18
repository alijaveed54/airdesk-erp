import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type SessionBase = {
  baseName?: string;
  baseId?: string;
  airtableToken?: string;
  invoiceTable?: string;
};

type SchemaChoice = {
  name?: string;
};

type SchemaField = {
  id?: string;
  name?: string;
  type?: string;
  options?: {
    choices?: SchemaChoice[];
    linkedTableId?: string;
  };
};

type SchemaTable = {
  id?: string;
  name?: string;
  primaryFieldId?: string;
  fields?: SchemaField[];
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type StoreOptionsResult = {
  options: string[];
  tableName: string;
  fieldName: string;
  cacheable: boolean;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const schemaCache = new Map<string, CacheEntry<SchemaTable[]>>();
const schemaRequestCache = new Map<string, Promise<SchemaTable[]>>();
const storeOptionsCache = new Map<
  string,
  CacheEntry<Omit<StoreOptionsResult, "cacheable">>
>();
const storeOptionsRequestCache = new Map<string, Promise<StoreOptionsResult>>();

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function uniqueOptions(values: unknown[]) {
  const map = new Map<string, string>();

  for (const rawValue of values) {
    const value = String(rawValue ?? "").trim();
    if (!value) continue;

    // Do not expose raw Airtable linked-record IDs as store names.
    if (/^rec[a-zA-Z0-9]+$/.test(value)) continue;

    const key = value.toLowerCase();
    if (!map.has(key)) map.set(key, value);
  }

  return Array.from(map.values()).sort((a, b) =>
    a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function valuesFromField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => valuesFromField(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidate =
      record.name ??
      record.value ??
      record.label ??
      record.text ??
      "";

    return candidate ? [String(candidate)] : [];
  }

  const text = String(value ?? "").trim();
  return text ? [text] : [];
}

function resolveToken(base: SessionBase) {
  return (
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    base.airtableToken ||
    ""
  );
}

function preferredInvoiceNames(baseName: string) {
  const normalized = normalize(baseName);

  if (
    normalized.includes("i5q") ||
    normalized.includes("dq")
  ) {
    return ["DQ Invoice", "BS Invoice", "Invoice"];
  }

  if (normalized.includes("fab")) {
    return ["FAB Invoice", "BS Invoice", "Invoice"];
  }

  if (normalized.includes("tat")) {
    return ["TAT Invoice", "BS Invoice", "Invoice"];
  }

  return ["BS Invoice", "Invoice"];
}

function findInvoiceTable(
  tables: SchemaTable[],
  base: SessionBase,
): SchemaTable | undefined {
  const configured = String(base.invoiceTable || "").trim();

  if (configured) {
    const configuredTable = tables.find(
      (table) => normalize(table.name) === normalize(configured),
    );

    if (configuredTable) return configuredTable;
  }

  for (const preferred of preferredInvoiceNames(
    String(base.baseName || ""),
  )) {
    const match = tables.find(
      (table) => normalize(table.name) === normalize(preferred),
    );

    if (match) return match;
  }

  return tables.find((table) =>
    normalize(table.name).includes("invoice"),
  );
}

function findStoreField(fields: SchemaField[]) {
  const candidates = [
    "Select Store",
    "Store",
    "Store Name",
    "Select_Store",
    "Sales Channel",
  ];

  for (const candidate of candidates) {
    const match = fields.find(
      (field) => normalize(field.name) === normalize(candidate),
    );

    if (match) return match;
  }

  return undefined;
}

async function fetchJson(url: string, token: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        data?.error?.error?.message ||
        "Airtable request failed",
    );
  }

  return data;
}

async function loadSchema(baseId: string, token: string) {
  const now = Date.now();
  const cached = schemaCache.get(baseId);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inFlight = schemaRequestCache.get(baseId);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const schemaUrl =
      `https://api.airtable.com/v0/meta/bases/` +
      `${encodeURIComponent(baseId)}/tables`;
    const schema = await fetchJson(schemaUrl, token);
    const tables = (schema.tables || []) as SchemaTable[];

    schemaCache.set(baseId, {
      value: tables,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return tables;
  })();

  schemaRequestCache.set(baseId, request);

  try {
    return await request;
  } finally {
    schemaRequestCache.delete(baseId);
  }
}

function storeOptionsCacheKey(baseId: string, base: SessionBase) {
  return [
    baseId,
    normalize(base.baseName),
    normalize(base.invoiceTable),
  ].join("|");
}

async function loadObservedStoreValues({
  baseId,
  token,
  tableName,
  fieldName,
}: {
  baseId: string;
  token: string;
  tableName: string;
  fieldName: string;
}) {
  const values: string[] = [];
  let offset = "";
  let page = 0;

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.append("fields[]", fieldName);

    if (offset) {
      params.set("offset", offset);
    }

    const url =
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/` +
      `${encodeURIComponent(tableName)}?${params.toString()}`;

    const data = await fetchJson(url, token);

    for (const record of data.records || []) {
      values.push(
        ...valuesFromField(record?.fields?.[fieldName]),
      );
    }

    offset = String(data.offset || "");
    page += 1;

    // Store options do not need an unbounded invoice scan.
    // 500 records is enough as a safe fallback when schema choices are absent.
  } while (offset && page < 5);

  return values;
}

async function loadLinkedStoreNames({
  tables,
  field,
  baseId,
  token,
}: {
  tables: SchemaTable[];
  field: SchemaField;
  baseId: string;
  token: string;
}) {
  const linkedTableId = String(
    field.options?.linkedTableId || "",
  ).trim();

  if (!linkedTableId) return [];

  const linkedTable = tables.find(
    (table) => table.id === linkedTableId,
  );

  if (!linkedTable?.name) return [];

  const primaryField =
    linkedTable.fields?.find(
      (item) => item.id === linkedTable.primaryFieldId,
    ) ||
    linkedTable.fields?.[0];

  if (!primaryField?.name) return [];

  const values: string[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.append("fields[]", primaryField.name);

    if (offset) {
      params.set("offset", offset);
    }

    const url =
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/` +
      `${encodeURIComponent(linkedTable.name)}?${params.toString()}`;

    const data = await fetchJson(url, token);

    for (const record of data.records || []) {
      values.push(
        ...valuesFromField(
          record?.fields?.[primaryField.name],
        ),
      );
    }

    offset = String(data.offset || "");
  } while (offset);

  return values;
}

async function resolveStoreOptions({
  tables,
  base,
  baseId,
  token,
}: {
  tables: SchemaTable[];
  base: SessionBase;
  baseId: string;
  token: string;
}): Promise<StoreOptionsResult> {
  const invoiceTable = findInvoiceTable(tables, base);

  if (!invoiceTable?.name) {
    return {
      options: [],
      tableName: "",
      fieldName: "",
      cacheable: false,
    };
  }

  const storeField = findStoreField(invoiceTable.fields || []);

  if (!storeField?.name) {
    return {
      options: [],
      tableName: invoiceTable.name,
      fieldName: "",
      cacheable: false,
    };
  }

  const configuredChoices =
    storeField.options?.choices
      ?.map((choice) => choice.name || "")
      .filter(Boolean) || [];

  let linkedStoreNames: string[] = [];
  let observedValues: string[] = [];
  let resolvedSuccessfully = configuredChoices.length > 0;

  if (storeField.options?.linkedTableId) {
    try {
      linkedStoreNames = await loadLinkedStoreNames({
        tables,
        field: storeField,
        baseId,
        token,
      });
      resolvedSuccessfully = true;
    } catch {
      // Preserve current behavior: fall back to observed invoice values.
    }
  }

  if (
    configuredChoices.length === 0 &&
    linkedStoreNames.length === 0
  ) {
    try {
      observedValues = await loadObservedStoreValues({
        baseId,
        token,
        tableName: invoiceTable.name,
        fieldName: storeField.name,
      });
      resolvedSuccessfully = true;
    } catch {
      // Preserve current behavior: return empty options instead of breaking Invoice Basic.
    }
  }

  return {
    options: uniqueOptions([
      ...configuredChoices,
      ...linkedStoreNames,
      ...observedValues,
    ]),
    tableName: invoiceTable.name,
    fieldName: storeField.name,
    cacheable: resolvedSuccessfully,
  };
}

export async function GET(request: Request) {
  try {
    const session = (await getSession()) as any;

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Not authenticated",
        },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const requestedBaseId = String(
      searchParams.get("baseId") || "",
    ).trim();

    const availableBases: SessionBase[] = [
      ...(Array.isArray(session.availableBases)
        ? session.availableBases
        : []),
      ...(Array.isArray(session.permissions)
        ? session.permissions
        : []),
    ];

    const uniqueBases = Array.from(
      new Map(
        availableBases
          .filter((base) => String(base?.baseId || "").trim())
          .map((base) => [
            String(base.baseId).trim(),
            base,
          ]),
      ).values(),
    );

    const selectedBaseId = String(
      session.selectedBase?.baseId || "",
    ).trim();

    const resolvedBaseId =
      requestedBaseId ||
      selectedBaseId ||
      String(uniqueBases[0]?.baseId || "").trim();

    if (!resolvedBaseId) {
      return NextResponse.json({
        success: true,
        options: [],
        message: "No active base is available",
      });
    }

    const base =
      uniqueBases.find(
        (item) =>
          String(item.baseId || "").trim() ===
          resolvedBaseId,
      ) ||
      (session.selectedBase?.baseId === resolvedBaseId
        ? (session.selectedBase as SessionBase)
        : undefined);

    if (!base) {
      return NextResponse.json(
        {
          success: false,
          message: "Base access denied",
        },
        { status: 403 },
      );
    }

    const token = resolveToken(base);

    if (!token) {
      throw new Error("Airtable token missing");
    }

    const cacheKey = storeOptionsCacheKey(resolvedBaseId, base);
    const cachedOptions = storeOptionsCache.get(cacheKey);
    const now = Date.now();

    if (cachedOptions && cachedOptions.expiresAt > now) {
      return NextResponse.json({
        success: true,
        options: cachedOptions.value.options,
        baseId: resolvedBaseId,
        baseName: String(base.baseName || ""),
        tableName: cachedOptions.value.tableName,
        fieldName: cachedOptions.value.fieldName,
      });
    }

    const inFlightRequest = storeOptionsRequestCache.get(cacheKey);

let resolved: StoreOptionsResult;

if (inFlightRequest) {
  try {
    resolved = await inFlightRequest;
  } finally {
    if (storeOptionsRequestCache.get(cacheKey) === inFlightRequest) {
      storeOptionsRequestCache.delete(cacheKey);
    }
  }
} else {
  const newRequest = (async () => {
    const tables = await loadSchema(resolvedBaseId, token);

    return resolveStoreOptions({
      tables,
      base,
      baseId: resolvedBaseId,
      token,
    });
  })();

  storeOptionsRequestCache.set(cacheKey, newRequest);

  try {
    resolved = await newRequest;
  } finally {
    if (storeOptionsRequestCache.get(cacheKey) === newRequest) {
      storeOptionsRequestCache.delete(cacheKey);
    }
  }
}

    if (!resolved.tableName) {
      return NextResponse.json({
        success: true,
        options: [],
        baseId: resolvedBaseId,
        message: "Invoice table not found",
      });
    }

    if (!resolved.fieldName) {
      return NextResponse.json({
        success: true,
        options: [],
        baseId: resolvedBaseId,
        tableName: resolved.tableName,
        message: "Store field not found",
      });
    }

    if (resolved.cacheable) {
      storeOptionsCache.set(cacheKey, {
        value: {
          options: resolved.options,
          tableName: resolved.tableName,
          fieldName: resolved.fieldName,
        },
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return NextResponse.json({
      success: true,
      options: resolved.options,
      baseId: resolvedBaseId,
      baseName: String(base.baseName || ""),
      tableName: resolved.tableName,
      fieldName: resolved.fieldName,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Store loading failed",
      },
      { status: 500 },
    );
  }
}
