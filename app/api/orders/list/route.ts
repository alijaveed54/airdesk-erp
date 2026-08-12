import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
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
  courierStatus: string;
  date: string;
  total: string;
  shipping: string;
  discount: string;
  instock: string;
  currency: "AED" | "QAR";
  source: string;
};

type Cursor = {
  offsets?: Record<string, string>;
};

type ReadyProcessStatus =
  | "green"
  | "orange";

type ReadyProcessSummary = {
  status: ReadyProcessStatus;
  totalItems: number;
  inStockItems: number;
  receivedItems: number;
  soldOutItems: number;
  pendingItems: number;
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


function isBSBaseName(baseName: string) {
  const normalized = String(baseName || "")
    .trim()
    .toLowerCase();

  return (
    normalized.includes("bs order") ||
    normalized.includes("bs invoice") ||
    normalized === "bs"
  );
}

function normalizedValues(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : [value];

  return values
    .map((item) => {
      if (
        item !== null &&
        typeof item === "object"
      ) {
        const objectValue =
          item as Record<string, unknown>;

        return String(
          objectValue.name ??
            objectValue.value ??
            objectValue.text ??
            ""
        );
      }

      return String(item ?? "");
    })
    .map((item) =>
      item.trim().toLowerCase()
    )
    .filter(Boolean);
}

function isYesOrCheckedValue(value: unknown) {
  if (value === true || value === 1) {
    return true;
  }

  return normalizedValues(value).some(
    (item) =>
      item === "yes" ||
      item === "true" ||
      item === "1" ||
      item === "checked"
  );
}

function isInStockValue(value: unknown) {
  if (value === true || value === 1) {
    return true;
  }

  return normalizedValues(value).some(
    (item) =>
      item === "yes" ||
      item === "true" ||
      item === "1" ||
      item === "checked" ||
      item === "in stock" ||
      item === "instock" ||
      item === "available"
  );
}

function isSoldOutValue(value: unknown) {
  return normalizedValues(value).some(
    (item) =>
      item === "yes" ||
      item === "true" ||
      item === "1" ||
      item.includes("sold out") ||
      item.includes("stock out")
  );
}

function isFullInStockInvoice(
  record: any,
  config: TableConfig
) {
  const fields = record.fields || {};

  return (
    text(fields[config.instock])
      .trim()
      .toLowerCase() === "full" &&
    text(fields[config.status])
      .trim()
      .toLowerCase() ===
      "order received"
  );
}

function makeRecordIdFormula(
  recordIds: string[]
) {
  const formulas = recordIds.map(
    (recordId) =>
      `RECORD_ID()='${escapeFormulaValue(
        recordId
      )}'`
  );

  if (formulas.length === 1) {
    return formulas[0];
  }

  return `OR(${formulas.join(",")})`;
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
    courierStatus: findField(fields, [
      "TFM Status",
      "Courier Status",
      "Tracking Status",
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
    instock: findField(fields, [
      "Instock",
      "In Stock",
      "Instock Status",
      "In Stock Status",
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

function getChoiceNames(
  table: SchemaTable,
  fieldName: string
) {
  if (!fieldName) return [];

  const field = table.fields.find(
    (item) => item.name === fieldName
  );

  return (
    field?.options?.choices
      ?.map((choice) => choice.name.trim())
      .filter(Boolean) || []
  );
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


async function fetchBSReadyProcessData({
  airtable,
  schema,
  config,
  searchParams,
}: {
  airtable: Awaited<
    ReturnType<typeof getCurrentAirtableBase>
  >;
  schema: SchemaTable[];
  config: TableConfig;
  searchParams: URLSearchParams;
}) {
  const emptyResult = {
    priorityRecords: [] as any[],
    summaries:
      new Map<string, ReadyProcessSummary>(),
  };

  if (!config.status) {
    return emptyResult;
  }

  const configuredOrderEntryTable =
    airtable.tables?.orderEntry ||
    "BS Order Entry";

  const orderEntryTable =
    schema.find(
      (table) =>
        table.name ===
        configuredOrderEntryTable
    ) ||
    schema.find(
      (table) =>
        table.name === "BS Order Entry"
    );

  if (!orderEntryTable) {
    return emptyResult;
  }

  const invoiceEntryLink =
    config.table.fields
      .filter(
        (field) =>
          field.type ===
            "multipleRecordLinks" &&
          field.options?.linkedTableId ===
            orderEntryTable.id &&
          !field.name
            .trim()
            .toLowerCase()
            .includes("return")
      )
      .sort((firstField, secondField) => {
        const preferredNames = [
          "sku",
          "items",
          "order items",
          "order entry",
        ];

        const firstIndex =
          preferredNames.indexOf(
            firstField.name
              .trim()
              .toLowerCase()
          );

        const secondIndex =
          preferredNames.indexOf(
            secondField.name
              .trim()
              .toLowerCase()
          );

        const firstRank =
          firstIndex === -1
            ? preferredNames.length
            : firstIndex;

        const secondRank =
          secondIndex === -1
            ? preferredNames.length
            : secondIndex;

        return firstRank - secondRank;
      })[0];

  if (!invoiceEntryLink) {
    return emptyResult;
  }

  const invoiceRecords: any[] = [];
  let invoiceOffset = "";

  const appliedFormula =
    makeFilters(config, searchParams);

  const orderReceivedFormula =
    exactFormula(
      config.status,
      "Order Received"
    );

  const invoiceFormula =
    appliedFormula
      ? `AND(${orderReceivedFormula},${appliedFormula})`
      : orderReceivedFormula;

  do {
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula:
        invoiceFormula,
    });

    if (invoiceOffset) {
      params.set(
        "offset",
        invoiceOffset
      );
    }

    if (config.sortField) {
      params.set(
        "sort[0][field]",
        config.sortField
      );
      params.set(
        "sort[0][direction]",
        "desc"
      );
    }

    const response = await fetch(
      airtableUrl(
        airtable.baseId,
        config.tableName,
        params
      ),
      {
        headers: airtableHeaders(
          airtable.token
        ),
        cache: "no-store",
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          "Unable to load Order Received BS orders"
      );
    }

    invoiceRecords.push(
      ...(data.records || [])
    );

    invoiceOffset =
      data.offset || "";
  } while (invoiceOffset);

  if (invoiceRecords.length === 0) {
    return emptyResult;
  }

  const itemIds = Array.from(
    new Set<string>(
      invoiceRecords.flatMap(
        (record) => {
          const value =
            record.fields?.[
              invoiceEntryLink.name
            ];

          return Array.isArray(value)
            ? value
                .map((item) =>
                  String(item || "").trim()
                )
                .filter(Boolean)
            : [];
        }
      )
    )
  );

  const entryFields =
    orderEntryTable.fields || [];

  const fieldMap = {
    receivedInUae: findField(
      entryFields,
      [
        "Received In UAE",
        "Received in UAE",
      ]
    ),
    inStock: findField(
      entryFields,
      [
        "instock",
        "In Stock",
        "Instock",
        "InStock",
      ]
    ),
    soldOut: findField(
      entryFields,
      ["Sold Out"]
    ),
  };

  if (!fieldMap.receivedInUae) {
    console.warn(
      "Ready Process skipped: BS Order Entry field 'Received In UAE' not found."
    );

    return emptyResult;
  }

  const requestedFields =
    Array.from(
      new Set(
        Object.values(fieldMap).filter(
          Boolean
        )
      )
    );

  const entryRecordsById =
    new Map<string, any>();

  for (
    let index = 0;
    index < itemIds.length;
    index += 50
  ) {
    const chunk =
      itemIds.slice(index, index + 50);

    if (chunk.length === 0) {
      continue;
    }

    const params =
      new URLSearchParams({
        pageSize: "100",
        filterByFormula:
          makeRecordIdFormula(chunk),
      });

    requestedFields.forEach(
      (fieldName) => {
        params.append(
          "fields[]",
          fieldName
        );
      }
    );

    const response = await fetch(
      airtableUrl(
        airtable.baseId,
        orderEntryTable.name,
        params
      ),
      {
        headers: airtableHeaders(
          airtable.token
        ),
        cache: "no-store",
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          "Unable to load BS order items for ready processing"
      );
    }

    for (
      const record of data.records || []
    ) {
      entryRecordsById.set(
        record.id,
        record
      );
    }
  }

  const summaries =
    new Map<
      string,
      ReadyProcessSummary
    >();

  for (
    const invoiceRecord of invoiceRecords
  ) {
    const linkedItemValue =
      invoiceRecord.fields?.[
        invoiceEntryLink.name
      ];

    const linkedItemIds =
      Array.isArray(linkedItemValue)
        ? Array.from(
            new Set<string>(
              linkedItemValue
                .map((item) =>
                  String(item || "").trim()
                )
                .filter(Boolean)
            )
          )
        : [];

    if (linkedItemIds.length === 0) {
      continue;
    }

    let inStockItems = 0;
    let receivedItems = 0;
    let soldOutItems = 0;
    let pendingItems = 0;

    for (
      const itemId of linkedItemIds
    ) {
      const itemRecord =
        entryRecordsById.get(itemId);

      if (!itemRecord) {
        pendingItems += 1;
        continue;
      }

      const fields =
        itemRecord.fields || {};

      // "Sold Out" is the single source of truth for ready-process formatting.
      // Supplier Stock Out actions now update this Airtable field directly.
      const soldOut =
        isSoldOutValue(
          fields[fieldMap.soldOut]
        );

      if (soldOut) {
        soldOutItems += 1;
        continue;
      }

      const inStock =
        isInStockValue(
          fields[fieldMap.inStock]
        );

      if (inStock) {
        inStockItems += 1;
        continue;
      }

      const received =
        isYesOrCheckedValue(
          fields[
            fieldMap.receivedInUae
          ]
        );

      if (received) {
        receivedItems += 1;
        continue;
      }

      pendingItems += 1;
    }

    const totalItems =
      linkedItemIds.length;

    const deliverableItems =
      inStockItems +
      receivedItems;

    let status:
      | ReadyProcessStatus
      | "" = "";

    const allItemsReceivedInUae =
      receivedItems === totalItems;

    const mixedInStockAndReceived =
      inStockItems > 0 &&
      receivedItems > 0 &&
      inStockItems +
        receivedItems ===
        totalItems;

    const mixedReadyWithSoldOut =
      soldOutItems > 0 &&
      deliverableItems > 0 &&
      deliverableItems +
        soldOutItems ===
        totalItems;

    if (
      pendingItems === 0 &&
      soldOutItems === 0 &&
      (
        allItemsReceivedInUae ||
        mixedInStockAndReceived
      )
    ) {
      status = "green";
    } else if (
      pendingItems === 0 &&
      mixedReadyWithSoldOut
    ) {
      status = "orange";
    }

    if (status) {
      summaries.set(
        invoiceRecord.id,
        {
          status,
          totalItems,
          inStockItems,
          receivedItems,
          soldOutItems,
          pendingItems,
        }
      );
    }
  }

  const priorityRecords =
    invoiceRecords.filter(
      (record) =>
        isFullInStockInvoice(
          record,
          config
        ) ||
        summaries.has(record.id)
    );

  return {
    priorityRecords,
    summaries,
  };
}


// BS ITEM BLUE RULE V4
// Blue formatting is calculated directly from BS Order Entry rows.
// Rule: every item for the order has Received in WH 1 = Yes and Bill Number is blank.
function orderNumberKey(value: unknown) {
  return text(value).trim().toLowerCase();
}

async function fetchBSItemBlueRules({
  airtable,
  schema,
  config,
  invoiceRecords,
}: {
  airtable: Awaited<
    ReturnType<typeof getCurrentAirtableBase>
  >;
  schema: SchemaTable[];
  config: TableConfig;
  invoiceRecords: any[];
}) {
  const rules = new Map<string, boolean>();

  const configuredOrderEntryTable =
    airtable.tables?.orderEntry || "BS Order Entry";

  const orderEntryTable =
    schema.find(
      (table) => table.name === configuredOrderEntryTable
    ) ||
    schema.find(
      (table) => table.name === "BS Order Entry"
    );

  if (!orderEntryTable) return rules;

  const entryFields = orderEntryTable.fields || [];
  const orderNoField = findField(entryFields, [
    "Order Number",
    "Order No.",
    "Order No",
    "order no.",
    "order no",
    "order_no",
    "Invoice No",
  ]);
  const receivedWhField = findField(entryFields, [
    "received_in_wh_1",
    "Received in WH 1",
    "Received In WH 1",
    "Received WH 1",
    "Warehouse Received",
  ]);
  const billNoField = findField(entryFields, [
    "bill_no",
    "Bill No",
    "Bill No.",
    "Bill Number",
  ]);

  if (!orderNoField || !receivedWhField || !billNoField) {
    console.warn("BS item blue rule skipped because a required Order Entry field is missing", {
      orderEntryTable: orderEntryTable.name,
      orderNoField,
      receivedWhField,
      billNoField,
    });
    return rules;
  }

  const orderNumbers = Array.from(
    new Set(
      invoiceRecords
        .map((record) =>
          text(record.fields?.[config.orderNo]).trim()
        )
        .filter(Boolean)
    )
  );

  const trackedKeys = new Set(
    orderNumbers.map((orderNumber) =>
      orderNumberKey(orderNumber)
    )
  );

  for (const orderNumber of orderNumbers) {
    rules.set(orderNumberKey(orderNumber), false);
  }

  const counts = new Map<
    string,
    { total: number; qualified: number }
  >();

  for (let start = 0; start < orderNumbers.length; start += 20) {
    const batch = orderNumbers.slice(start, start + 20);
    const formulas = batch.map((orderNumber) =>
      exactFormula(orderNoField, orderNumber)
    );
    const filterByFormula =
      formulas.length === 1
        ? formulas[0]
        : `OR(${formulas.join(",")})`;

    let offset = "";

    do {
      const params = new URLSearchParams({
        pageSize: "100",
        filterByFormula,
      });

      params.append("fields[]", orderNoField);
      params.append("fields[]", receivedWhField);
      params.append("fields[]", billNoField);

      if (offset) params.set("offset", offset);

      const response = await fetch(
        airtableUrl(
          airtable.baseId,
          orderEntryTable.name,
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
            "Unable to evaluate BS Order Entry blue rule"
        );
      }

      for (const record of data.records || []) {
        const fields = record.fields || {};
        const key = orderNumberKey(fields[orderNoField]);

        if (!key || !trackedKeys.has(key)) continue;

        const current = counts.get(key) || {
          total: 0,
          qualified: 0,
        };

        current.total += 1;

        const receivedWh = isYesOrCheckedValue(
          fields[receivedWhField]
        );
        const billNumberIsBlank =
          text(fields[billNoField]).trim() === "";

        if (receivedWh && billNumberIsBlank) {
          current.qualified += 1;
        }

        counts.set(key, current);
      }

      offset = data.offset || "";
    } while (offset);
  }

  for (const orderNumber of orderNumbers) {
    const key = orderNumberKey(orderNumber);
    const count = counts.get(key);

    rules.set(
      key,
      Boolean(
        count &&
          count.total > 0 &&
          count.qualified === count.total
      )
    );
  }

  return rules;
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
  >,
  readySummary?: ReadyProcessSummary,
  itemBasedBlueRule?: boolean
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
      __courierStatus:
        text(sourceFields[config.courierStatus]) || "",
      date: text(sourceFields[config.date]) || "",
      total_order_value: number(
        sourceFields[config.total]
      ),
      shipping: number(sourceFields[config.shipping]),
      discount: number(sourceFields[config.discount]),
      Instock: text(sourceFields[config.instock]) || "",
      __allItemsWhYesBillBlank:
        itemBasedBlueRule,
      __currency: config.currency,
      __source: config.source,
      __tableName: config.tableName,
      __canUpdateStatus: Boolean(config.status),
      __canUpdateCourier: Boolean(config.courier),
      __statusOptions: getChoiceNames(
        config.table,
        config.status
      ),
      __courierOptions: getChoiceNames(
        config.table,
        config.courier
      ),
      __readyProcessStatus:
        readySummary?.status || "",
      __readyProcessCounts:
        readySummary
          ? {
              totalItems:
                readySummary.totalItems,
              inStockItems:
                readySummary.inStockItems,
              receivedItems:
                readySummary.receivedItems,
              soldOutItems:
                readySummary.soldOutItems,
              pendingItems:
                readySummary.pendingItems,
            }
          : null,
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

    const isBSBase =
      isBSBaseName(
        airtable.baseName
      );

    let readyProcessSummaries =
      new Map<
        string,
        ReadyProcessSummary
      >();

    if (
      isBSBase &&
      configs.length === 1
    ) {
      const readyProcessData =
        await fetchBSReadyProcessData({
          airtable,
          schema,
          config: configs[0],
          searchParams,
        });

      readyProcessSummaries =
        readyProcessData.summaries;

      if (
        readyProcessData
          .priorityRecords.length > 0
      ) {
        const priorityIds =
          new Set(
            readyProcessData
              .priorityRecords
              .map(
                (record: any) =>
                  record.id
              )
          );

        pages[0].records = [
          ...readyProcessData
            .priorityRecords,
          ...pages[0].records.filter(
            (record: any) =>
              !priorityIds.has(
                record.id
              )
          ),
        ];
      }
    }

    let bsItemBlueRules =
      new Map<string, boolean>();

    if (
      isBSBase &&
      configs.length === 1
    ) {
      bsItemBlueRules =
        await fetchBSItemBlueRules({
          airtable,
          schema,
          config: configs[0],
          invoiceRecords: pages[0].records,
        });
    }

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
            customerValues,
            readyProcessSummaries.get(
              record.id
            ),
            bsItemBlueRules.get(
              orderNumberKey(
                record.fields?.[config.orderNo]
              )
            )
          )
        )
      )
      .sort((a, b) => {
        if (isBSBase) {
          const getPriority = (
            record: any
          ) => {
            const orderStatus =
              String(
                record.fields
                  .order_status || ""
              )
                .trim()
                .toLowerCase();

            if (
              orderStatus !==
              "order received"
            ) {
              return 3;
            }

            const inStockStatus =
              String(
                record.fields
                  .Instock || ""
              )
                .trim()
                .toLowerCase();

            if (
              inStockStatus === "full"
            ) {
              return 0;
            }

            const readyStatus =
              String(
                record.fields
                  .__readyProcessStatus ||
                  ""
              )
                .trim()
                .toLowerCase();

            if (
              readyStatus === "green"
            ) {
              return 1;
            }

            if (
              readyStatus === "orange"
            ) {
              return 2;
            }

            return 3;
          };

          const priorityDifference =
            getPriority(a) -
            getPriority(b);

          if (
            priorityDifference !== 0
          ) {
            return priorityDifference;
          }
        }

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

type InlineUpdateBody = {
  orderId?: unknown;
  tableName?: unknown;
  status?: unknown;
  courier?: unknown;
};

function getAllowedInvoiceTableNames(
  schema: SchemaTable[],
  configuredInvoice: string
) {
  const hasI5qDqTables =
    schema.some((table) => table.name === "DQ Invoice") &&
    schema.some((table) => table.name === "i5Q Invoice");

  if (hasI5qDqTables) {
    return ["DQ Invoice", "i5Q Invoice"];
  }

  if (
    configuredInvoice &&
    schema.some(
      (table) => table.name === configuredInvoice
    )
  ) {
    return [configuredInvoice];
  }

  const detected = schema.find((table) =>
    ["BS Invoice", "FAB Invoice", "Invoice"].includes(
      table.name
    )
  );

  return detected ? [detected.name] : [];
}

function getAccessDetails(value: unknown) {
  const access = (value || {}) as {
    canEdit?: boolean;
    canUpdate?: boolean;
    role?: string;
    userRole?: string;
    user?: { role?: string };
    permissions?: {
      canEdit?: boolean;
      canUpdate?: boolean;
    };
  };

  const role = String(
    access.user?.role ||
      access.role ||
      access.userRole ||
      ""
  )
    .trim()
    .toLowerCase();

  const canEdit =
    access.canEdit ??
    access.canUpdate ??
    access.permissions?.canEdit ??
    access.permissions?.canUpdate;

  return {
    role,
    canEdit,
  };
}

function getWritableValue(
  field: SchemaField,
  rawValue: unknown,
  label: string
) {
  const readonlyTypes = new Set([
    "formula",
    "rollup",
    "count",
    "multipleLookupValues",
    "createdTime",
    "lastModifiedTime",
    "autoNumber",
    "button",
  ]);

  if (readonlyTypes.has(field.type)) {
    throw new Error(`${label} field is not editable`);
  }

  const value = String(rawValue ?? "").trim();

  if (field.type === "singleSelect" && value) {
    const choices =
      field.options?.choices?.map((choice) => choice.name) ||
      [];

    if (choices.length > 0) {
      const canonicalChoice = choices.find(
        (choice) =>
          choice.trim().toLowerCase() ===
          value.toLowerCase()
      );

      if (!canonicalChoice) {
        throw new Error(
          `${label} value is not available in Airtable`
        );
      }

      return canonicalChoice;
    }
  }

  return value || null;
}

export async function PATCH(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to update orders",
        },
        { status: 403 }
      );
    }

    const access = getAccessDetails(airtable);

    if (
      access.role === "supplier" ||
      access.canEdit === false
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to update orders",
        },
        { status: 403 }
      );
    }

    const body = (await request.json()) as InlineUpdateBody;
    const orderId = String(body.orderId || "").trim();
    const tableName = String(body.tableName || "").trim();

    if (!orderId || !orderId.startsWith("rec")) {
      return NextResponse.json(
        {
          success: false,
          message: "Valid Airtable order ID is required",
        },
        { status: 400 }
      );
    }

    if (!tableName) {
      return NextResponse.json(
        {
          success: false,
          message: "Source invoice table is required",
        },
        { status: 400 }
      );
    }

    const hasStatus = Object.prototype.hasOwnProperty.call(
      body,
      "status"
    );
    const hasCourier = Object.prototype.hasOwnProperty.call(
      body,
      "courier"
    );

    if (!hasStatus && !hasCourier) {
      return NextResponse.json(
        {
          success: false,
          message: "No inline changes were provided",
        },
        { status: 400 }
      );
    }

    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );

    const allowedTableNames = getAllowedInvoiceTableNames(
      schema,
      airtable.tables?.invoice || ""
    );

    if (!allowedTableNames.includes(tableName)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "This invoice table is not available in the selected base",
        },
        { status: 400 }
      );
    }

    const table = schema.find(
      (item) => item.name === tableName
    );

    if (!table) {
      return NextResponse.json(
        {
          success: false,
          message: "Invoice table was not found",
        },
        { status: 404 }
      );
    }

    const config = makeConfig(
      table,
      airtable.baseName,
      schema
    );

    const fields: Record<string, string | null> = {};
    const updated: {
      status?: string;
      courier?: string;
    } = {};

    if (hasStatus) {
      if (!config.status) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Order Status is not available in this base",
          },
          { status: 400 }
        );
      }

      const statusField = table.fields.find(
        (field) => field.name === config.status
      );

      if (!statusField) {
        throw new Error("Order Status field was not found");
      }

      const value = getWritableValue(
        statusField,
        body.status,
        "Order Status"
      );

      fields[config.status] = value;
      updated.status = value || "";
    }

    if (hasCourier) {
      if (!config.courier) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Courier is not available in this base",
          },
          { status: 400 }
        );
      }

      const courierField = table.fields.find(
        (field) => field.name === config.courier
      );

      if (!courierField) {
        throw new Error("Courier field was not found");
      }

      const value = getWritableValue(
        courierField,
        body.courier,
        "Courier"
      );

      fields[config.courier] = value;
      updated.courier = value || "";
    }

    const response = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(
        airtable.baseId
      )}/${encodeURIComponent(
        tableName
      )}/${encodeURIComponent(orderId)}`,
      {
        method: "PATCH",
        headers: {
          ...airtableHeaders(airtable.token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields,
          typecast: false,
        }),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          "Airtable inline update failed"
      );
    }

    return NextResponse.json({
      success: true,
      orderId,
      tableName,
      updated,
    });
  } catch (error) {
    return handleApiError(
      error,
      "Order inline update failed"
    );
  }
}
// ADMIN_ORDER_DELETE_V1: The browser button is hidden for non-admin users,
// and this server-side check prevents direct DELETE requests by non-admins.
type AdminDeleteBody = {
  orderId?: unknown;
  tableName?: unknown;
};

async function adminDeleteLinkedRecords({
  baseId,
  token,
  tableName,
  recordIds,
}: {
  baseId: string;
  token: string;
  tableName: string;
  recordIds: string[];
}) {
  let deleted = 0;

  for (let index = 0; index < recordIds.length; index += 10) {
    const batch = recordIds.slice(index, index + 10);
    const params = new URLSearchParams();

    batch.forEach((recordId) => {
      params.append("records[]", recordId);
    });

    const response = await fetch(
      airtableUrl(baseId, tableName, params),
      {
        method: "DELETE",
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw {
        status: response.status,
        message:
          data?.error?.message ||
          data?.error?.error?.message ||
          `Unable to delete linked order items from ${tableName}`,
        error: data,
      };
    }

    deleted += Array.isArray(data?.records)
      ? data.records.length
      : batch.length;
  }

  return deleted;
}

export async function DELETE(request: Request) {
  try {
    const session = (await getSession()) as
      | {
          role?: string;
          superAdmin?: boolean;
        }
      | null;

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Not authenticated",
        },
        { status: 401 }
      );
    }

    const role = String(session.role || "")
      .trim()
      .toLowerCase();

    if (role !== "admin" && !session.superAdmin) {
      return NextResponse.json(
        {
          success: false,
          message: "Only Admin can delete orders",
        },
        { status: 403 }
      );
    }

    const airtable = await getCurrentAirtableBase();
    const body = (await request.json().catch(() => ({}))) as AdminDeleteBody;
    const orderId = String(body.orderId || "").trim();
    const tableName = String(body.tableName || "").trim();

    if (!orderId.startsWith("rec")) {
      return NextResponse.json(
        {
          success: false,
          message: "Valid Airtable order ID is required",
        },
        { status: 400 }
      );
    }

    if (!tableName) {
      return NextResponse.json(
        {
          success: false,
          message: "Source invoice table is required",
        },
        { status: 400 }
      );
    }

    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );
    const allowedTableNames = getAllowedInvoiceTableNames(
      schema,
      airtable.tables?.invoice || ""
    );

    if (!allowedTableNames.includes(tableName)) {
      return NextResponse.json(
        {
          success: false,
          message: "This invoice table is not available in the selected base",
        },
        { status: 400 }
      );
    }

    const invoiceTable = schema.find(
      (table) => table.name === tableName
    );

    if (!invoiceTable) {
      return NextResponse.json(
        {
          success: false,
          message: "Invoice table was not found",
        },
        { status: 404 }
      );
    }

    const invoiceResponse = await fetch(
      `${airtableUrl(
        airtable.baseId,
        tableName
      )}/${encodeURIComponent(orderId)}`,
      {
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
      }
    );
    const invoiceRecord = await invoiceResponse
      .json()
      .catch(() => null);

    if (!invoiceResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            invoiceRecord?.error?.message ||
            invoiceRecord?.error?.error?.message ||
            "Order was not found",
          error: invoiceRecord,
        },
        { status: invoiceResponse.status }
      );
    }

    const linkedGroups = new Map<string, Set<string>>();

    for (const field of invoiceTable.fields || []) {
      if (
        field.type !== "multipleRecordLinks" ||
        !field.options?.linkedTableId
      ) {
        continue;
      }

      const linkedTable = schema.find(
        (table) => table.id === field.options?.linkedTableId
      );
      const linkedTableName = String(linkedTable?.name || "");
      const normalizedLinkedName = linkedTableName
        .trim()
        .toLowerCase();

      if (
        !normalizedLinkedName.includes("order entry") ||
        normalizedLinkedName.includes("return")
      ) {
        continue;
      }

      const value = invoiceRecord?.fields?.[field.name];
      const recordIds = Array.isArray(value)
        ? value
            .map((item: unknown) => String(item || "").trim())
            .filter((item: string) => item.startsWith("rec"))
        : [];

      if (recordIds.length === 0) continue;

      const existing =
        linkedGroups.get(linkedTableName) || new Set<string>();
      recordIds.forEach((recordId: string) => existing.add(recordId));
      linkedGroups.set(linkedTableName, existing);
    }

    let deletedItemCount = 0;

    for (const [linkedTableName, recordIds] of linkedGroups.entries()) {
      deletedItemCount += await adminDeleteLinkedRecords({
        baseId: airtable.baseId,
        token: airtable.token,
        tableName: linkedTableName,
        recordIds: Array.from(recordIds),
      });
    }

    const deleteInvoiceResponse = await fetch(
      `${airtableUrl(
        airtable.baseId,
        tableName
      )}/${encodeURIComponent(orderId)}`,
      {
        method: "DELETE",
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
      }
    );
    const deleteInvoiceData = await deleteInvoiceResponse
      .json()
      .catch(() => null);

    if (!deleteInvoiceResponse.ok) {
      throw {
        status: deleteInvoiceResponse.status,
        message:
          deleteInvoiceData?.error?.message ||
          deleteInvoiceData?.error?.error?.message ||
          "Order invoice delete failed",
        error: deleteInvoiceData,
      };
    }

    return NextResponse.json({
      success: true,
      orderId,
      tableName,
      deletedItemCount,
      deletedInvoice: true,
    });
  } catch (error) {
    return handleApiError(error, "Order delete failed");
  }
}

