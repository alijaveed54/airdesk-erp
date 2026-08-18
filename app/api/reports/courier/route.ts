import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

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
  fields?: SchemaField[];
};

type CourierRow = {
  courier: string;
  parcels: number;
  value: number;
  delivered: number;
  deliveredValue: number;
  dispatched: number;
  dispatchedValue: number;
  returned: number;
  returnedValue: number;
  inTransit: number;
  inTransitValue: number;
  olderThan7: number;
  olderThan7Value: number;
};

type OldOrderRow = {
  id: string;
  orderNo: string;
  store: string;
  customer: string;
  phone: string;
  courier: string;
  status: string;
  value: number;
  despatchDate: string;
  days: number;
};

type BaseReport = {
  baseName: string;
  baseId: string;
  deliveryFieldLabel: "Courier" | "Driver";
  couriers: CourierRow[];
  oldOrders: OldOrderRow[];
  summary: Omit<CourierRow, "courier" | "parcels"> & {
    totalParcels: number;
    totalValue: number;
  };
};

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const schemaCache = new Map<
  string,
  { tables: SchemaTable[]; expiresAt: number }
>();
const schemaRequestCache = new Map<string, Promise<SchemaTable[]>>();

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

function buildBsOrderNumber({
  store,
  number,
  resend,
}: {
  store: unknown;
  number: unknown;
  resend: unknown;
}) {
  const storeName = String(firstValue(store) || "").trim();
  const rawNumber = String(firstValue(number) || "").trim();
  const resendValue = String(firstValue(resend) || "").trim();

  if (!rawNumber) return "";

  const prefixByStore: Record<string, string> = {
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

  return resendValue ? `${baseOrderNo}${resendValue}` : baseOrderNo;
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
  return Boolean(base.baseId) && !name.includes("admin");
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
  if (inFlight) return inFlight;

  const request = (async () => {
    const response = await fetch(
      `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Schema load failed for ${baseId}`
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
) {
  const configured = normalize(base.invoiceTable);

  if (configured) {
    const exact = tables.find(
      (table) => normalize(table.name) === configured
    );
    if (exact) return exact;
  }

  const baseName = normalize(base.baseName);
  const preferred = baseName.includes("dq") || baseName.includes("i5q")
    ? ["DQ Invoice"]
    : baseName.includes("fab")
      ? ["FAB Invoice"]
      : baseName.includes("tat")
        ? ["TAT Invoice", "BS Invoice", "Invoice"]
        : ["BS Invoice", "Invoice"];

  for (const name of preferred) {
    const table = tables.find(
      (item) => normalize(item.name) === normalize(name)
    );
    if (table) return table;
  }

  return tables.find((table) =>
    normalize(table.name).includes("invoice")
  );
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
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Report fetch failed for ${tableName}`
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

function schemaFieldByName(fields: SchemaField[], fieldName: string) {
  return fields.find((field) => field.name === fieldName);
}

function isDirectDateField(field: SchemaField | undefined) {
  return Boolean(
    field &&
      ["date", "dateTime", "createdTime", "lastModifiedTime"].includes(
        String(field.type || "")
      )
  );
}

function buildCourierRelevantFormula({
  dispatchDateField,
  statusField,
  month,
}: {
  dispatchDateField: string;
  statusField: string;
  month: string;
}) {
  // One Airtable query returns the union needed by the existing report:
  // 1) a timezone-safe superset around the selected month, and
  // 2) dispatched rows older than 7 days for the persistent old-orders list.
  // Existing JS month/day checks remain authoritative after fetch, so boundary
  // dates and the exact >7-day rule keep the current behavior.
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("Invalid report month");

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const startBuffer = new Date(Date.UTC(year, monthIndex, 0));
  const endBuffer = new Date(Date.UTC(year, monthIndex + 1, 2));
  const dateKey = (date: Date) => date.toISOString().slice(0, 10);

  const monthRows =
    `AND({${dispatchDateField}}!='',` +
    `IS_AFTER({${dispatchDateField}},DATETIME_PARSE('${dateKey(startBuffer)}','YYYY-MM-DD')),` +
    `IS_BEFORE({${dispatchDateField}},DATETIME_PARSE('${dateKey(endBuffer)}','YYYY-MM-DD')),` +
    `LOWER({${statusField}}&'')!='order received')`;

  const oldDispatchedRows =
    `AND({${dispatchDateField}}!='',` +
    `FIND('dispatch',LOWER({${statusField}}&''))>0,` +
    `IS_BEFORE({${dispatchDateField}},DATEADD(NOW(),-7,'days')))`;

  return `OR(${monthRows},${oldDispatchedRows})`;
}

function monthMatches(value: any, month: string) {
  const raw = firstValue(value);
  if (!raw) return false;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return false;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` === month;
}

function pendingDays(value: any) {
  const raw = firstValue(value);
  if (!raw) return 0;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 0;

  return Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 86400000)
  );
}

function emptyCourierRow(courier: string): CourierRow {
  return {
    courier,
    parcels: 0,
    value: 0,
    delivered: 0,
    deliveredValue: 0,
    dispatched: 0,
    dispatchedValue: 0,
    returned: 0,
    returnedValue: 0,
    inTransit: 0,
    inTransitValue: 0,
    olderThan7: 0,
    olderThan7Value: 0,
  };
}

function emptySummary() {
  return {
    totalParcels: 0,
    totalValue: 0,
    value: 0,
    delivered: 0,
    deliveredValue: 0,
    dispatched: 0,
    dispatchedValue: 0,
    returned: 0,
    returnedValue: 0,
    inTransit: 0,
    inTransitValue: 0,
    olderThan7: 0,
    olderThan7Value: 0,
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
    const month = searchParams.get("month") || "";
    const courierFilter = normalize(searchParams.get("courier"));
    const storeFilter = normalize(searchParams.get("store"));

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

    const allowedBases = permissions.filter(
      (base) => isOperationalBase(base) && base.canReports !== false
    );

    const role = normalize(session.role);
    const showAllAllowedBases =
      role === "admin" ||
      role === "manager" ||
      Boolean(session.superAdmin);

    const selectedBaseId =
      session.selectedBase?.baseId || "";

    const selectedBase =
      allowedBases.find((base) => base.baseId === selectedBaseId) ||
      allowedBases[0];

    // Manager sees only bases present in his/her permissions.
    // Employee sees only selected base.
    const reportBases = showAllAllowedBases
      ? allowedBases
      : selectedBase
        ? [selectedBase]
        : [];

    const reports: BaseReport[] = [];
    const warnings: Array<{ baseName: string; message: string }> = [];

    for (const base of reportBases) {
      try {
        const token = resolveToken(base);
        if (!token) throw new Error("Airtable token missing");

        const tables = await getSchema(base.baseId, token);
        const invoiceTable = findInvoiceTable(tables, base);

        if (!invoiceTable) {
          throw new Error("Invoice table not found");
        }

        const fields = invoiceTable.fields || [];
        const baseName = normalize(base.baseName);

        const useDriver =
          baseName.includes("fab") ||
          baseName.includes("dq") ||
          baseName.includes("i5q");

        const deliveryField = getFieldName(
          fields,
          useDriver
            ? ["Driver Name", "Driver", "Courier"]
            : ["Courier", "Courier Name", "Driver Name"]
        );

        const statusField = getFieldName(fields, [
          "order_status",
          "Order_status",
          "Order Status",
          "Status",
        ]);

        const dispatchDateField = getFieldName(fields, [
          "Despatch Date",
          "Dispatch Date 2",
          "Dispatch Date",
          "Delivery Date",
        ]);

        const storeField = getFieldName(fields, [
          "Select Store",
          "Store",
        ]);

        const valueField = getFieldName(fields, [
          "total_order_value",
          "Total Order Value",
          "Total Amount(Including shipping and VAT Reducing Discount)",
          "Grand Total",
          "Bill Value",
          "COD Amount",
          "Total",
        ]);

        const orderNoField = getFieldName(fields, [
          "order_no",
          "Order Number",
          "Order No.",
          "Order No",
          "Invoice No.",
          "Number",
        ]);

        const numberField = getFieldName(fields, [
          "Number",
          "Autonumber",
          "Auto Number",
        ]);

        const resendField = getFieldName(fields, [
          "Resend",
          "Re-send",
          "Re Send",
        ]);

        const customerField = getFieldName(fields, [
          "Consignee",
          "Customer Name",
          "Name (from Contact No.)",
          "Name",
        ]);

        const phoneField = getFieldName(fields, [
          "Telephone1",
          "Contact No.",
          "Contact No",
          "Phone",
          "Mobile",
        ]);

        if (!deliveryField || !statusField || !dispatchDateField) {
          throw new Error(
            `Required Courier/Driver, Status or Despatch Date field missing in ${invoiceTable.name}`
          );
        }

        const requestedFields = [
          deliveryField,
          statusField,
          dispatchDateField,
          storeField,
          valueField,
          orderNoField,
          numberField,
          resendField,
          customerField,
          phoneField,
        ].filter(Boolean);

        const dispatchDateSchemaField = schemaFieldByName(
          fields,
          dispatchDateField
        );

        let records: any[];

        if (isDirectDateField(dispatchDateSchemaField)) {
          try {
            records = await fetchAllRecords({
              baseId: base.baseId,
              token,
              tableName: invoiceTable.name,
              fields: requestedFields,
              filterByFormula: buildCourierRelevantFormula({
                dispatchDateField,
                statusField,
                month,
              }),
            });
          } catch {
            // Legacy / unusual Airtable date configuration fallback:
            // preserve the original full-scan behavior instead of breaking report output.
            records = await fetchAllRecords({
              baseId: base.baseId,
              token,
              tableName: invoiceTable.name,
              fields: requestedFields,
            });
          }
        } else {
          records = await fetchAllRecords({
            baseId: base.baseId,
            token,
            tableName: invoiceTable.name,
            fields: requestedFields,
          });
        }

        const rows = new Map<string, CourierRow>();
        const oldOrders: OldOrderRow[] = [];
        const summary = emptySummary();

        for (const record of records) {
          const recordFields = record.fields || {};
          const deliveryName = String(
            firstValue(recordFields[deliveryField]) || ""
          ).trim();

          if (!deliveryName || normalize(deliveryName) === "bill created") {
            continue;
          }

          const storeName = storeField
            ? String(firstValue(recordFields[storeField]) || "")
            : "";

          const isBsOrderBase =
            baseName.includes("bs") &&
            !baseName.includes("fab") &&
            !baseName.includes("tat") &&
            !baseName.includes("dq") &&
            !baseName.includes("i5q");

          const resolvedOrderNo = isBsOrderBase
            ? buildBsOrderNumber({
                store: storeField ? recordFields[storeField] : "",
                number: numberField ? recordFields[numberField] : "",
                resend: resendField ? recordFields[resendField] : "",
              }) ||
              (orderNoField
                ? String(firstValue(recordFields[orderNoField]) || "")
                : "")
            : orderNoField
              ? String(firstValue(recordFields[orderNoField]) || "")
              : "";

          if (
            courierFilter &&
            !normalize(deliveryName).includes(courierFilter)
          ) {
            continue;
          }

          if (
            storeFilter &&
            !normalize(storeName).includes(storeFilter)
          ) {
            continue;
          }

          const status = normalize(recordFields[statusField]);
          if (status === "order received") continue;

          const dateValue = recordFields[dispatchDateField];
          const days = pendingDays(dateValue);
          const value = valueField
            ? numberValue(recordFields[valueField])
            : 0;

          if (
            status.includes("dispatch") &&
            days > 7
          ) {
            oldOrders.push({
              id: record.id,
              orderNo: resolvedOrderNo,
              store: storeName,
              customer: customerField
                ? String(firstValue(recordFields[customerField]) || "")
                : "",
              phone: phoneField
                ? String(firstValue(recordFields[phoneField]) || "")
                : "",
              courier: deliveryName,
              status: String(firstValue(recordFields[statusField]) || ""),
              value,
              despatchDate: String(firstValue(dateValue) || ""),
              days,
            });
          }

          if (!monthMatches(dateValue, month)) continue;

          if (!rows.has(deliveryName)) {
            rows.set(deliveryName, emptyCourierRow(deliveryName));
          }

          const row = rows.get(deliveryName)!;

          row.parcels += 1;
          row.value += value;
          summary.totalParcels += 1;
          summary.totalValue += value;

          if (status.includes("deliver")) {
            row.delivered += 1;
            row.deliveredValue += value;
            summary.delivered += 1;
            summary.deliveredValue += value;
          } else if (status.includes("return")) {
            row.returned += 1;
            row.returnedValue += value;
            summary.returned += 1;
            summary.returnedValue += value;
          } else if (status.includes("dispatch")) {
            row.dispatched += 1;
            row.dispatchedValue += value;
            summary.dispatched += 1;
            summary.dispatchedValue += value;
          } else {
            row.inTransit += 1;
            row.inTransitValue += value;
            summary.inTransit += 1;
            summary.inTransitValue += value;
          }

          if (days > 7 && !status.includes("deliver") && !status.includes("return")) {
            row.olderThan7 += 1;
            row.olderThan7Value += value;
            summary.olderThan7 += 1;
            summary.olderThan7Value += value;
          }
        }

        oldOrders.sort((a, b) => b.days - a.days);

        reports.push({
          baseName: base.baseName,
          baseId: base.baseId,
          deliveryFieldLabel: useDriver ? "Driver" : "Courier",
          couriers: Array.from(rows.values()).sort(
            (a, b) => b.parcels - a.parcels
          ),
          oldOrders,
          summary,
        });
      } catch (error) {
        warnings.push({
          baseName: base.baseName,
          message:
            error instanceof Error
              ? error.message
              : "Report failed",
        });
      }
    }

    const grandTotal = reports.reduce(
      (total, report) => {
        const value = report.summary;

        total.totalParcels += value.totalParcels;
        total.totalValue += value.totalValue;
        total.delivered += value.delivered;
        total.deliveredValue += value.deliveredValue;
        total.dispatched += value.dispatched;
        total.dispatchedValue += value.dispatchedValue;
        total.returned += value.returned;
        total.returnedValue += value.returnedValue;
        total.inTransit += value.inTransit;
        total.inTransitValue += value.inTransitValue;
        total.olderThan7 += value.olderThan7;
        total.olderThan7Value += value.olderThan7Value;

        return total;
      },
      emptySummary()
    );

    return NextResponse.json({
      success: true,
      month,
      mode: showAllAllowedBases ? "allowed-bases" : "selected-base",
      reports,
      summary: grandTotal,
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Courier report failed",
      },
      { status: 500 }
    );
  }
}

