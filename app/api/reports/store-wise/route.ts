import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type SessionBase = {
  baseName: string;
  baseId: string;
  airtableToken?: string;
  invoiceTable?: string;
  orderEntryTable?: string;
  customersTable?: string;
  productsTable?: string;
};

type SchemaField = {
  id: string;
  name: string;
  type?: string;
};

type SchemaTable = {
  id: string;
  name: string;
  fields?: SchemaField[];
};

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const schemaCache = new Map<
  string,
  { tables: SchemaTable[]; expiresAt: number }
>();
const schemaRequestCache = new Map<string, Promise<SchemaTable[]>>();

class AirtableRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AirtableRequestError";
    this.status = status;
  }
}

type StoreRow = {
  store: string;
  orders: number;
  value: number;
  pending: number;
  pendingValue: number;
  delivered: number;
  deliveredValue: number;
  dispatched: number;
  dispatchedValue: number;
  returned: number;
  returnedValue: number;
  cancelled: number;
  cancelledValue: number;
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function firstValue(value: any) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function numberValue(value: any) {
  const parsed = Number(firstValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFieldName(fields: SchemaField[], candidates: string[]) {
  const map = new Map(
    fields.map((field) => [normalize(field.name), field.name])
  );

  for (const candidate of candidates) {
    const found = map.get(normalize(candidate));
    if (found) return found;
  }

  return "";
}

function isOperationalBase(base: SessionBase) {
  const name = normalize(base.baseName);

  return (
    !name.includes("admin") &&
    !name.includes("erp admin") &&
    Boolean(base.baseId)
  );
}

function resolveToken(base: SessionBase) {
  return (
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    base.airtableToken ||
    ""
  );
}

async function getSchema(baseId: string, token: string) {
  const now = Date.now();
  const cached = schemaCache.get(baseId);

  if (cached && cached.expiresAt > now) {
    return cached.tables;
  }

  const inFlight = schemaRequestCache.get(baseId);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
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
          `Schema load failed for ${baseId}`
      );
    }

    const tables = (data.tables || []) as SchemaTable[];
    schemaCache.set(baseId, {
      tables,
      expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
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

function findInvoiceTable(
  tables: SchemaTable[],
  base: SessionBase
): SchemaTable | undefined {
  const configured = normalize(base.invoiceTable);

  if (configured) {
    const exact = tables.find(
      (table) => normalize(table.name) === configured
    );

    if (exact) return exact;
  }

  const baseName = normalize(base.baseName);

  const preferredNames = baseName.includes("i5q") || baseName.includes("dq")
    ? ["DQ Invoice"]
    : baseName.includes("fab")
      ? ["FAB Invoice"]
      : baseName.includes("tat")
        ? ["BS Invoice", "TAT Invoice", "Invoice"]
        : ["BS Invoice", "Invoice"];

  for (const preferred of preferredNames) {
    const match = tables.find(
      (table) => normalize(table.name) === normalize(preferred)
    );

    if (match) return match;
  }

  return tables.find((table) =>
    normalize(table.name).includes("invoice")
  );
}

function getMonthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

async function fetchAllRecords({
  baseId,
  token,
  tableName,
  fields,
  filterByFormula,
}: {
  baseId: string;
  token: string;
  tableName: string;
  fields: string[];
  filterByFormula?: string;
}) {
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    for (const field of fields) {
      if (field) params.append("fields[]", field);
    }

    if (filterByFormula) {
      params.set("filterByFormula", filterByFormula);
    }

    if (offset) params.set("offset", offset);

    const response = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(
        baseId
      )}/${encodeURIComponent(tableName)}?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new AirtableRequestError(
        data?.error?.message ||
          data?.error?.error?.message ||
          `Report fetch failed for ${tableName}`,
        response.status
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

function canUseDirectDateFilter(field: SchemaField | undefined) {
  const type = normalize(field?.type);
  return (
    type === "date" ||
    type === "datetime" ||
    type === "createdtime" ||
    type === "lastmodifiedtime"
  );
}

function monthFilterFormula(fieldName: string, monthStart: string, monthEnd: string) {
  return (
    `AND(` +
    `NOT(IS_BEFORE({${fieldName}},DATETIME_PARSE('${monthStart}'))),` +
    `IS_BEFORE({${fieldName}},DATETIME_PARSE('${monthEnd}'))` +
    `)`
  );
}

async function fetchReportRecords({
  baseId,
  token,
  tableName,
  fields,
  dateField,
  dateSchemaField,
  monthStart,
  monthEnd,
}: {
  baseId: string;
  token: string;
  tableName: string;
  fields: string[];
  dateField: string;
  dateSchemaField: SchemaField | undefined;
  monthStart: string;
  monthEnd: string;
}) {
  if (!canUseDirectDateFilter(dateSchemaField)) {
    return fetchAllRecords({ baseId, token, tableName, fields });
  }

  try {
    return await fetchAllRecords({
      baseId,
      token,
      tableName,
      fields,
      filterByFormula: monthFilterFormula(dateField, monthStart, monthEnd),
    });
  } catch (error) {
    if (
      error instanceof AirtableRequestError &&
      (error.status === 400 || error.status === 422)
    ) {
      return fetchAllRecords({ baseId, token, tableName, fields });
    }

    throw error;
  }
}

function isDateInMonth(
  rawValue: any,
  monthStart: string,
  monthEnd: string
) {
  const value = firstValue(rawValue);
  if (!value) return false;

  const time = new Date(value).getTime();
  const start = new Date(monthStart).getTime();
  const end = new Date(monthEnd).getTime();

  return Number.isFinite(time) && time >= start && time < end;
}

function emptyStoreRow(store: string): StoreRow {
  return {
    store,
    orders: 0,
    value: 0,
    pending: 0,
    pendingValue: 0,
    delivered: 0,
    deliveredValue: 0,
    dispatched: 0,
    dispatchedValue: 0,
    returned: 0,
    returnedValue: 0,
    cancelled: 0,
    cancelledValue: 0,
  };
}

export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const month = String(searchParams.get("month") || "").trim();
    const storeFilter = normalize(searchParams.get("store"));
    const statusFilter = normalize(searchParams.get("status"));

    if (!month) {
      return NextResponse.json(
        { success: false, message: "Month is required" },
        { status: 400 }
      );
    }

    const permissions = (
      session.availableBases?.length
        ? session.availableBases
        : session.permissions || []
    ) as SessionBase[];

    const operationalBases = permissions.filter(isOperationalBase);

    const role = normalize(session.role);
    const showAllBases =
      role === "admin" ||
      role === "manager" ||
      Boolean(session.superAdmin);

    const selectedBaseId =
      session.selectedBase?.baseId || "";

    const selectedBase =
      operationalBases.find(
        (base) => base.baseId === selectedBaseId
      ) || operationalBases[0];

    const uniqueOperationalBases = Array.from(
      new Map(
        operationalBases.map((base) => [
          String(base.baseId || "").trim(),
          base,
        ])
      ).values()
    );

    const reportBases = showAllBases
      ? uniqueOperationalBases
      : selectedBase
        ? [selectedBase]
        : [];

    if (reportBases.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No report base is available in this session",
        },
        { status: 403 }
      );
    }

    const { start, end } = getMonthRange(month);

    const reports: Array<{
      baseName: string;
      baseId: string;
      stores: StoreRow[];
      summary: {
        totalOrders: number;
        totalValue: number;
        pending: number;
        pendingValue: number;
        delivered: number;
        deliveredValue: number;
        dispatched: number;
        dispatchedValue: number;
        returned: number;
        returnedValue: number;
        cancelled: number;
        cancelledValue: number;
      };
    }> = [];

    const errors: Array<{
      baseName: string;
      message: string;
    }> = [];

    for (const base of reportBases) {
      try {
        const baseRows = new Map<string, StoreRow>();
        const token = resolveToken(base);

        if (!token) {
          throw new Error(`Airtable token missing for ${base.baseName}`);
        }

        const tables = await getSchema(base.baseId, token);
        const invoiceTable = findInvoiceTable(tables, base);

        if (!invoiceTable) {
          throw new Error(`Invoice table not found for ${base.baseName}`);
        }

        const schemaFields = invoiceTable.fields || [];

        const dateField = getFieldName(schemaFields, [
          "date",
          "Date",
          "Created Date",
          "created date",
          "Order Date",
        ]);

        const statusField = getFieldName(schemaFields, [
          "order_status",
          "Order_status",
          "Order Status",
          "Status",
        ]);

        const storeField = getFieldName(schemaFields, [
          "Select Store",
          "Store",
          "store",
        ]);

        const valueField = getFieldName(schemaFields, [
          "total_order_value",
          "Total Order Value",
          "Total Amount(Including shipping and VAT Reducing Discount)",
          "Grand Total",
          "Order Total",
          "Bill Value",
          "COD Amount",
          "Total",
        ]);

        if (!dateField) {
          throw new Error(
            `Date field not found in ${invoiceTable.name}`
          );
        }

        const dateSchemaField = schemaFields.find(
          (field) => field.name === dateField
        );
        const requestedFields = [
          dateField,
          statusField,
          storeField,
          valueField,
        ].filter(Boolean);

        const records = await fetchReportRecords({
          baseId: base.baseId,
          token,
          tableName: invoiceTable.name,
          fields: requestedFields,
          dateField,
          dateSchemaField,
          monthStart: start,
          monthEnd: end,
        });

        for (const record of records) {
          const fields = record.fields || {};

          if (!isDateInMonth(fields[dateField], start, end)) {
            continue;
          }

          const status = normalize(
            statusField ? fields[statusField] : ""
          );

          const rawStore = storeField
            ? String(firstValue(fields[storeField]) || "").trim()
            : "";

          const storeName =
            rawStore ||
            String(base.baseName || invoiceTable.name).trim() ||
            "Unknown";

          if (
            storeFilter &&
            !normalize(storeName).includes(storeFilter)
          ) {
            continue;
          }

          if (
            statusFilter &&
            status !== statusFilter &&
            !status.includes(statusFilter)
          ) {
            continue;
          }

          const value = valueField
            ? numberValue(fields[valueField])
            : 0;

          if (!baseRows.has(storeName)) {
            baseRows.set(storeName, emptyStoreRow(storeName));
          }

          const row = baseRows.get(storeName)!;

          row.orders += 1;
          row.value += value;

          if (status.includes("deliver")) {
            row.delivered += 1;
            row.deliveredValue += value;
          } else if (status.includes("dispatch")) {
            row.dispatched += 1;
            row.dispatchedValue += value;
          } else if (status.includes("return")) {
            row.returned += 1;
            row.returnedValue += value;
          } else if (status.includes("cancel")) {
            row.cancelled += 1;
            row.cancelledValue += value;
          } else if (
            status === "" ||
            status.includes("order received") ||
            status.includes("processing") ||
            status.includes("pending")
          ) {
            row.pending += 1;
            row.pendingValue += value;
          }
        }

        const baseStores = Array.from(baseRows.values()).sort(
          (a, b) => b.value - a.value
        );

        const baseSummary = baseStores.reduce(
          (total, row) => {
            total.totalOrders += row.orders;
            total.totalValue += row.value;
            total.pending += row.pending;
            total.pendingValue += row.pendingValue;
            total.delivered += row.delivered;
            total.deliveredValue += row.deliveredValue;
            total.dispatched += row.dispatched;
            total.dispatchedValue += row.dispatchedValue;
            total.returned += row.returned;
            total.returnedValue += row.returnedValue;
            total.cancelled += row.cancelled;
            total.cancelledValue += row.cancelledValue;
            return total;
          },
          {
            totalOrders: 0,
            totalValue: 0,
            pending: 0,
            pendingValue: 0,
            delivered: 0,
            deliveredValue: 0,
            dispatched: 0,
            dispatchedValue: 0,
            returned: 0,
            returnedValue: 0,
            cancelled: 0,
            cancelledValue: 0,
          }
        );

        reports.push({
          baseName: base.baseName,
          baseId: base.baseId,
          stores: baseStores,
          summary: baseSummary,
        });
      } catch (error) {
        errors.push({
          baseName: base.baseName,
          message:
            error instanceof Error
              ? error.message
              : "Report load failed",
        });
      }
    }

    const grandTotal = reports.reduce(
      (total, report) => {
        total.totalOrders += report.summary.totalOrders;
        total.totalValue += report.summary.totalValue;
        total.pending += report.summary.pending;
        total.pendingValue += report.summary.pendingValue;
        total.delivered += report.summary.delivered;
        total.deliveredValue += report.summary.deliveredValue;
        total.dispatched += report.summary.dispatched;
        total.dispatchedValue += report.summary.dispatchedValue;
        total.returned += report.summary.returned;
        total.returnedValue += report.summary.returnedValue;
        total.cancelled += report.summary.cancelled;
        total.cancelledValue += report.summary.cancelledValue;
        return total;
      },
      {
        totalOrders: 0,
        totalValue: 0,
        pending: 0,
        pendingValue: 0,
        delivered: 0,
        deliveredValue: 0,
        dispatched: 0,
        dispatchedValue: 0,
        returned: 0,
        returnedValue: 0,
        cancelled: 0,
        cancelledValue: 0,
      }
    );

    return NextResponse.json({
      success: true,
      month,
      mode: showAllBases ? "all-bases" : "selected-base",
      reports,
      summary: grandTotal,
      stores: reports.flatMap((report) => report.stores),
      warnings: errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Store summary report failed",
      },
      { status: 500 }
    );
  }
}
