import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";

type SchemaField = {
  id: string;
  name: string;
  type: string;
  options?: {
    choices?: Array<{ name: string }>;
    linkedTableId?: string;
  };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: SchemaField[];
};

type TableConfig = {
  table: SchemaTable;
  tableName: string;
  orderNo: string;
  sortField: string;
  customer: string;
  phone: string;
  customerLink: string;
  customerTableId: string;
  store: string;
  status: string;
  courier: string;
  date: string;
  total: string;
  shipping: string;
  discount: string;
  currency: "AED" | "QAR";
  source: string;
};

type Cursor = {
  offsets?: Record<string, string>;
};

const schemaCache = new Map<string, SchemaTable[]>();

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function text(value: unknown): string {
  const resolved = first(value);

  if (resolved === null || resolved === undefined) return "";

  if (typeof resolved === "object") {
    const objectValue = resolved as Record<string, unknown>;
    return String(
      objectValue.name ??
        objectValue.value ??
        objectValue.text ??
        ""
    );
  }

  return String(resolved);
}

function number(value: unknown): number {
  const resolved = first(value);
  const parsed = Number(resolved);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findField(fields: SchemaField[], candidates: string[]) {
  const lookup = new Map(
    fields.map((field) => [
      field.name.trim().toLowerCase(),
      field.name,
    ])
  );

  for (const candidate of candidates) {
    const found = lookup.get(candidate.trim().toLowerCase());
    if (found) return found;
  }

  return "";
}

function escapeFormulaValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function containsFormula(fieldName: string, value: string) {
  return `FIND(LOWER('${escapeFormulaValue(
    value
  )}'), LOWER({${fieldName}} & '')) > 0`;
}

function exactFormula(fieldName: string, value: string) {
  return `LOWER({${fieldName}} & '')=LOWER('${escapeFormulaValue(
    value
  )}')`;
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url"
  );
}

function decodeCursor(value: string): Cursor {
  if (!value) return {};

  try {
    return JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Cursor;
  } catch {
    return {};
  }
}

async function getSchema(baseId: string, token: string) {
  const cached = schemaCache.get(baseId);
  if (cached) return cached;

  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(
      baseId
    )}/tables`,
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
        "Unable to load Airtable schema"
    );
  }

  const tables = (data.tables || []) as SchemaTable[];
  schemaCache.set(baseId, tables);

  return tables;
}

function makeConfig(
  table: SchemaTable,
  baseName: string,
  schema: SchemaTable[]
): TableConfig {
  const fields = table.fields || [];
  const normalizedBase = baseName.toLowerCase();
  const isQatar =
    normalizedBase.includes("doha") ||
    normalizedBase.includes("i5q") ||
    normalizedBase.includes("dq");

  const primaryField =
    fields.find(
      (field) => field.id === table.primaryFieldId
    )?.name || "";

  const orderNo =
    findField(fields, [
      "Order No.",
      "Order No",
      "order_no.",
      "Order Number",
      "Order No. (QB)",
      "order no. (QB)",
    ]) || primaryField;

  const autoNumber = findField(fields, [
    "Number",
    "number",
    "Autonumber",
  ]);

  const customerLinkField =
    fields.find((field) => {
      if (
        field.type !== "multipleRecordLinks" ||
        !field.options?.linkedTableId
      ) {
        return false;
      }

      const linkedTable = schema.find(
        (item) => item.id === field.options?.linkedTableId
      );

      if (!linkedTable) return false;

      const linkedTableName = linkedTable.name
        .trim()
        .toLowerCase();

      return (
        linkedTableName === "customer" ||
        linkedTableName === "customers" ||
        linkedTableName.includes("customer")
      );
    }) ||
    fields.find((field) => {
      if (
        field.type !== "multipleRecordLinks" ||
        !field.options?.linkedTableId
      ) {
        return false;
      }

      const normalizedName = field.name
        .trim()
        .toLowerCase();

      return (
        normalizedName === "contact bak" ||
        normalizedName === "contact no." ||
        normalizedName === "contact no" ||
        normalizedName === "customer"
      );
    });

  return {
    table,
    tableName: table.name,
    orderNo,
    sortField:
      autoNumber ||
      findField(fields, [
        "Date",
        "date",
        "Created Date",
        "Created time",
      ]) ||
      orderNo,
    customer: findField(fields, [
      "Consignee",
      "Customer Name",
      "Customer Name (from Contact No. )",
      "Name (from Contact No.)",
      "Contact Name",
      "Consignee Name",
    ]),
    phone: findField(fields, [
      "Telephone1",
      "Telephone 1",
      "Contact No.",
      "Contact No. ",
      "Contact",
      "ConsigneeTel1",
      "Consignee Mobile No 1",
      "ConsigneeMob1",
      "Mobile Number",
      "Phone",
      "Mobile",
    ]),
    customerLink: customerLinkField?.name || "",
    customerTableId:
      customerLinkField?.options?.linkedTableId || "",
    store: findField(fields, [
      "Select Store",
      "Select_Store",
      "Store",
      "store",
    ]),
    status: findField(fields, [
      "order_status",
      "Order_status",
      "Order_Status",
      "Order Status",
    ]),
    courier: findField(fields, [
      "Courier",
      "courier",
      "Driver",
      "Driver Name",
    ]),
    date: findField(fields, [
      "date",
      "Date",
      "Created Date",
      "Created time",
    ]),
    total: findField(fields, [
      "total_order_value",
      "Total Order Value",
      "Order_Total",
      "item value + shipping",
      "Total (item Cost + Shipping)",
      "Grand Total",
    ]),
    shipping: findField(fields, [
      "shipping",
      "Shipping",
      "Shipping_Charges",
      "Shipping Charges",
    ]),
    discount: findField(fields, [
      "discount",
      "Discount",
    ]),
    currency: isQatar ? "QAR" : "AED",
    source:
      table.name === "DQ Invoice"
        ? "DQ"
        : table.name === "i5Q Invoice"
          ? "i5Q"
          : table.name,
  };
}

function makeFilters(
  config: TableConfig,
  searchParams: URLSearchParams
) {
  const q = (searchParams.get("q") || "").trim();
  const customer = (
    searchParams.get("customer") || ""
  ).trim();
  const phone = (searchParams.get("phone") || "").trim();
  const store = (searchParams.get("store") || "").trim();
  const status = (searchParams.get("status") || "").trim();
  const courier = (
    searchParams.get("courier") || ""
  ).trim();
  const dateFrom = (
    searchParams.get("dateFrom") || ""
  ).trim();
  const dateTo = (
    searchParams.get("dateTo") || ""
  ).trim();

  const filters: string[] = [];

  if (q && config.orderNo) {
    filters.push(containsFormula(config.orderNo, q));
  }

  if (customer && config.customer) {
    filters.push(containsFormula(config.customer, customer));
  }

  if (phone && config.phone) {
    filters.push(containsFormula(config.phone, phone));
  }

  if (store && config.store) {
    filters.push(exactFormula(config.store, store));
  }

  if (status && config.status) {
    filters.push(exactFormula(config.status, status));
  }

  if (courier && config.courier) {
    filters.push(exactFormula(config.courier, courier));
  }

  if (dateFrom && config.date) {
    filters.push(
      `IS_AFTER({${config.date}}, '${escapeFormulaValue(
        dateFrom
      )}')`
    );
  }

  if (dateTo && config.date) {
    filters.push(
      `IS_BEFORE({${config.date}}, '${escapeFormulaValue(
        dateTo
      )}')`
    );
  }

  if (filters.length === 1) return filters[0];
  if (filters.length > 1) return `AND(${filters.join(",")})`;

  return "";
}

async function fetchTablePage({
  airtable,
  config,
  offset,
  searchParams,
  pageSize,
}: {
  airtable: Awaited<
    ReturnType<typeof getCurrentAirtableBase>
  >;
  config: TableConfig;
  offset: string;
  searchParams: URLSearchParams;
  pageSize: number;
}) {
  const params = new URLSearchParams({
    pageSize: String(pageSize),
  });

  if (offset) params.set("offset", offset);

  if (config.sortField) {
    params.set("sort[0][field]", config.sortField);
    params.set("sort[0][direction]", "desc");
  }

  const formula = makeFilters(config, searchParams);
  if (formula) params.set("filterByFormula", formula);

  const response = await fetch(
    airtableUrl(
      airtable.baseId,
      config.tableName,
      params
    ),
    {
      headers: airtableHeaders(airtable.token),
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        data?.error?.error?.message ||
        `Orders list failed for ${config.tableName}`
    );
  }

  return {
    records: data.records || [],
    offset: data.offset || "",
  };
}


async function resolveCustomerRecords({
  airtable,
  schema,
  configs,
  pages,
}: {
  airtable: Awaited<
    ReturnType<typeof getCurrentAirtableBase>
  >;
  schema: SchemaTable[];
  configs: TableConfig[];
  pages: Array<{ records: any[]; offset: string }>;
}) {
  const customerValues = new Map<
    string,
    { name: string; phone: string }
  >();

  for (let index = 0; index < configs.length; index += 1) {
    const config = configs[index];

    if (!config.customerLink || !config.customerTableId) {
      continue;
    }

    const customerTable = schema.find(
      (table) => table.id === config.customerTableId
    );

    if (!customerTable) continue;

    const customerNameField = findField(
      customerTable.fields,
      ["Customer Name", "Name", "Consignee", "Full Name"]
    );

    const customerPhoneField = findField(
      customerTable.fields,
      [
        "Contact No.",
        "Contact No",
        "Contact",
        "Phone",
        "Mobile",
        "Telephone1",
      ]
    );

    const customerIds = Array.from(
      new Set(
        pages[index].records
          .flatMap((record: any) => {
            const raw =
              record.fields?.[config.customerLink];

            return Array.isArray(raw)
              ? raw
              : raw
                ? [raw]
                : [];
          })
          .filter(
            (value: unknown) =>
              typeof value === "string" &&
              value.startsWith("rec")
          )
      )
    );

    for (let start = 0; start < customerIds.length; start += 40) {
      const batch = customerIds.slice(start, start + 40);

      const formula =
        batch.length === 1
          ? `RECORD_ID()='${batch[0]}'`
          : `OR(${batch
              .map((id) => `RECORD_ID()='${id}'`)
              .join(",")})`;

      const params = new URLSearchParams({
        pageSize: "100",
        filterByFormula: formula,
      });

      const response = await fetch(
        airtableUrl(
          airtable.baseId,
          customerTable.name,
          params
        ),
        {
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error?.message ||
            data?.error?.error?.message ||
            `Unable to resolve customers from ${customerTable.name}`
        );
      }

      for (const record of data.records || []) {
        customerValues.set(record.id, {
          name: text(
            record.fields?.[customerNameField]
          ),
          phone: text(
            record.fields?.[customerPhoneField]
          ),
        });
      }
    }
  }

  return customerValues;
}

function normalizeRecord(
  record: any,
  config: TableConfig,
  customerValues: Map<
    string,
    { name: string; phone: string }
  >
) {
  const sourceFields = record.fields || {};
  const orderNo = text(sourceFields[config.orderNo]);

  const customerRecordId = text(
    sourceFields[config.customerLink]
  );

  const linkedCustomer =
    customerValues.get(customerRecordId);

  const directCustomer = text(
    sourceFields[config.customer]
  );

  const directPhone = text(sourceFields[config.phone]);

  const hasLinkedCustomer = Boolean(linkedCustomer);

  const customerName = hasLinkedCustomer
    ? linkedCustomer?.name || "-"
    : directCustomer || "-";

  const customerPhone = hasLinkedCustomer
    ? linkedCustomer?.phone || ""
    : directPhone.startsWith("rec")
      ? ""
      : directPhone || "";

  const numericMatch = orderNo.match(/\d+/g);
  const orderNumber = numericMatch
    ? Number(numericMatch.join(""))
    : 0;

  return {
    id: record.id,
    fields: {
      ...sourceFields,
      "order_no.": orderNo,
      Number: orderNumber,
      Consignee: [customerName],
      Telephone1: customerPhone,
      "Select Store":
        text(sourceFields[config.store]) || "",
      order_status:
        text(sourceFields[config.status]) || "",
      Courier: text(sourceFields[config.courier]) || "",
      date: text(sourceFields[config.date]) || "",
      total_order_value: number(
        sourceFields[config.total]
      ),
      shipping: number(sourceFields[config.shipping]),
      discount: number(sourceFields[config.discount]),
      __currency: config.currency,
      __source: config.source,
      __tableName: config.tableName,
      __canUpdateStatus: Boolean(config.status),
      __canUpdateCourier: Boolean(config.courier),
    },
  };
}

export async function GET(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to view orders",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const cursor = decodeCursor(
      searchParams.get("offset") || ""
    );

    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );

    const configuredInvoice =
      airtable.tables?.invoice || "";

    let tableNames: string[] = [];

    const hasI5qDqTables =
      schema.some((table) => table.name === "DQ Invoice") &&
      schema.some((table) => table.name === "i5Q Invoice");

    if (hasI5qDqTables) {
      tableNames = ["DQ Invoice", "i5Q Invoice"];
    } else if (
      configuredInvoice &&
      schema.some(
        (table) => table.name === configuredInvoice
      )
    ) {
      tableNames = [configuredInvoice];
    } else {
      const detected = schema.find((table) =>
        ["BS Invoice", "FAB Invoice", "Invoice"].includes(
          table.name
        )
      );

      if (detected) tableNames = [detected.name];
    }

    if (tableNames.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Configured invoice table was not found in selected base",
        },
        { status: 404 }
      );
    }

    const configs = tableNames.map((tableName) => {
      const table = schema.find(
        (item) => item.name === tableName
      );

      if (!table) {
        throw new Error(
          `Invoice table not found: ${tableName}`
        );
      }

      return makeConfig(
        table,
        airtable.baseName,
        schema
      );
    });

    const perTablePageSize =
      configs.length > 1 ? 50 : 100;

    const pages = await Promise.all(
      configs.map((config) =>
        fetchTablePage({
          airtable,
          config,
          offset:
            cursor.offsets?.[config.tableName] || "",
          searchParams,
          pageSize: perTablePageSize,
        })
      )
    );

    const customerValues =
      await resolveCustomerRecords({
        airtable,
        schema,
        configs,
        pages,
      });

    const records = configs
      .flatMap((config, index) =>
        pages[index].records.map((record: any) =>
          normalizeRecord(
            record,
            config,
            customerValues
          )
        )
      )
      .sort((a, b) => {
        const numberDifference =
          Number(b.fields.Number || 0) -
          Number(a.fields.Number || 0);

        if (numberDifference !== 0) {
          return numberDifference;
        }

        return String(b.fields.date || "").localeCompare(
          String(a.fields.date || "")
        );
      });

    const nextOffsets: Record<string, string> = {};

    configs.forEach((config, index) => {
      if (pages[index].offset) {
        nextOffsets[config.tableName] =
          pages[index].offset;
      }
    });

    const nextOffset =
      Object.keys(nextOffsets).length > 0
        ? encodeCursor({ offsets: nextOffsets })
        : null;

    const statusOptions = Array.from(
      new Set(
        configs.flatMap((config) => {
          const field = config.table.fields.find(
            (item) => item.name === config.status
          );

          return (
            field?.options?.choices?.map(
              (choice) => choice.name
            ) || []
          );
        })
      )
    );

    const courierOptions = Array.from(
      new Set(
        configs.flatMap((config) => {
          const field = config.table.fields.find(
            (item) => item.name === config.courier
          );

          return (
            field?.options?.choices?.map(
              (choice) => choice.name
            ) || []
          );
        })
      )
    );

    return NextResponse.json({
      success: true,
      records,
      nextOffset,
      baseName: airtable.baseName,
      multiInvoiceMode: configs.length > 1,
      capabilities: {
        hasStore: configs.some((config) => config.store),
        hasStatus: configs.some(
          (config) => config.status
        ),
        hasCourier: configs.some(
          (config) => config.courier
        ),
        canUpdateStatus: configs.some(config=>Boolean(config.status)),
        canUpdateCourier: configs.some(config=>Boolean(config.courier)),
      },
      statusOptions,
      courierOptions,
    });
  } catch (error) {
    return handleApiError(error, "Orders list failed");
  }
}
