import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { handleApiError } from "@/lib/airtable";

type SchemaField = {
  id: string;
  name: string;
  type?: string;
};

type SchemaTable = {
  id: string;
  name: string;
  fields: SchemaField[];
};

type Source = {
  sourceName: "TS" | "BS" | "BS Old";
  permissionBaseId?: string;
  baseId: string;
  tableName: string;
};

const SOURCES: Source[] = [
  {
    sourceName: "TS",
    baseId: "app4YLp41AMlWtCxK",
    tableName: "Invoice",
  },
  {
    sourceName: "BS",
    baseId: "app2hjpuQoeEL1Rn2",
    tableName: "BS Invoice",
  },
  {
    sourceName: "BS Old",
    baseId: "appjX7PhaQ1fJ0jbx",
    tableName: "BS Invoice",
    permissionBaseId: "app2hjpuQoeEL1Rn2",
  },
];

const ORDER_CANDIDATES = [
  "order no.",
  "order_no.",
  "Order No.",
  "Order No",
  "Order Number",
  "Invoice No.",
  "Invoice No",
  "Invoice Number",
  "Order ID",
];

const DATE_CANDIDATES = [
  "Date",
  "date",
  "Order Date",
  "Invoice Date",
  "Created Date",
  "created Date",
];

const STATUS_CANDIDATES = [
  "order_status",
  "Order_status",
  "Order Status",
  "Status",
];

const CUSTOMER_NAME_CANDIDATES = [
  "Customer Name (from Contact No. )",
  "Customer Name (from Contact No.)",
  "Customer Name",
  "Contact Name",
  "Customer",
  "Consignee",
  "Consignee Name",
  "Name",
];

const CUSTOMER_MOBILE_CANDIDATES = [
  "Mobile Number",
  "Customer Mobile",
  "Customer Phone",
  "Contact No.",
  "Contact No",
  "Contact no.",
  "Contact no",
  "Telephone1",
  "Telephone 1",
  "ConsigneeTel1",
  "Consignee Mobile No 1",
  "Phone Number",
  "Phone",
  "Mobile",
];

const CITY_CANDIDATES = [
  "City",
  "City Name",
  "Billing Address City",
  "Shipping Address City",
  "Consignee City",
];

const COURIER_CANDIDATES = [
  "Courier",
  "Courier Name",
  "Ship Via",
  "Driver",
  "Driver Name",
  "Delivery Partner",
];

const STORE_CANDIDATES = [
  "Select_Store",
  "Select Store",
  "Store",
  "Store Name",
  "Sales Channel",
  "Location",
];

const AMOUNT_CANDIDATES = [
  "Order_Total",
  "Order Total",
  "total_order_value",
  "Total Amount(Including shipping and VAT Reducing Discount)",
  "Total Amount",
  "Grand Total",
  "Net Total",
  "CODAmt",
  "COD Amount",
  "COD Amount1",
  "COD Value",
  "Amount",
  "Total",
];

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function rawValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function rawText(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;

    return String(
      objectValue.name ??
        objectValue.value ??
        objectValue.text ??
        objectValue.label ??
        objectValue.id ??
        "",
    ).trim();
  }

  return String(value).trim();
}

function textValue(value: unknown) {
  return rawValues(value)
    .map(rawText)
    .filter((item) => item && !/^rec[a-z0-9]+$/i.test(item))
    .join(" ")
    .trim();
}

function numberValue(value: unknown) {
  const raw = rawValues(value)
    .map(rawText)
    .find((item) => item !== "");

  if (!raw) return 0;

  const parsed = Number(String(raw).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function findField(fields: SchemaField[], candidates: string[]) {
  const lookup = new Map(
    fields.map((field) => [normalize(field.name), field]),
  );

  for (const candidate of candidates) {
    const found = lookup.get(normalize(candidate));
    if (found) return found;
  }

  return undefined;
}

function uniqueFields(fields: Array<SchemaField | undefined>) {
  const map = new Map<string, SchemaField>();

  for (const field of fields) {
    if (field) map.set(field.name, field);
  }

  return Array.from(map.values());
}

function getPermission(session: any, baseId: string) {
  return session?.permissions?.find(
    (permission: any) => String(permission?.baseId || "") === baseId,
  );
}

function canReadSource(session: any, source: Source) {
  if (session?.role === "Admin" || session?.superAdmin) return true;

  const permission = getPermission(
    session,
    source.permissionBaseId || source.baseId,
  );

  return Boolean(
    permission &&
      (permission.canReports ||
        permission.canView ||
        permission.canViewOrders),
  );
}

function getToken(session: any, source: Source) {
  const permission = getPermission(
    session,
    source.permissionBaseId || source.baseId,
  );

  return String(
    process.env.AIRTABLE_TOKEN ||
      process.env.AUTH_AIRTABLE_TOKEN ||
      permission?.airtableToken ||
      "",
  ).trim();
}

async function getSchema(baseId: string, token: string) {
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
    throw new Error(
      data?.error?.message || `Unable to inspect Airtable schema (${baseId})`,
    );
  }

  return (data.tables || []) as SchemaTable[];
}

function dateKey(value: unknown) {
  const text = rawValues(value)
    .map(rawText)
    .find(Boolean);

  if (!text) return "";

  const direct = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function monthKey(value: unknown) {
  const key = dateKey(value);
  return key ? key.slice(0, 7) : "";
}

function validMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

async function fetchDeliveredRows({
  source,
  token,
  months,
}: {
  source: Source;
  token: string;
  months: string[];
}) {
  const schema = await getSchema(source.baseId, token);
  const invoiceTable =
    schema.find((table) => table.name === source.tableName) ||
    schema.find(
      (table) => normalize(table.name) === normalize(source.tableName),
    );

  if (!invoiceTable) {
    throw new Error(`${source.tableName} table not found`);
  }

  const invoiceTableName = invoiceTable.name;

  const orderField = findField(invoiceTable.fields, ORDER_CANDIDATES);
  const dateField = findField(invoiceTable.fields, DATE_CANDIDATES);
  const statusField = findField(invoiceTable.fields, STATUS_CANDIDATES);
  const customerNameField = findField(
    invoiceTable.fields,
    CUSTOMER_NAME_CANDIDATES,
  );
  const customerMobileField = findField(
    invoiceTable.fields,
    CUSTOMER_MOBILE_CANDIDATES,
  );
  const cityField = findField(invoiceTable.fields, CITY_CANDIDATES);
  const courierField = findField(invoiceTable.fields, COURIER_CANDIDATES);
  const storeField = findField(invoiceTable.fields, STORE_CANDIDATES);
  const amountField = findField(invoiceTable.fields, AMOUNT_CANDIDATES);

  if (!orderField || !dateField || !statusField) {
    throw new Error(
      `${source.sourceName}: required Order No / Date / Order Status field not found`,
    );
  }

  // Keep the validated field names as plain strings so TypeScript does not
  // lose narrowing inside nested callbacks/functions.
  const orderFieldName = orderField.name;
  const dateFieldName = dateField.name;
  const statusFieldName = statusField.name;

  const requestedFields = uniqueFields([
    orderField,
    dateField,
    statusField,
    customerNameField,
    customerMobileField,
    cityField,
    courierField,
    storeField,
    amountField,
  ]);

  const monthFormula =
    months.length === 1
      ? `DATETIME_FORMAT({${dateFieldName}},'YYYY-MM')='${escapeAirtableString(
          months[0],
        )}'`
      : `OR(${months
          .map(
            (month) =>
              `DATETIME_FORMAT({${dateFieldName}},'YYYY-MM')='${escapeAirtableString(
                month,
              )}'`,
          )
          .join(",")})`;

  const deliveredFormula = `LOWER({${statusFieldName}} & '')='delivered'`;
  const combinedFormula = `AND(${deliveredFormula},${monthFormula})`;

  async function loadRecords(filterByFormula: string) {
    const records: any[] = [];
    let offset = "";

    do {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      params.set("filterByFormula", filterByFormula);

      for (const field of requestedFields) {
        params.append("fields[]", field.name);
      }

      params.set("sort[0][field]", dateFieldName);
      params.set("sort[0][direction]", "asc");

      if (offset) params.set("offset", offset);

      const response = await fetch(
        `https://api.airtable.com/v0/${encodeURIComponent(
          source.baseId,
        )}/${encodeURIComponent(invoiceTableName)}?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(
          data?.error?.message ||
            `Delivered report fetch failed for ${source.sourceName}`,
        ) as Error & { status?: number };

        error.status = response.status;
        throw error;
      }

      records.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);

    return records;
  }

  let records: any[];

  try {
    records = await loadRecords(combinedFormula);
  } catch (error: any) {
    if (error?.status !== 422) throw error;

    // Some lookup/formula date fields reject DATETIME_FORMAT in Airtable.
    // In that case fetch Delivered only and filter the selected months in code.
    records = await loadRecords(deliveredFormula);
  }

  const monthSet = new Set(months);

  return records
    .map((record) => {
      const fields = (record.fields || {}) as Record<string, unknown>;
      const orderDate = dateKey(fields[dateFieldName]);
      const month = monthKey(fields[dateFieldName]);
      const status = textValue(fields[statusFieldName]);

      return {
        id: `${source.baseId}-${record.id}`,
        source: source.sourceName,
        month,
        orderNo: textValue(fields[orderFieldName]),
        orderDate,
        customerName: textValue(
          fields[customerNameField?.name || ""],
        ),
        customerMobile: textValue(
          fields[customerMobileField?.name || ""],
        ),
        city: textValue(fields[cityField?.name || ""]),
        courier: textValue(fields[courierField?.name || ""]),
        store:
          textValue(fields[storeField?.name || ""]) || source.sourceName,
        amount: numberValue(fields[amountField?.name || ""]),
        status: status || "Delivered",
      };
    })
    .filter(
      (row) =>
        normalize(row.status) === "delivered" &&
        monthSet.has(row.month),
    );
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

    if (session.role === "Supplier") {
      return NextResponse.json(
        {
          success: false,
          message: "Supplier accounts cannot download this report",
        },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const months = Array.from(
      new Set(
        String(searchParams.get("months") || "")
          .split(",")
          .map((month) => month.trim())
          .filter(validMonth),
      ),
    ).sort();

    if (months.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Please select at least one valid month",
        },
        { status: 400 },
      );
    }

    if (months.length > 36) {
      return NextResponse.json(
        {
          success: false,
          message: "Maximum 36 months can be selected in one report",
        },
        { status: 400 },
      );
    }

    const accessibleSources = SOURCES.filter((source) =>
      canReadSource(session, source),
    );

    if (accessibleSources.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have report permission for TS or BS",
        },
        { status: 403 },
      );
    }

    const results = await Promise.all(
      accessibleSources.map(async (source) => {
        const token = getToken(session, source);

        if (!token) {
          return {
            source: source.sourceName,
            success: false as const,
            rows: [],
            message: "Airtable token missing",
          };
        }

        try {
          const rows = await fetchDeliveredRows({
            source,
            token,
            months,
          });

          return {
            source: source.sourceName,
            success: true as const,
            rows,
          };
        } catch (error) {
          return {
            source: source.sourceName,
            success: false as const,
            rows: [],
            message:
              error instanceof Error ? error.message : "Report load failed",
          };
        }
      }),
    );

    const warnings = results
      .filter((result) => !result.success)
      .map((result) => ({
        source: result.source,
        message:
          "message" in result ? result.message : "Report load failed",
      }));

    const rows = results
      .flatMap((result) => result.rows)
      .sort((a, b) => {
        if (a.orderDate !== b.orderDate) {
          return a.orderDate.localeCompare(b.orderDate);
        }

        if (a.source !== b.source) {
          return a.source.localeCompare(b.source);
        }

        return a.orderNo.localeCompare(b.orderNo, undefined, {
          numeric: true,
        });
      });

    const monthSummary = months.map((month) => {
      const monthRows = rows.filter((row) => row.month === month);
      const tsOrders = monthRows.filter((row) => row.source === "TS").length;
      const bsOrders = monthRows.filter((row) => row.source === "BS").length;
      const bsOldOrders = monthRows.filter(
        (row) => row.source === "BS Old",
      ).length;

      return {
        month,
        tsOrders,
        bsOrders,
        bsOldOrders,
        totalOrders: monthRows.length,
        totalAmount: monthRows.reduce(
          (total, row) => total + Number(row.amount || 0),
          0,
        ),
      };
    });

    return NextResponse.json({
      success: true,
      selectedMonths: months,
      rows,
      warnings,
      summary: {
        totalOrders: rows.length,
        tsOrders: rows.filter((row) => row.source === "TS").length,
        bsOrders: rows.filter((row) => row.source === "BS").length,
        bsOldOrders: rows.filter((row) => row.source === "BS Old").length,
        totalAmount: rows.reduce(
          (total, row) => total + Number(row.amount || 0),
          0,
        ),
        months: monthSummary,
      },
    });
  } catch (error) {
    return handleApiError(error, "Delivered orders report failed");
  }
}
