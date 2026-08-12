import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;

const REFERENCE_HEADERS = [
  "Reference Number",
  "SHIPPER REF #",
  "Shipper Ref",
  "Shipper Reference",
  "Customer Reference",
  "Order Number",
  "Order No",
  "Order No.",
  "Invoice Number",
  "Invoice No",
  "Invoice No.",
];

const STATUS_HEADERS = [
  "backend.Status Name",
  "Status Name",
  "Status",
  "Shipment Status",
  "Courier Status",
  "Tracking Status",
  "TFM Status",
];

const STATUS_DATE_HEADERS = [
  "Last Action Date",
  "Status Date",
  "Status Updated At",
  "Updated At",
  "Update Date",
  "Last Update",
  "Date",
];

type SessionBase = {
  baseName: string;
  baseId: string;
  airtableToken?: string;
  invoiceTable?: string;
  canReports?: boolean;
};

type SchemaField = {
  id: string;
  name: string;
  type?: string;
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields?: SchemaField[];
};

type AirtableRecord = {
  id: string;
  fields?: Record<string, unknown>;
};

type ParsedExcelRow = {
  rowNumber: number;
  reference: string;
  status: string;
  statusDate: string;
  timestamp: number | null;
};

type PendingUpdate = {
  recordId: string;
  reference: string;
  status: string;
  rowNumber: number;
  timestamp: number | null;
  currentStatus: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase();
}

function normalizeHeader(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeReference(value: unknown) {
  return clean(value)
    .replace(/^'+/, "")
    .replace(/\.0$/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function numericReference(value: unknown) {
  return clean(value)
    .replace(/^'+/, "")
    .replace(/\.0$/, "")
    .replace(/\D/g, "");
}

function firstValue(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function getFieldName(
  fields: SchemaField[],
  candidates: string[],
) {
  const fieldMap = new Map(
    fields.map((field) => [normalize(field.name), field.name]),
  );

  for (const candidate of candidates) {
    const fieldName = fieldMap.get(normalize(candidate));
    if (fieldName) return fieldName;
  }

  return "";
}

function resolveToken(base: SessionBase) {
  return (
    base.airtableToken ||
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    ""
  );
}

function findInvoiceTable(
  tables: SchemaTable[],
  base: SessionBase,
) {
  const configured = normalize(base.invoiceTable);

  if (configured) {
    const exact = tables.find(
      (table) => normalize(table.name) === configured,
    );
    if (exact) return exact;
  }

  const baseName = normalize(base.baseName);
  const preferred =
    baseName.includes("dq") || baseName.includes("i5q")
      ? ["DQ Invoice"]
      : baseName.includes("fab")
        ? ["FAB Invoice"]
        : baseName.includes("tat")
          ? ["TAT Invoice", "BS Invoice", "Invoice"]
          : ["BS Invoice", "Invoice"];

  for (const tableName of preferred) {
    const found = tables.find(
      (table) =>
        normalize(table.name) === normalize(tableName),
    );
    if (found) return found;
  }

  return tables.find((table) =>
    normalize(table.name).includes("invoice"),
  );
}

function buildBsOrderNumber({
  store,
  number,
  resend,
}: {
  store: unknown;
  number: unknown;
  resend: unknown;
}) {
  const storeName = clean(firstValue(store));
  const rawNumber = clean(firstValue(number));
  const resendValue = clean(firstValue(resend));

  if (!rawNumber) return "";

  const prefixByStore: Record<string, string> = {
    "live store": "BLS",
    "bestshop.ae": "BBS",
    "fab ethnic uae": "BFEU",
    rushnas: "BSH",
    ethnofash: "BEF",
    "clarance store": "BCLR",
    "sooper deals": "BSD",
    "u5store.com": "BUS",
    ef: "BEF",
    "rushna boutique": "BSM",
    "fab uae": "BFAB",
    styleshop: "BSS",
    desiluxe: "BDL",
    "test store": "BTS",
  };

  const prefix = prefixByStore[normalize(storeName)] || "";
  const baseOrderNo = `${prefix}${rawNumber}`;

  return resendValue
    ? `${baseOrderNo}${resendValue}`
    : baseOrderNo;
}

async function getSchema(baseId: string, token: string) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(
      baseId,
    )}/tables`,
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
      data?.error?.message ||
        `Schema load failed for ${baseId}`,
    );
  }

  return (data.tables || []) as SchemaTable[];
}

async function fetchAllRecords({
  baseId,
  token,
  tableName,
  fields,
}: {
  baseId: string;
  token: string;
  tableName: string;
  fields: string[];
}) {
  const records: AirtableRecord[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    for (const field of Array.from(new Set(fields.filter(Boolean)))) {
      params.append("fields[]", field);
    }

    if (offset) params.set("offset", offset);

    const response = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(
        baseId,
      )}/${encodeURIComponent(tableName)}?${params.toString()}`,
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
        data?.error?.message ||
          `Unable to load ${tableName}`,
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

function findHeader(
  headers: string[],
  candidates: string[],
) {
  const normalizedHeaders = new Map(
    headers.map((header) => [normalizeHeader(header), header]),
  );

  for (const candidate of candidates) {
    const actual = normalizedHeaders.get(
      normalizeHeader(candidate),
    );
    if (actual) return actual;
  }

  return "";
}

function parseDateValue(value: unknown) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(
        parsed.y,
        parsed.m - 1,
        parsed.d,
        parsed.H || 0,
        parsed.M || 0,
        Math.floor(parsed.S || 0),
      );
      const time = date.getTime();
      return Number.isNaN(time) ? null : time;
    }
  }

  const text = clean(value);
  if (!text) return null;

  const time = new Date(text).getTime();
  return Number.isNaN(time) ? null : time;
}

function addToIndex(
  map: Map<string, Set<string>>,
  key: string,
  recordId: string,
) {
  if (!key) return;

  const current = map.get(key) || new Set<string>();
  current.add(recordId);
  map.set(key, current);
}

function uniqueIds(
  exactIndex: Map<string, Set<string>>,
  numericIndex: Map<string, Set<string>>,
  reference: string,
) {
  const exactKey = normalizeReference(reference);
  const numericKey = numericReference(reference);

  const exactMatches = exactKey
    ? Array.from(exactIndex.get(exactKey) || [])
    : [];

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return numericKey
    ? Array.from(numericIndex.get(numericKey) || [])
    : [];
}

function shouldReplacePending(
  current: PendingUpdate,
  incoming: PendingUpdate,
) {
  if (
    current.timestamp !== null &&
    incoming.timestamp !== null
  ) {
    if (incoming.timestamp !== current.timestamp) {
      return incoming.timestamp > current.timestamp;
    }
  } else if (
    incoming.timestamp !== null &&
    current.timestamp === null
  ) {
    return true;
  }

  return incoming.rowNumber > current.rowNumber;
}

async function patchUpdates({
  baseId,
  token,
  tableName,
  statusField,
  updates,
}: {
  baseId: string;
  token: string;
  tableName: string;
  statusField: string;
  updates: PendingUpdate[];
}) {
  let updated = 0;
  const failures: string[] = [];

  for (let index = 0; index < updates.length; index += 10) {
    const batch = updates.slice(index, index + 10);

    const response = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(
        baseId,
      )}/${encodeURIComponent(tableName)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          records: batch.map((item) => ({
            id: item.recordId,
            fields: {
              [statusField]: item.status,
            },
          })),
          typecast: true,
        }),
      },
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.error?.type ||
        `Airtable update failed with status ${response.status}`;

      failures.push(
        `${batch
          .map((item) => item.reference)
          .join(", ")}: ${message}`,
      );
      continue;
    }

    updated += (data?.records || []).length;
  }

  return { updated, failures };
}

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Not authenticated",
        },
        { status: 401 },
      );
    }

    if (normalize(session.role) === "supplier") {
      return NextResponse.json(
        {
          success: false,
          message: "Supplier access is not allowed",
        },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const fileValue = formData.get("file");
    const baseId = clean(formData.get("baseId"));

    if (!(fileValue instanceof File) || !baseId) {
      return NextResponse.json(
        {
          success: false,
          message: "Excel/CSV file and Base are required",
        },
        { status: 400 },
      );
    }

    if (fileValue.size > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        {
          success: false,
          message: "Import file is larger than 15 MB",
        },
        { status: 413 },
      );
    }

    const permissions = (
      session.availableBases?.length
        ? session.availableBases
        : session.permissions || []
    ) as SessionBase[];

    const base = permissions.find(
      (item) =>
        item.baseId === baseId &&
        item.canReports !== false,
    );

    if (!base) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Selected base is not available for this user/report",
        },
        { status: 403 },
      );
    }

    const token = resolveToken(base);

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: `Airtable token missing for ${base.baseName}`,
        },
        { status: 500 },
      );
    }

    const buffer = Buffer.from(
      await fileValue.arrayBuffer(),
    );

    let workbook: XLSX.WorkBook;

    try {
      workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
      });
    } catch {
      return NextResponse.json(
        {
          success: false,
          message:
            "Unable to read this file. Use a valid .xlsx, .xls or .csv file.",
        },
        { status: 400 },
      );
    }

    const firstSheetName = workbook.SheetNames[0];
    const sheet = firstSheetName
      ? workbook.Sheets[firstSheetName]
      : undefined;

    if (!sheet) {
      return NextResponse.json(
        {
          success: false,
          message: "The import file has no readable worksheet",
        },
        { status: 400 },
      );
    }

    const excelRows = XLSX.utils.sheet_to_json<
      Record<string, unknown>
    >(sheet, {
      defval: "",
      raw: true,
    });

    if (excelRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "The import file contains no data rows",
        },
        { status: 400 },
      );
    }

    if (excelRows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        {
          success: false,
          message: `Maximum ${MAX_IMPORT_ROWS.toLocaleString()} rows are allowed per import`,
        },
        { status: 400 },
      );
    }

    const headers = Object.keys(excelRows[0] || {});
    const referenceHeader = findHeader(
      headers,
      REFERENCE_HEADERS,
    );
    const statusHeader = findHeader(
      headers,
      STATUS_HEADERS,
    );
    const statusDateHeader = findHeader(
      headers,
      STATUS_DATE_HEADERS,
    );

    if (!referenceHeader || !statusHeader) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Required columns were not found. The file needs an Order/Reference column and a Status column.",
          detectedHeaders: headers,
          acceptedReferenceHeaders: REFERENCE_HEADERS,
          acceptedStatusHeaders: STATUS_HEADERS,
        },
        { status: 400 },
      );
    }

    const parsedRows: ParsedExcelRow[] = excelRows.map(
      (row, index) => {
        const rawDate = statusDateHeader
          ? row[statusDateHeader]
          : "";

        return {
          rowNumber: index + 2,
          reference: clean(row[referenceHeader]),
          status: clean(row[statusHeader]),
          statusDate: clean(rawDate),
          timestamp: parseDateValue(rawDate),
        };
      },
    );

    const schema = await getSchema(baseId, token);
    const invoiceTable = findInvoiceTable(schema, base);

    if (!invoiceTable) {
      return NextResponse.json(
        {
          success: false,
          message: `Invoice table not found for ${base.baseName}`,
        },
        { status: 400 },
      );
    }

    const fields = invoiceTable.fields || [];

    const statusField = getFieldName(fields, [
      "order_status",
      "Order_status",
      "Order Status",
      "Status",
    ]);

    const orderNoField = getFieldName(fields, [
      "order_no",
      "Order Number",
      "Order No.",
      "Order No",
      "Invoice No.",
      "Invoice No",
    ]);

    const primaryField = invoiceTable.primaryFieldId
      ? fields.find(
          (field) =>
            field.id === invoiceTable.primaryFieldId,
        )?.name || ""
      : "";

    const effectiveOrderField =
      orderNoField || primaryField;

    const numberField = getFieldName(fields, [
      "Number",
      "Autonumber",
      "Auto Number",
    ]);

    const storeField = getFieldName(fields, [
      "Select Store",
      "Store",
    ]);

    const resendField = getFieldName(fields, [
      "Resend",
      "Re-send",
      "Re Send",
    ]);

    if (!statusField) {
      return NextResponse.json(
        {
          success: false,
          message: `Order Status field not found in ${invoiceTable.name}`,
        },
        { status: 400 },
      );
    }

    if (!effectiveOrderField && !numberField) {
      return NextResponse.json(
        {
          success: false,
          message: `Order Number/Number field not found in ${invoiceTable.name}`,
        },
        { status: 400 },
      );
    }

    const records = await fetchAllRecords({
      baseId,
      token,
      tableName: invoiceTable.name,
      fields: [
        statusField,
        effectiveOrderField,
        numberField,
        storeField,
        resendField,
      ],
    });

    const exactIndex = new Map<string, Set<string>>();
    const numericIndex = new Map<string, Set<string>>();
    const recordById = new Map<string, AirtableRecord>();

    const baseName = normalize(base.baseName);
    const isBsOrderBase =
      baseName.includes("bs") &&
      !baseName.includes("fab") &&
      !baseName.includes("tat") &&
      !baseName.includes("dq") &&
      !baseName.includes("i5q");

    for (const record of records) {
      recordById.set(record.id, record);

      const recordFields = record.fields || {};
      const aliases = new Set<string>();

      if (effectiveOrderField) {
        aliases.add(
          clean(firstValue(recordFields[effectiveOrderField])),
        );
      }

      if (numberField) {
        aliases.add(
          clean(firstValue(recordFields[numberField])),
        );
      }

      if (isBsOrderBase && numberField) {
        aliases.add(
          buildBsOrderNumber({
            store: storeField
              ? recordFields[storeField]
              : "",
            number: recordFields[numberField],
            resend: resendField
              ? recordFields[resendField]
              : "",
          }),
        );
      }

      for (const alias of aliases) {
        const exactKey = normalizeReference(alias);
        const numericKey = numericReference(alias);

        addToIndex(exactIndex, exactKey, record.id);
        addToIndex(numericIndex, numericKey, record.id);
      }
    }

    let skipped = 0;
    let notFound = 0;
    let ambiguous = 0;
    let matchedRows = 0;
    const notFoundReferences: string[] = [];
    const ambiguousReferences: string[] = [];
    const pendingByRecordId = new Map<
      string,
      PendingUpdate
    >();

    for (const row of parsedRows) {
      if (!row.reference || !row.status) {
        skipped += 1;
        continue;
      }

      const matches = uniqueIds(
        exactIndex,
        numericIndex,
        row.reference,
      );

      if (matches.length === 0) {
        notFound += 1;
        if (notFoundReferences.length < 25) {
          notFoundReferences.push(row.reference);
        }
        continue;
      }

      if (matches.length > 1) {
        ambiguous += 1;
        if (ambiguousReferences.length < 25) {
          ambiguousReferences.push(row.reference);
        }
        continue;
      }

      matchedRows += 1;

      const recordId = matches[0];
      const record = recordById.get(recordId);
      const currentStatus = clean(
        record?.fields?.[statusField],
      );

      const incoming: PendingUpdate = {
        recordId,
        reference: row.reference,
        status: row.status,
        rowNumber: row.rowNumber,
        timestamp: row.timestamp,
        currentStatus,
      };

      const existing = pendingByRecordId.get(recordId);

      if (
        !existing ||
        shouldReplacePending(existing, incoming)
      ) {
        pendingByRecordId.set(recordId, incoming);
      }
    }

    const dedupedMatches = Array.from(
      pendingByRecordId.values(),
    );

    const unchanged = dedupedMatches.filter(
      (item) =>
        normalize(item.currentStatus) ===
        normalize(item.status),
    ).length;

    const updates = dedupedMatches.filter(
      (item) =>
        normalize(item.currentStatus) !==
        normalize(item.status),
    );

    const duplicateCollapsed = Math.max(
      0,
      matchedRows - dedupedMatches.length,
    );

    const { updated, failures } = await patchUpdates({
      baseId,
      token,
      tableName: invoiceTable.name,
      statusField,
      updates,
    });

    const failed = Math.max(
      failures.length > 0
        ? updates.length - updated
        : 0,
      0,
    );

    return NextResponse.json({
      success: true,
      partial: failed > 0,
      message:
        failed > 0
          ? "Import completed with some Airtable update failures"
          : "Courier status import completed",
      base: {
        baseId,
        baseName: base.baseName,
        invoiceTable: invoiceTable.name,
      },
      fields: {
        referenceColumn: referenceHeader,
        statusColumn: statusHeader,
        statusDateColumn: statusDateHeader,
        airtableOrderField: effectiveOrderField,
        airtableNumberField: numberField,
        airtableStatusField: statusField,
      },
      totalExcelRows: parsedRows.length,
      matchedRows,
      uniqueMatchedOrders: dedupedMatches.length,
      duplicateCollapsed,
      updated,
      unchanged,
      notFound,
      ambiguous,
      skipped,
      failed,
      notFoundReferences,
      ambiguousReferences,
      failures: failures.slice(0, 20),
    });
  } catch (error) {
    console.error(
      "Courier status Excel import failed:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Courier status import failed",
      },
      { status: 500 },
    );
  }
}
