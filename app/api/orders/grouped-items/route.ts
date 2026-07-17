import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";

type SchemaField = {
  id: string;
  name: string;
  type?: string;
  options?: {
    linkedTableId?: string;
  };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: SchemaField[];
};

type FieldMap = {
  orderLink: string;
  orderNo: string;
  orderNumber: string;
  customer: string;
  customerNumber: string;
  createdDate: string;
  date: string;
  store: string;
  orderStatus: string;
  itemCode: string;
  sku: string;
  quantity: string;
  supplier: string;
  receivedWh: string;
  billNo: string;
  image: string;
};

const schemaCache = new Map<string, SchemaTable[]>();

function firstValue(value: any): any {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function textValue(value: any): string {
  const first = firstValue(value);

  if (first && typeof first === "object") {
    return String(first.name ?? first.value ?? first.text ?? "");
  }

  return first == null ? "" : String(first);
}

function lowerValue(value: any): string {
  return textValue(value).trim().toLowerCase();
}

function numberValue(value: any): number {
  const parsed = Number(firstValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFieldName(fields: SchemaField[], candidates: string[]) {
  const lookup = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field.name])
  );

  for (const candidate of candidates) {
    const found = lookup.get(candidate.trim().toLowerCase());
    if (found) return found;
  }

  return "";
}

async function getSchema(baseId: string, token: string) {
  const cached = schemaCache.get(baseId);
  if (cached) return cached;

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
    throw new Error(data?.error?.message || "Unable to load Airtable schema");
  }

  const tables = (data.tables || []) as SchemaTable[];
  schemaCache.set(baseId, tables);

  return tables;
}


async function loadLinkedRecordNames({
  baseId,
  token,
  linkedTable,
  recordIds,
}: {
  baseId: string;
  token: string;
  linkedTable: SchemaTable;
  recordIds: string[];
}) {
  const uniqueIds = Array.from(
    new Set(recordIds.filter((id) => String(id || "").startsWith("rec")))
  );

  const names = new Map<string, string>();

  if (uniqueIds.length === 0) return names;

  const primaryField =
    linkedTable.fields.find(
      (field) => field.id === linkedTable.primaryFieldId
    )?.name || linkedTable.fields[0]?.name;

  if (!primaryField) return names;

  for (let index = 0; index < uniqueIds.length; index += 40) {
    const batch = uniqueIds.slice(index, index + 40);

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
      airtableUrl(baseId, linkedTable.name, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          `Unable to resolve linked records from ${linkedTable.name}`
      );
    }

    for (const record of data.records || []) {
      names.set(record.id, textValue(record.fields?.[primaryField]));
    }
  }

  return names;
}

function buildFieldMap(orderEntryTable: SchemaTable): FieldMap {
  const fields = orderEntryTable.fields || [];

  return {
    orderLink: getFieldName(fields, [
      "Order Number",
      "order_no",
      "order no",
      "Order No.",
      "Order No",
      "Invoice",
      "Invoice No.",
      "Invoice No",
      "DU Invoice",
    ]),
    orderNo: getFieldName(fields, [
      "Order Number",
      "Order No.",
      "Order No",
      "order_no",
      "order no",
      "Invoice No.",
      "Invoice No",
    ]),
    orderNumber: getFieldName(fields, [
      "Number (from order no.)",
      "Number",
      "number",
      "Order Number Numeric",
    ]),
    customer: getFieldName(fields, [
      "Customer",
      "Customer Name",
      "Name",
      "Contact",
      "Contact Bak",
    ]),
    customerNumber: getFieldName(fields, [
      "Mobile Number",
      "Contact no.",
      "Contact No.",
      "Contact No",
      "Contact",
      "Phone",
      "Mobile",
    ]),
    createdDate: getFieldName(fields, [
      "created Date",
      "created date",
      "Created Date",
      "date",
      "Date",
    ]),
    date: getFieldName(fields, [
      "date",
      "Date",
      "Created Date",
      "created Date",
      "created date",
    ]),
    store: getFieldName(fields, [
      "Store",
      "store",
      "Select Store",
    ]),
    orderStatus: getFieldName(fields, [
      "Order_status",
      "order_status",
      "Order Status",
      "Status",
    ]),
    itemCode: getFieldName(fields, [
      "Item Code",
      "SKU",
      "sku",
      "Product SKU",
    ]),
    sku: getFieldName(fields, [
      "SKU",
      "sku",
      "Item Code",
      "Product SKU",
    ]),
    quantity: getFieldName(fields, [
      "quantity",
      "Quantity",
      "Qty",
      "QTY",
    ]),
    supplier: getFieldName(fields, [
      "Supplier",
      "Purchase Supplier",
      "Supplier Code",
    ]),
    receivedWh: getFieldName(fields, [
      "received_in_wh_1",
      "Received in WH 1",
      "Received WH 1",
      "Warehouse Received",
      "instock",
    ]),
    billNo: getFieldName(fields, [
      "bill_no",
      "Bill No",
      "Bill No.",
      "Bill Number",
    ]),
    image: getFieldName(fields, [
      "image",
      "Image",
      "Product Image",
    ]),
  };
}

function normalizeRecord(
  record: any,
  map: FieldMap,
  linkedSkuNames: Map<string, string>
) {
  const fields = record.fields || {};

  const orderNo =
    textValue(fields[map.orderNo]) ||
    textValue(fields[map.orderLink]) ||
    "Unknown";

  const rawItemValue =
    fields[map.itemCode] ??
    fields[map.sku] ??
    "";

  const rawLinkedId = Array.isArray(rawItemValue)
    ? String(rawItemValue[0] || "")
    : String(rawItemValue || "");

  const resolvedItemCode =
    linkedSkuNames.get(rawLinkedId) ||
    textValue(rawItemValue) ||
    "";

  const normalizedFields = {
    ...fields,
    "Order Number": orderNo ? [orderNo] : [],
    "Item Code": resolvedItemCode,
    Customer: textValue(fields[map.customer]) || "",
    "Mobile Number": textValue(fields[map.customerNumber]) || "",
    "created Date": textValue(fields[map.createdDate]) || "",
    date: textValue(fields[map.date]) || "",
    Store: textValue(fields[map.store]) || "",
    Order_status: textValue(fields[map.orderStatus]) || "",
    quantity: numberValue(fields[map.quantity]),
    Supplier: textValue(fields[map.supplier]) || "",
    received_in_wh_1: textValue(fields[map.receivedWh]) || "",
    bill_no: textValue(fields[map.billNo]) || "",
    image: fields[map.image] || [],
  };

  return {
    ...record,
    fields: normalizedFields,
  };
}


async function fetchAllTableRecords({
  baseId,
  token,
  tableName,
  maxRecords,
  sortField,
}: {
  baseId: string;
  token: string;
  tableName: string;
  maxRecords: number;
  sortField?: string;
}) {
  let offset = "";
  const records: any[] = [];

  do {
    const params = new URLSearchParams({ pageSize: "100" });

    if (offset) params.set("offset", offset);

    if (sortField) {
      params.set("sort[0][field]", sortField);
      params.set("sort[0][direction]", "desc");
    }

    const response = await fetch(
      airtableUrl(baseId, tableName, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          `Unable to load ${tableName}`
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";

    if (records.length >= maxRecords) offset = "";
  } while (offset);

  return records.slice(0, maxRecords);
}

async function loadI5qDqGroupedOrders({
  airtable,
  schema,
  searchParams,
}: {
  airtable: any;
  schema: SchemaTable[];
  searchParams: URLSearchParams;
}) {
  const orderNoFilter = (searchParams.get("orderNo") || "").trim().toLowerCase();
  const skuFilter = (searchParams.get("sku") || "").trim().toLowerCase();
  const customerFilter = (searchParams.get("customerNumber") || "")
    .trim()
    .toLowerCase();
  const dateFrom = (searchParams.get("dateFrom") || "").trim();
  const dateTo = (searchParams.get("dateTo") || "").trim();
  const statusFilter = (searchParams.get("orderStatus") || "")
    .trim()
    .toLowerCase();
  const modeFilter = (searchParams.get("orderMode") || "ALL")
    .trim()
    .toUpperCase();
  const latest = searchParams.get("latest") === "1";

  const hasFilters = Boolean(
    orderNoFilter ||
      skuFilter ||
      customerFilter ||
      dateFrom ||
      dateTo ||
      statusFilter ||
      modeFilter !== "ALL"
  );

  const maxRecords = latest && !hasFilters ? 300 : 2000;

  const configs = [
    {
      mode: "DQ",
      invoiceTableName: "DQ Invoice",
      entryTableName: "DQ Order Entry",
    },
    {
      mode: "i5Q",
      invoiceTableName: "i5Q Invoice",
      entryTableName: "i5Q Order Entry",
    },
  ].filter(
    (config) =>
      modeFilter === "ALL" ||
      config.mode.toUpperCase() === modeFilter
  );

  const allGroups: any[] = [];

  for (const config of configs) {
    const invoiceTable = schema.find(
      (table) => table.name === config.invoiceTableName
    );
    const entryTable = schema.find(
      (table) => table.name === config.entryTableName
    );

    if (!invoiceTable || !entryTable) {
      throw new Error(
        `${config.mode} tables not found in i5Q/DQ base`
      );
    }

    const invoiceFields = invoiceTable.fields || [];
    const entryFields = entryTable.fields || [];

    const invoiceLinkField = entryFields.find(
      (field) =>
        field.type === "multipleRecordLinks" &&
        field.options?.linkedTableId === invoiceTable.id
    );

    const skuField = entryFields.find(
      (field) =>
        field.type === "multipleRecordLinks" &&
        ["sku", "product", "item code"].includes(
          field.name.trim().toLowerCase()
        )
    );

    const quantityField = getFieldName(entryFields, [
      "quantity",
      "Quantity",
      "Qty",
    ]);
    const sizeField = getFieldName(entryFields, ["Size", "size"]);
    const singlePriceField = getFieldName(entryFields, [
      "single price",
      "Single Price",
    ]);
    const packPriceField = getFieldName(entryFields, [
      "Pack Price",
      "pack price",
    ]);
    const totalPriceField = getFieldName(entryFields, [
      "total price",
      "Total Price",
    ]);
    const imageField = getFieldName(entryFields, [
      "Image",
      "image",
    ]);
    const dateField = getFieldName(entryFields, [
      "date",
      "Created Date",
    ]);
    const statusField = getFieldName(entryFields, [
      "Order_status",
      "Order Status",
    ]);

    if (!invoiceLinkField || !skuField || !quantityField) {
      throw new Error(
        `Required fields not found in ${config.entryTableName}`
      );
    }

    const entryRecords = await fetchAllTableRecords({
      baseId: airtable.baseId,
      token: airtable.token,
      tableName: config.entryTableName,
      maxRecords,
      sortField: getFieldName(entryFields, ["Created Date"]),
    });

    const invoiceIds = Array.from(
      new Set(
        entryRecords
          .flatMap((record) => record.fields?.[invoiceLinkField.name] || [])
          .filter((id: any) => typeof id === "string")
      )
    );

    const invoiceRecords = await fetchAllTableRecords({
      baseId: airtable.baseId,
      token: airtable.token,
      tableName: config.invoiceTableName,
      maxRecords,
      sortField: getFieldName(invoiceFields, ["Date", "Created time"]),
    });

    const invoicesById = new Map(
      invoiceRecords
        .filter((record) => invoiceIds.includes(record.id))
        .map((record) => [record.id, record])
    );

    const linkedProductTable = schema.find(
      (table) => table.id === skuField.options?.linkedTableId
    );

    const productIds = entryRecords.flatMap(
      (record) => record.fields?.[skuField.name] || []
    );

    const productNames = linkedProductTable
      ? await loadLinkedRecordNames({
          baseId: airtable.baseId,
          token: airtable.token,
          linkedTable: linkedProductTable,
          recordIds: productIds,
        })
      : new Map<string, string>();

    const orderNoField = getFieldName(invoiceFields, [
      "Order No.",
      "Order No",
    ]);
    const invoiceDateField = getFieldName(invoiceFields, [
      "Date",
      "Created time",
    ]);
    const invoiceStatusField = getFieldName(invoiceFields, [
      "Order_status",
      "Order Status",
    ]);
    const customerNameField = getFieldName(invoiceFields, [
      "Name (from Contact No.)",
      "Customer Name",
      "Name",
    ]);
    const customerPhoneField = getFieldName(invoiceFields, [
      "Contact No.",
      "Contact No",
      "Mobile Number",
    ]);
    const totalValueField = getFieldName(invoiceFields, [
      "Total Order Value",
      "total_order_value",
      "Grand Total",
    ]);
    const shippingField = getFieldName(invoiceFields, [
      "Shipping",
      "shipping",
    ]);
    const discountField = getFieldName(invoiceFields, [
      "Discount",
      "discount",
    ]);
    const salesPersonField = getFieldName(invoiceFields, [
      "Sales person Name",
      "Sales Person Name",
    ]);

    const grouped = new Map<string, any>();

    for (const record of entryRecords) {
      const invoiceId = textValue(
        record.fields?.[invoiceLinkField.name]
      );
      const invoice = invoicesById.get(invoiceId);
      if (!invoice) continue;

      const invoiceData = invoice.fields || {};
      const displayedOrderNo =
        textValue(invoiceData[orderNoField]) || invoiceId;
      const customerName = textValue(invoiceData[customerNameField]);
      const customerPhone = textValue(invoiceData[customerPhoneField]);
      const orderDate =
        textValue(invoiceData[invoiceDateField]) ||
        textValue(record.fields?.[dateField]);
      const status =
        textValue(invoiceData[invoiceStatusField]) ||
        textValue(record.fields?.[statusField]);

      const productId = textValue(record.fields?.[skuField.name]);
      const itemCode =
        productNames.get(productId) ||
        textValue(record.fields?.["Item Code"]) ||
        productId;

      if (
        orderNoFilter &&
        !displayedOrderNo.toLowerCase().includes(orderNoFilter)
      ) {
        continue;
      }

      if (
        skuFilter &&
        !itemCode.toLowerCase().includes(skuFilter)
      ) {
        continue;
      }

      if (
        customerFilter &&
        !customerPhone.toLowerCase().includes(customerFilter)
      ) {
        continue;
      }

      if (dateFrom && orderDate < dateFrom) continue;
      if (dateTo && orderDate > dateTo) continue;

      if (
        statusFilter &&
        status.toLowerCase() !== statusFilter
      ) {
        continue;
      }

      const groupKey = `${config.mode}:${invoiceId}`;

      if (!grouped.has(groupKey)) {
        const numericParts = displayedOrderNo.match(/\d+/g);

        grouped.set(groupKey, {
          orderNo: displayedOrderNo,
          orderNumber: numericParts
            ? Number(numericParts.join(""))
            : 0,
          orderMode: config.mode,
          customer: customerName || customerPhone || "-",
          customerNumber: customerPhone,
          createdDate: orderDate,
          date: orderDate,
          store: "",
          orderStatus: status,
          salesPerson: textValue(invoiceData[salesPersonField]),
          shipping: numberValue(invoiceData[shippingField]),
          discount: numberValue(invoiceData[discountField]),
          totalValue: numberValue(invoiceData[totalValueField]),
          currency: "QAR",
          totalQty: 0,
          totalItems: 0,
          pending: 0,
          instock: 0,
          dispatchedBySupplier: 0,
          stockOut: 0,
          items: [],
        });
      }

      const quantity = numberValue(record.fields?.[quantityField]);
      const singlePrice = numberValue(
        record.fields?.[singlePriceField]
      );
      const packPrice = numberValue(
        record.fields?.[packPriceField]
      );
      const lineTotal =
        numberValue(record.fields?.[totalPriceField]) ||
        (packPrice > 0 ? packPrice : quantity * singlePrice);

      const group = grouped.get(groupKey);

      group.totalQty += quantity;
      group.totalItems += quantity;
      group.items.push({
        id: record.id,
        fields: {
          image: record.fields?.[imageField] || [],
          "Item Code": itemCode,
          Size: textValue(record.fields?.[sizeField]),
          quantity,
          "single price": singlePrice,
          "Pack Price": packPrice,
          "total price": lineTotal,
          Supplier: "",
          received_in_wh_1: "",
          bill_no: "",
        },
      });
    }

    allGroups.push(...Array.from(grouped.values()));
  }

  allGroups.sort(
    (a, b) =>
      b.orderNumber - a.orderNumber ||
      String(b.date).localeCompare(String(a.date))
  );

  return latest && !hasFilters
    ? allGroups.slice(0, 100)
    : allGroups;
}

export async function GET(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view grouped orders",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);

    const normalizedBaseName = String(airtable.baseName || "")
      .trim()
      .toLowerCase();

    const isI5qDqBase =
      normalizedBaseName.includes("i5q") ||
      normalizedBaseName.includes("dq") ||
      normalizedBaseName.includes("04-10-2026");

    if (isI5qDqBase) {
      const schema = await getSchema(
        airtable.baseId,
        airtable.token
      );

      const orders = await loadI5qDqGroupedOrders({
        airtable,
        schema,
        searchParams,
      });

      return NextResponse.json({
        success: true,
        isI5qDqBase: true,
        baseName: airtable.baseName,
        orders,
      });
    }

    const orderNo = (searchParams.get("orderNo") || "").trim().toLowerCase();
    const sku = (searchParams.get("sku") || "").trim().toLowerCase();
    const customerNumber = (searchParams.get("customerNumber") || "")
      .trim()
      .toLowerCase();
    const dateFrom = (searchParams.get("dateFrom") || "").trim();
    const dateTo = (searchParams.get("dateTo") || "").trim();
    const orderStatus = (searchParams.get("orderStatus") || "")
      .trim()
      .toLowerCase();
    const storeName = (searchParams.get("storeName") || "")
      .trim()
      .toLowerCase();
    const latest = (searchParams.get("latest") || "").trim() === "1";

    const schema = await getSchema(airtable.baseId, airtable.token);

    const orderEntryTableName =
      airtable.tables.orderEntry || "BS Order Entry";

    const orderEntryTable = schema.find(
      (table) => table.name === orderEntryTableName
    );

    if (!orderEntryTable) {
      return NextResponse.json(
        {
          success: false,
          message: `Order Entry table not found: ${orderEntryTableName}`,
        },
        { status: 404 }
      );
    }

    const fieldMap = buildFieldMap(orderEntryTable);

    if (!fieldMap.orderLink && !fieldMap.orderNo) {
      return NextResponse.json(
        {
          success: false,
          message: `Order number field not found in ${orderEntryTableName}`,
        },
        { status: 500 }
      );
    }

    if (!fieldMap.quantity) {
      return NextResponse.json(
        {
          success: false,
          message: `Quantity field not found in ${orderEntryTableName}`,
        },
        { status: 500 }
      );
    }

    const hasFilters =
      orderNo ||
      sku ||
      customerNumber ||
      dateFrom ||
      dateTo ||
      orderStatus ||
      storeName;

    const maxRecords = latest && !hasFilters ? 300 : 2000;

    let offset = "";
    let allRecords: any[] = [];

    do {
      const params = new URLSearchParams({
        pageSize: "100",
      });

      if (offset) params.set("offset", offset);

      if (fieldMap.createdDate) {
        params.set("sort[0][field]", fieldMap.createdDate);
        params.set("sort[0][direction]", "desc");
      }

      const response = await fetch(
        airtableUrl(
          airtable.baseId,
          orderEntryTableName,
          params
        ),
        {
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          {
            success: false,
            message:
              data?.error?.message ||
              data?.error?.error?.message ||
              "Failed to load grouped orders",
            error: data,
          },
          { status: response.status }
        );
      }

      allRecords.push(...(data.records || []));
      offset = data.offset || "";

      if (allRecords.length >= maxRecords) {
        offset = "";
      }
    } while (offset);

    allRecords = allRecords.slice(0, maxRecords);

    const skuFieldName = fieldMap.itemCode || fieldMap.sku;
    const skuSchemaField = orderEntryTable.fields.find(
      (field) => field.name === skuFieldName
    );

    let linkedSkuNames = new Map<string, string>();

    if (
      skuSchemaField?.type === "multipleRecordLinks" &&
      skuSchemaField.options?.linkedTableId
    ) {
      const linkedProductTable = schema.find(
        (table) => table.id === skuSchemaField.options?.linkedTableId
      );

      if (linkedProductTable) {
        const linkedIds: string[] = [];

        for (const record of allRecords) {
          const rawValue = record.fields?.[skuFieldName];

          if (Array.isArray(rawValue)) {
            for (const id of rawValue) {
              if (typeof id === "string") linkedIds.push(id);
            }
          } else if (typeof rawValue === "string") {
            linkedIds.push(rawValue);
          }
        }

        linkedSkuNames = await loadLinkedRecordNames({
          baseId: airtable.baseId,
          token: airtable.token,
          linkedTable: linkedProductTable,
          recordIds: linkedIds,
        });
      }
    }

    allRecords = allRecords.map((record) =>
      normalizeRecord(record, fieldMap, linkedSkuNames)
    );

    let matchingRecords = allRecords;

    if (hasFilters) {
      const matchingOrderNumbers = new Set<string>();

      for (const record of allRecords) {
        const fields = record.fields || {};

        const recordOrder = lowerValue(fields["Order Number"]);
        const item = lowerValue(fields["Item Code"]);
        const mobile = lowerValue(fields["Mobile Number"]);
        const recordDate = textValue(fields.date);
        const status = lowerValue(fields.Order_status);
        const store = lowerValue(fields.Store);

        if (orderNo && !recordOrder.includes(orderNo)) continue;
        if (sku && !item.includes(sku)) continue;
        if (customerNumber && !mobile.includes(customerNumber)) continue;
        if (dateFrom && recordDate < dateFrom) continue;
        if (dateTo && recordDate > dateTo) continue;
        if (orderStatus && status !== orderStatus) continue;
        if (storeName && store !== storeName) continue;

        if (recordOrder) matchingOrderNumbers.add(recordOrder);
      }

      matchingRecords = allRecords.filter((record) => {
        const recordOrder = lowerValue(record.fields?.["Order Number"]);
        return matchingOrderNumbers.has(recordOrder);
      });
    }

    const grouped: Record<string, any> = {};

    for (const record of matchingRecords) {
      const fields = record.fields || {};
      const groupedOrderNo =
        textValue(fields["Order Number"]) || "Unknown";

      if (!grouped[groupedOrderNo]) {
        const numericMatch = groupedOrderNo.match(/\d+/g);
        const fallbackOrderNumber = numericMatch
          ? Number(numericMatch.join(""))
          : 0;

        grouped[groupedOrderNo] = {
          orderNo: groupedOrderNo,
          orderNumber:
            numberValue(fields[fieldMap.orderNumber]) ||
            fallbackOrderNumber,
          customer: textValue(fields.Customer) || "",
          createdDate: textValue(fields["created Date"]) || "",
          date: textValue(fields.date) || "",
          store: textValue(fields.Store) || "",
          orderStatus: textValue(fields.Order_status) || "",
          items: [],
          totalQty: 0,
          totalItems: 0,
          dispatchedBySupplier: 0,
          instock: 0,
          pending: 0,
          stockOut: 0,
        };
      }

      grouped[groupedOrderNo].items.push(record);

      const qty = numberValue(fields.quantity);
      const received =
        lowerValue(fields.received_in_wh_1) === "yes";
      const billNo = textValue(fields.bill_no).trim();
      const billNoLower = billNo.toLowerCase();

      const isStockOut =
        billNoLower === "stock out" ||
        billNoLower === "sold out" ||
        billNoLower === "sold";

      grouped[groupedOrderNo].totalQty += qty;
      grouped[groupedOrderNo].totalItems += qty;

      if (!received) {
        grouped[groupedOrderNo].pending += qty;
      } else if (isStockOut) {
        grouped[groupedOrderNo].stockOut += qty;
      } else if (!billNo) {
        grouped[groupedOrderNo].instock += qty;
      } else {
        grouped[groupedOrderNo].dispatchedBySupplier += qty;
      }
    }

    let orders = Object.values(grouped).sort(
      (a: any, b: any) => b.orderNumber - a.orderNumber
    );

    if (latest && !hasFilters) {
      orders = orders.slice(0, 100);
    }

    return NextResponse.json({
      success: true,
      baseName: airtable.baseName,
      tableName: orderEntryTableName,
      orders,
    });
  } catch (error) {
    console.error("Grouped orders failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load grouped orders",
      },
      { status: 500 }
    );
  }
}
