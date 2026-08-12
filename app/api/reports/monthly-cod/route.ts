import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type Base = {
  baseName: string;
  baseId: string;
  airtableToken?: string;
  invoiceTable?: string;
};

type Field = { id: string; name: string; type?: string };
type Table = { id: string; name: string; fields?: Field[] };

const norm = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");

const text = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(text).filter(Boolean).join(", ")
    : value && typeof value === "object" && "name" in value
      ? String((value as { name?: unknown }).name ?? "")
      : String(value ?? "").trim();

const num = (value: unknown) => {
  const parsed = Number(text(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const isReceived = (value: unknown) => {
  if (value === true || value === 1) return true;

  const normalized = norm(value);
  if (!normalized) return false;

  return (
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "true" ||
    normalized === "paid" ||
    normalized === "received" ||
    normalized === "delivered" ||
    normalized.includes("codreceived") ||
    normalized.includes("paymentreceived") ||
    normalized.includes("amountreceived") ||
    normalized.includes("fullypaid")
  );
};

const matchingFields = (fields: Field[], candidates: string[]) => {
  const candidateSet = new Set(candidates.map(norm));
  return fields
    .filter((field) => candidateSet.has(norm(field.name)))
    .map((field) => field.name);
};

const firstExistingValue = (
  recordFields: Record<string, unknown>,
  fieldNames: string[],
) => {
  for (const fieldName of fieldNames) {
    const value = recordFields[fieldName];
    if (value !== undefined && value !== null && text(value) !== "") {
      return value;
    }
  }
  return "";
};

const operational = (base: Base) =>
  Boolean(base.baseId) && !norm(base.baseName).includes("admin");

const token = (base: Base) =>
  process.env.AIRTABLE_TOKEN ||
  process.env.AUTH_AIRTABLE_TOKEN ||
  base.airtableToken ||
  "";

async function loadConfiguredBases(): Promise<Base[]> {
  const authToken =
    process.env.AUTH_AIRTABLE_TOKEN || process.env.AIRTABLE_TOKEN || "";
  const authBaseId = process.env.AUTH_AIRTABLE_BASE_ID || "";

  if (!authToken || !authBaseId) return [];

  const params = new URLSearchParams({
    pageSize: "100",
    filterByFormula: "{Active}=1",
  });

  const response = await fetch(
    `https://api.airtable.com/v0/${encodeURIComponent(authBaseId)}/${encodeURIComponent("ERP Bases")}?${params}`,
    {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "ERP Bases load failed");
  }

  return (data.records || [])
    .map((record: any) => {
      const fields = record.fields || {};
      return {
        baseName: text(
          fields["Display Name"] ||
            fields["Base Name"] ||
            fields["Internal Name"],
        ),
        baseId: text(fields["Base ID"]),
        invoiceTable: text(fields["Invoice Table"]),
        airtableToken: authToken,
      } as Base;
    })
    .filter(operational);
}

async function loadSchema(baseId: string, airtableToken: string) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: { Authorization: `Bearer ${airtableToken}` },
      cache: "no-store",
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Schema load failed");
  }

  return (data.tables || []) as Table[];
}

function findInvoiceTable(tables: Table[], base: Base) {
  if (base.invoiceTable) {
    const configured = tables.find(
      (table) => norm(table.name) === norm(base.invoiceTable),
    );
    if (configured) return configured;
  }

  const baseName = norm(base.baseName);
  const candidates =
    baseName.includes("dq") || baseName.includes("i5q")
      ? ["DQ Invoice", "i5Q Invoice", "Invoice"]
      : baseName.includes("fab")
        ? ["FAB Invoice", "BS Invoice", "Invoice"]
        : baseName.includes("tat")
          ? ["TAT Invoice", "Invoice", "BS Invoice"]
          : ["BS Invoice", "Invoice"];

  for (const candidate of candidates) {
    const table = tables.find(
      (item) => norm(item.name) === norm(candidate),
    );
    if (table) return table;
  }

  return tables.find((table) => norm(table.name).includes("invoice"));
}

async function loadRecords(
  baseId: string,
  airtableToken: string,
  tableName: string,
  fields: string[],
) {
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams({ pageSize: "100" });

    [...new Set(fields.filter(Boolean))].forEach((fieldName) =>
      params.append("fields[]", fieldName),
    );

    if (offset) params.set("offset", offset);

    const response = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}?${params}`,
      {
        headers: { Authorization: `Bearer ${airtableToken}` },
        cache: "no-store",
      },
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `Fetch failed: ${tableName}`);
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

function isInMonth(value: unknown, month: string) {
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return false;

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` === month;
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const month = String(searchParams.get("month") || "");
    const baseFilter = norm(searchParams.get("base"));
    const storeFilter = norm(searchParams.get("store"));
    const courierFilter = norm(searchParams.get("courier"));

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, message: "Valid month is required" },
        { status: 400 },
      );
    }

    const configuredBases = await loadConfiguredBases();
    const sessionBases = ((session.availableBases?.length
      ? session.availableBases
      : session.permissions) || []) as Base[];

    const mergedBases = new Map<string, Base>();

    for (const base of [...configuredBases, ...sessionBases]) {
      if (!base?.baseId) continue;

      const current = mergedBases.get(base.baseId);
      mergedBases.set(base.baseId, {
        ...current,
        ...base,
        baseName: base.baseName || current?.baseName || "",
        invoiceTable: base.invoiceTable || current?.invoiceTable,
        airtableToken: base.airtableToken || current?.airtableToken,
      });
    }

    const bases = [...mergedBases.values()]
      .filter(operational)
      .filter(
        (base) =>
          !baseFilter || norm(base.baseName).includes(baseFilter),
      );

    const rows: any[] = [];
    const warnings: any[] = [];

    for (const base of bases) {
      try {
        const airtableToken = token(base);
        if (!airtableToken) throw new Error("Airtable token missing");

        const tables = await loadSchema(base.baseId, airtableToken);
        const invoiceTable = findInvoiceTable(tables, base);
        if (!invoiceTable) throw new Error("Invoice table not found");

        const schemaFields = invoiceTable.fields || [];

        const orderFields = matchingFields(schemaFields, [
          "Order No.",
          "Order No",
          "Order Number",
          "Invoice No.",
          "Invoice Number",
          "Order ID",
        ]);

        const storeFields = matchingFields(schemaFields, [
          "Select Store",
          "Store",
          "Store Name",
          "Sales Channel",
        ]);

        const courierFields = matchingFields(schemaFields, [
          "Courier",
          "Courier Name",
          "Driver",
          "Driver Name",
          "Delivery Partner",
        ]);

        const codStatusFields = matchingFields(schemaFields, [
          "cod_status",
          "COD_Status",
          "COD Status",
          "COD",
          "COD Received",
          "COD Receive",
          "COD Paid",
        ]);

        const orderStatusFields = matchingFields(schemaFields, [
          "Order Status",
          "Order_status",
          "order_status",
          "Status",
        ]);

        const codDateFields = matchingFields(schemaFields, [
          "COD Receive Date",
          "COD Received Date",
          "COD Date",
          "COD Collection Date",
          "Payment Received Date",
        ]);

        const deliveredDateFields = matchingFields(schemaFields, [
          "Delivered Date",
          "COD Delivered Date",
          "Despatch Date",
          "Dispatch Date",
          "Delivery Date",
          "Date Delivered",
        ]);

        const amountFields = matchingFields(schemaFields, [
          "cod_amount",
          "COD Amount1",
          "COD Amount",
          "COD Amount (AED)",
          "CODAmt",
          "COD Value",
          "Grand Total",
          "Net Total",
          "Order Total",
          "Order_Total",
          "total_order_value",
          "Total Amount",
          "Total",
          "Balance Amount",
          "Amount",
        ]);

        const fallbackDateFields = matchingFields(schemaFields, [
          "Dispatch Date 2",
          "Modification Date",
          "Date",
          "Order Date",
          "Created Date",
        ]);

        const dateFields = [
          ...codDateFields,
          ...deliveredDateFields,
          ...fallbackDateFields,
        ];

        if (!dateFields.length) {
          throw new Error(
            "No usable COD, delivered, dispatch, modification, or order date field found",
          );
        }

        const requestedFields = [
          ...orderFields,
          ...storeFields,
          ...courierFields,
          ...codStatusFields,
          ...orderStatusFields,
          ...dateFields,
          ...amountFields,
        ];

        const records = await loadRecords(
          base.baseId,
          airtableToken,
          invoiceTable.name,
          requestedFields,
        );

        for (const record of records) {
          const fields = (record.fields || {}) as Record<string, unknown>;

          const codStatusValue = firstExistingValue(fields, codStatusFields);
          const orderStatusValue = firstExistingValue(
            fields,
            orderStatusFields,
          );
          const receiveDateValue = firstExistingValue(fields, dateFields);

          const baseKey = norm(base.baseName);
          const isFabDoha =
            baseKey.includes("fab") &&
            (baseKey.includes("doha") ||
              baseKey.includes("stock") ||
              baseKey.includes("nonstock"));
          const isTat =
            baseKey.includes("tat") ||
            baseKey.includes("tatlumput") ||
            baseKey.includes("siyam");

          const normalizedOrderStatus = norm(orderStatusValue);
          const codReceiveDateValue = firstExistingValue(
            fields,
            codDateFields,
          );
          const hasCodReceiveDate = text(codReceiveDateValue).trim() !== "";

          // FAB Doha Stock + Non Stock:
          // Order Status = Delivered means COD received automatically.
          // TAT:
          // A populated COD Receive Date is the source of truth.
          // COD_Status is also supported when older records contain it.
          const received = isFabDoha
            ? normalizedOrderStatus === "delivered"
            : isTat
              ? hasCodReceiveDate || isReceived(codStatusValue)
              :
                  isReceived(codStatusValue) ||
                  normalizedOrderStatus.includes("delivered") ||
                  normalizedOrderStatus.includes("codreceived");

          const inSelectedMonth = isInMonth(receiveDateValue, month);

          if (!received) continue;

          if (!inSelectedMonth) continue;
          const storeName =
            text(firstExistingValue(fields, storeFields)) ||
            base.baseName ||
            "Unknown";

          const courierName =
            text(firstExistingValue(fields, courierFields)) ||
            "Not Assigned";

          if (storeFilter && !norm(storeName).includes(storeFilter)) continue;

          if (courierFilter && !norm(courierName).includes(courierFilter)) {
            continue;
          }

          const amountValue = firstExistingValue(fields, amountFields);


          rows.push({
            id: `${base.baseId}:${record.id}`,
            baseName: base.baseName,
            store: storeName,
            courier: courierName,
            orderNo: text(firstExistingValue(fields, orderFields)),
            receiveDate: text(receiveDateValue),
            amount: num(amountValue),
          });
        }

      } catch (error) {
        warnings.push({
          baseName: base.baseName,
          message:
            error instanceof Error ? error.message : "Report load failed",
        });
      }
    }

    const grouped = new Map<string, any>();

    for (const row of rows) {
      const storeName = row.store || "Unassigned Store";
      const key = norm(storeName);

      if (!grouped.has(key)) {
        grouped.set(key, {
          store: storeName,
          orders: 0,
          amount: 0,
          baseNames: new Set<string>(),
          courierMap: new Map(),
        });
      }

      const storeGroup = grouped.get(key);
      storeGroup.orders += 1;
      storeGroup.amount += row.amount;
      storeGroup.baseNames.add(row.baseName);

      if (!storeGroup.courierMap.has(row.courier)) {
        storeGroup.courierMap.set(row.courier, {
          courier: row.courier,
          orders: 0,
          amount: 0,
        });
      }

      const courierGroup = storeGroup.courierMap.get(row.courier);
      courierGroup.orders += 1;
      courierGroup.amount += row.amount;
    }

    const stores = [...grouped.values()]
      .map(({ courierMap, baseNames, ...storeGroup }) => ({
        ...storeGroup,
        baseNames: [...baseNames].sort(),
        couriers: [...courierMap.values()].sort(
          (a: any, b: any) => b.amount - a.amount,
        ),
      }))
      .sort((a, b) => b.amount - a.amount || a.store.localeCompare(b.store));

    return NextResponse.json({
      success: true,
      month,
      rows,
      stores,
      bases: [...new Set(bases.map((base) => base.baseName))].sort(),
      storeOptions: [...new Set(rows.map((row) => row.store))].sort(),
      courierOptions: [...new Set(rows.map((row) => row.courier))].sort(),
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Monthly COD report failed",
      },
      { status: 500 },
    );
  }
}
