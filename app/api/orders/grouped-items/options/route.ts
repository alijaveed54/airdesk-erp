import { NextResponse } from "next/server";
import { getCurrentAirtableBase } from "@/lib/airtable";

const STATUS_FIELD_CANDIDATES = [
  "Order Status",
  "Order_status",
  "order_status",
  "Status",
];

const STORE_FIELD_CANDIDATES = [
  "Select Store",
  "Store",
  "Store Name",
  "StoreName",
];

type AirtableField = {
  name: string;
};

type AirtableTable = {
  name: string;
  fields?: AirtableField[];
};

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function findFieldName(fields: AirtableField[], candidates: string[]) {
  const fieldMap = new Map(
    fields.map((field) => [normalize(field.name), field.name]),
  );

  for (const candidate of candidates) {
    const match = fieldMap.get(normalize(candidate));
    if (match) return match;
  }

  return "";
}

function addValues(target: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) addValues(target, item);
    return;
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    addValues(
      target,
      objectValue.name ?? objectValue.value ?? objectValue.label,
    );
    return;
  }

  const text = String(value ?? "").trim();
  if (text) target.add(text);
}

async function loadSchema(
  baseId: string,
  token: string,
): Promise<AirtableTable[]> {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to load Airtable schema");
  }

  return data.tables || [];
}

async function collectTableOptions({
  baseId,
  token,
  tableName,
  statusField,
  storeField,
  statusSet,
  storeSet,
}: {
  baseId: string;
  token: string;
  tableName: string;
  statusField: string;
  storeField: string;
  statusSet: Set<string>;
  storeSet: Set<string>;
}) {
  if (!statusField && !storeField) return;

  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    if (statusField) params.append("fields[]", statusField);
    if (storeField && storeField !== statusField)
      params.append("fields[]", storeField);
    if (offset) params.set("offset", offset);

    const response = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(
        tableName,
      )}?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Unable to load options from ${tableName}`,
      );
    }

    for (const record of data.records || []) {
      if (statusField) addValues(statusSet, record.fields?.[statusField]);
      if (storeField) addValues(storeSet, record.fields?.[storeField]);
    }

    offset = data.offset || "";
  } while (offset);
}

export async function GET() {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view grouped-order options",
        },
        { status: 403 },
      );
    }

    const schema = await loadSchema(airtable.baseId, airtable.token);
    const schemaByName = new Map(
      schema.map((table) => [normalize(table.name), table]),
    );

    const configuredTables = [
      airtable.tables.orderEntry,
      airtable.tables.invoice,
    ].filter((value, index, array) => value && array.indexOf(value) === index);

    const statusSet = new Set<string>();
    const storeSet = new Set<string>();

    for (const configuredTableName of configuredTables) {
      const table = schemaByName.get(normalize(configuredTableName));
      if (!table) continue;

      const fields = table.fields || [];
      const statusField = findFieldName(fields, STATUS_FIELD_CANDIDATES);
      const storeField = findFieldName(fields, STORE_FIELD_CANDIDATES);

      await collectTableOptions({
        baseId: airtable.baseId,
        token: airtable.token,
        tableName: table.name,
        statusField,
        storeField,
        statusSet,
        storeSet,
      });
    }

    return NextResponse.json({
      success: true,
      baseName: airtable.baseName,
      statusOptions: Array.from(statusSet).sort((a, b) => a.localeCompare(b)),
      storeOptions: Array.from(storeSet).sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    console.error("Grouped-items options failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown Error",
      },
      { status: 500 },
    );
  }
}
