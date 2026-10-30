import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";

type AirtableRecord = {
  id: string;
  fields: Record<string, any>;
};

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

type CustomerDetails = {
  orderNo: string;
  customerName: string;
  customerMobile: string;
};

type OrderItem = {
  itemCode: string;
  itemDetail: string;
  quantity: number;
  supplier: string;
  billNo: string;
  receivedWH: string;
  receivedUAE: string;
};

type OrderGroup = {
  orderNo: string;
  customer: string;
  mobile: string;
  orderStatus: string;
  date: string;
  items: OrderItem[];
};

const CUSTOMER_NAME_CANDIDATES = [
  "Name (from Contact No.)",
  "Name (from Contact No. )",
  "Customer Name",
  "Customer",
  "Consignee",
  "Consignee Name",
  "Contact Name",
  "Full Name",
  "Name",
];

const CUSTOMER_MOBILE_CANDIDATES = [
  "Mobile Number",
  "Mobile No.",
  "Mobile No",
  "Customer Mobile",
  "Customer Phone",
  "Contact No.",
  "Contact No. ",
  "Contact No",
  "Contact no.",
  "Contact Number",
  "Telephone1",
  "Telephone 1",
  "ConsigneeTel1",
  "Consignee Mobile No 1",
  "ConsigneeMob1",
  "WhatsApp Number",
  "Phone Number",
  "Phone",
  "Mobile",
];

const ORDER_NUMBER_CANDIDATES = [
  "Order Number",
  "Order number",
  "order number",
  "Order No.",
  "Order No",
  "order no.",
  "order_no.",
  "order_no",
  "Invoice No.",
  "Invoice No",
  "Invoice Number",
];

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
        ""
    ).trim();
  }

  return String(value).trim();
}

function text(value: any): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => text(v)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return String(value.name ?? value.value ?? value.text ?? "");
  }
  return String(value);
}

function readableText(value: unknown): string {
  return rawValues(value)
    .map(rawText)
    .filter((item) => item && !/^rec[a-z0-9]+$/i.test(item))
    .join(" ")
    .trim();
}

function recordIds(value: unknown): string[] {
  return rawValues(value)
    .map(rawText)
    .filter((item) => /^rec[a-z0-9]+$/i.test(item));
}

function looksLikePhone(value: string): boolean {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 7;
}

function valueOf(fields: Record<string, unknown>, fieldName: string) {
  return fieldName ? fields[fieldName] : undefined;
}

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function number(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}${String(
    date.getMonth() + 1
  ).padStart(2, "0")}${date.getFullYear()}`;
}

function isDateBill(value: string) {
  return /^\d{8}$/.test(value);
}

function isYes(value: any) {
  const v = text(value).trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1" || v === "checked";
}

function getReason(item: OrderItem) {
  const billNo = item.billNo.trim();
  const wh = isYes(item.receivedWH);
  const uae = isYes(item.receivedUAE);

  if (!billNo && !wh) return "Supplier has not dispatched yet";
  if (!billNo && wh) return "Item Instock";
  if (billNo.toLowerCase() === "stock out" && wh) return "Item Stock Out";
  if (isDateBill(billNo) && wh && !uae) return `Supplier Dispatched on ${billNo} — UAE not yet received`;
  if (isDateBill(billNo) && wh && uae) return `Item received in UAE`;
  return "Processing pending";
}

function formatItemSkuText(itemCode: string, itemDetail: string): string {
  const code = itemCode.trim();
  const detail = itemDetail.trim();
  if (!detail) return code;
  if (!code) return detail;
  if (detail.toLowerCase().includes(code.toLowerCase())) return detail;
  return `${code} | ${detail}`;
}

function findField(fields: any[], names: string[]) {
  const map = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field.name])
  );
  for (const name of names) {
    const found = map.get(name.trim().toLowerCase());
    if (found) return found;
  }
  return "";
}

function findSchemaField(
  fields: SchemaField[],
  candidates: string[]
): SchemaField | undefined {
  const lookup = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field])
  );
  for (const candidate of candidates) {
    const found = lookup.get(candidate.trim().toLowerCase());
    if (found) return found;
  }
  return undefined;
}

function primaryField(table: SchemaTable): SchemaField | undefined {
  return (
    table.fields.find((field) => field.id === table.primaryFieldId) ||
    table.fields[0]
  );
}

function makeRecordIdFormula(ids: string[]) {
  const formulas = ids.map(
    (id) => `RECORD_ID()='${escapeAirtableString(id)}'`
  );
  return formulas.length === 1 ? formulas[0] : `OR(${formulas.join(",")})`;
}

async function fetchRecordsByIds({
  baseId,
  token,
  table,
  ids,
}: {
  baseId: string;
  token: string;
  table: SchemaTable;
  ids: string[];
}) {
  const uniqueIds = Array.from(
    new Set(ids.filter((id) => /^rec[a-z0-9]+$/i.test(id)))
  );
  const records: AirtableRecord[] = [];

  for (let index = 0; index < uniqueIds.length; index += 40) {
    const batch = uniqueIds.slice(index, index + 40);
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: makeRecordIdFormula(batch),
    });

    const response = await fetch(airtableUrl(baseId, table.name, params), {
      headers: airtableHeaders(token),
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to resolve linked records from ${table.name}`
      );
    }

    records.push(...(data.records || []));
  }

  return records;
}

async function fetchInvoiceRecordsByOrderNumbers({
  baseId,
  token,
  invoiceTable,
  orderField,
  orderNumbers,
}: {
  baseId: string;
  token: string;
  invoiceTable: SchemaTable;
  orderField: SchemaField;
  orderNumbers: string[];
}) {
  const uniqueOrderNumbers = Array.from(
    new Set(orderNumbers.map((value) => value.trim()).filter(Boolean))
  );
  const records: AirtableRecord[] = [];

  for (let index = 0; index < uniqueOrderNumbers.length; index += 15) {
    const batch = uniqueOrderNumbers.slice(index, index + 15);
    const formulas = batch.map(
      (orderNo) =>
        `LOWER({${orderField.name}} & '')=LOWER('${escapeAirtableString(
          orderNo
        )}')`
    );
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula:
        formulas.length === 1 ? formulas[0] : `OR(${formulas.join(",")})`,
    });

    const response = await fetch(
      airtableUrl(baseId, invoiceTable.name, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to match customer orders in ${invoiceTable.name}`
      );
    }

    records.push(...(data.records || []));
  }

  return records;
}

function detectCustomerLinkFields(table: SchemaTable, schema: SchemaTable[]) {
  return table.fields.filter((field) => {
    if (field.type !== "multipleRecordLinks" || !field.options?.linkedTableId) {
      return false;
    }
    const linkedTable = schema.find(
      (item) => item.id === field.options?.linkedTableId
    );
    if (!linkedTable) return false;
    const linkedName = linkedTable.name.trim().toLowerCase();
    const fieldName = field.name.trim().toLowerCase();
    return (
      linkedName.includes("customer") ||
      linkedName.includes("contact") ||
      fieldName.includes("customer") ||
      fieldName.includes("contact") ||
      fieldName.includes("mobile") ||
      fieldName.includes("phone")
    );
  });
}

function customerDetailsFromRecord(
  record: AirtableRecord,
  table: SchemaTable
): Omit<CustomerDetails, "orderNo"> {
  const fields = record.fields || {};
  const nameField = findSchemaField(table.fields, CUSTOMER_NAME_CANDIDATES);
  const mobileField = findSchemaField(table.fields, CUSTOMER_MOBILE_CANDIDATES);
  const primary = primaryField(table);

  let customerName = readableText(valueOf(fields, nameField?.name || ""));
  let customerMobile = readableText(valueOf(fields, mobileField?.name || ""));
  const primaryValue = readableText(valueOf(fields, primary?.name || ""));

  if (!customerMobile && primaryValue && looksLikePhone(primaryValue)) {
    customerMobile = primaryValue;
  }

  if (!customerName && primaryValue && !looksLikePhone(primaryValue)) {
    customerName = primaryValue;
  }

  return { customerName, customerMobile };
}

async function resolveLinkedCustomerDetails({
  baseId,
  token,
  schema,
  parentTable,
  parentRecords,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  parentTable: SchemaTable;
  parentRecords: AirtableRecord[];
}) {
  const linkFields = detectCustomerLinkFields(parentTable, schema);
  const result = new Map<string, Omit<CustomerDetails, "orderNo">>();

  for (const linkField of linkFields) {
    const linkedTable = schema.find(
      (table) => table.id === linkField.options?.linkedTableId
    );
    if (!linkedTable) continue;

    const ids = parentRecords.flatMap((record) =>
      recordIds(record.fields?.[linkField.name])
    );
    if (ids.length === 0) continue;

    const linkedRecords = await fetchRecordsByIds({
      baseId,
      token,
      table: linkedTable,
      ids,
    });
    const linkedById = new Map(
      linkedRecords.map((record) => [
        record.id,
        customerDetailsFromRecord(record, linkedTable),
      ])
    );

    for (const parent of parentRecords) {
      const linkedIds = recordIds(parent.fields?.[linkField.name]);
      const current = result.get(parent.id) || {
        customerName: "",
        customerMobile: "",
      };

      for (const linkedId of linkedIds) {
        const details = linkedById.get(linkedId);
        if (!details) continue;
        if (!current.customerName && details.customerName) {
          current.customerName = details.customerName;
        }
        if (!current.customerMobile && details.customerMobile) {
          current.customerMobile = details.customerMobile;
        }
      }

      result.set(parent.id, current);
    }
  }

  return result;
}

function mergeCustomerDetails(
  ...values: Array<Omit<CustomerDetails, "orderNo"> | undefined>
) {
  const merged = {
    customerName: "",
    customerMobile: "",
  };

  for (const value of values) {
    if (!value) continue;
    if (!merged.customerName && value.customerName) {
      merged.customerName = value.customerName;
    }
    if (!merged.customerMobile && value.customerMobile) {
      merged.customerMobile = value.customerMobile;
    }
  }

  return merged;
}

async function resolveOrderCustomerDetails({
  baseId,
  token,
  schema,
  entryTable,
  orderNoFieldName,
  records,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  entryTable: SchemaTable;
  orderNoFieldName: string;
  records: AirtableRecord[];
}) {
  const invoiceTable =
    schema.find((table) => table.name === "BS Invoice") ||
    schema.find((table) => table.name === "FAB Invoice") ||
    schema.find((table) =>
      table.name.trim().toLowerCase().includes("invoice")
    );

  const directNameField = findSchemaField(
    entryTable.fields,
    CUSTOMER_NAME_CANDIDATES
  );
  const directMobileField = findSchemaField(
    entryTable.fields,
    CUSTOMER_MOBILE_CANDIDATES
  );

  const entryLinkedDetails = await resolveLinkedCustomerDetails({
    baseId,
    token,
    schema,
    parentTable: entryTable,
    parentRecords: records,
  });

  if (!invoiceTable) {
    const fallbackResult = new Map<string, CustomerDetails>();
    for (const record of records) {
      const fields = record.fields || {};
      const direct = {
        customerName: readableText(valueOf(fields, directNameField?.name || "")),
        customerMobile: readableText(
          valueOf(fields, directMobileField?.name || "")
        ),
      };
      const entryLinked = entryLinkedDetails.get(record.id);
      const merged = mergeCustomerDetails(entryLinked, direct);
      fallbackResult.set(record.id, {
        orderNo: readableText(fields[orderNoFieldName]),
        customerName: merged.customerName,
        customerMobile: merged.customerMobile,
      });
    }
    return fallbackResult;
  }

  const configuredOrderField = entryTable.fields.find(
    (field) => field.name === orderNoFieldName
  );
  const invoiceLinkField =
    (configuredOrderField?.type === "multipleRecordLinks" &&
    configuredOrderField.options?.linkedTableId === invoiceTable.id
      ? configuredOrderField
      : undefined) ||
    entryTable.fields.find(
      (field) =>
        field.type === "multipleRecordLinks" &&
        field.options?.linkedTableId === invoiceTable.id
    );
  const invoiceOrderField =
    findSchemaField(invoiceTable.fields, ORDER_NUMBER_CANDIDATES) ||
    primaryField(invoiceTable);

  const invoiceIds = invoiceLinkField
    ? records.flatMap((record) =>
        recordIds(record.fields?.[invoiceLinkField.name])
      )
    : [];
  const entryOrderNumbers = records
    .map((record) => readableText(record.fields?.[orderNoFieldName]))
    .filter(Boolean);

  const invoiceRecordsById = invoiceIds.length
    ? await fetchRecordsByIds({
        baseId,
        token,
        table: invoiceTable,
        ids: invoiceIds,
      })
    : [];

  const linkedInvoiceIds = new Set(
    invoiceRecordsById.map((record) => record.id)
  );
  const missingOrderNumbers = invoiceIds.length
    ? records
        .filter((record) => {
          const linkedIds = invoiceLinkField
            ? recordIds(record.fields?.[invoiceLinkField.name])
            : [];
          return (
            linkedIds.length === 0 ||
            linkedIds.every((id) => !linkedInvoiceIds.has(id))
          );
        })
        .map((record) => readableText(record.fields?.[orderNoFieldName]))
        .filter(Boolean)
    : entryOrderNumbers;

  const invoiceRecordsByOrder =
    invoiceOrderField && missingOrderNumbers.length
      ? await fetchInvoiceRecordsByOrderNumbers({
          baseId,
          token,
          invoiceTable,
          orderField: invoiceOrderField,
          orderNumbers: missingOrderNumbers,
        })
      : [];

  const invoiceRecordMap = new Map<string, AirtableRecord>();
  for (const record of [...invoiceRecordsById, ...invoiceRecordsByOrder]) {
    invoiceRecordMap.set(record.id, record);
  }
  const invoiceRecords = Array.from(invoiceRecordMap.values());

  const invoiceLinkedDetails = await resolveLinkedCustomerDetails({
    baseId,
    token,
    schema,
    parentTable: invoiceTable,
    parentRecords: invoiceRecords,
  });

  const invoiceDetailsById = new Map<string, CustomerDetails>();
  const invoiceDetailsByOrder = new Map<string, CustomerDetails>();

  for (const invoiceRecord of invoiceRecords) {
    const direct = customerDetailsFromRecord(invoiceRecord, invoiceTable);
    const linked = invoiceLinkedDetails.get(invoiceRecord.id);
    const merged = mergeCustomerDetails(direct, linked);
    const orderNo = readableText(
      invoiceRecord.fields?.[invoiceOrderField?.name || ""]
    );
    const details = {
      orderNo,
      customerName: merged.customerName,
      customerMobile: merged.customerMobile,
    };

    invoiceDetailsById.set(invoiceRecord.id, details);
    if (orderNo) invoiceDetailsByOrder.set(orderNo.toLowerCase(), details);
  }

  const result = new Map<string, CustomerDetails>();

  for (const record of records) {
    const fields = record.fields || {};
    const direct = {
      customerName: readableText(valueOf(fields, directNameField?.name || "")),
      customerMobile: readableText(
        valueOf(fields, directMobileField?.name || "")
      ),
    };
    const entryLinked = entryLinkedDetails.get(record.id);
    const displayedOrderNo = readableText(fields[orderNoFieldName]);
    const linkedInvoiceDetails = invoiceLinkField
      ? recordIds(fields[invoiceLinkField.name])
          .map((id) => invoiceDetailsById.get(id))
          .find(Boolean)
      : undefined;
    const matchedInvoiceDetails = displayedOrderNo
      ? invoiceDetailsByOrder.get(displayedOrderNo.toLowerCase())
      : undefined;
    const invoiceDetails = linkedInvoiceDetails || matchedInvoiceDetails;
    const merged = mergeCustomerDetails(invoiceDetails, entryLinked, direct);

    result.set(record.id, {
      orderNo: invoiceDetails?.orderNo || displayedOrderNo,
      customerName: merged.customerName,
      customerMobile: merged.customerMobile,
    });
  }

  return result;
}

async function fetchOrderRecords(
  airtable: any,
  tableName: string,
  fields: string[],
  statusFilter: string = "",
  statusFieldName: string = "Order_status"
) {
  const records: AirtableRecord[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    if (statusFilter && statusFilter.toLowerCase() !== "all") {
      const escapedStatus = statusFilter
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
      params.set(
        "filterByFormula",
        `FIND(LOWER('${escapedStatus}'), LOWER({${statusFieldName}} & '')) > 0`
      );
    }

    Array.from(new Set(fields.filter(Boolean))).forEach((field) =>
      params.append("fields[]", field)
    );

    if (offset) {
      params.set("offset", offset);
    }

    const response = await fetch(
      airtableUrl(airtable.baseId, tableName, params),
      {
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || "Airtable fetch failed");
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

function groupOrders(
  records: AirtableRecord[],
  fields: any,
  customerDetailsMap: Map<string, CustomerDetails>
) {
  const orders = new Map<string, OrderGroup>();

  for (const record of records) {
    const f = record.fields;
    const resolvedCustomer = customerDetailsMap.get(record.id);

    const orderNo = (
      resolvedCustomer?.orderNo ||
      readableText(f[fields.orderNo]) ||
      text(f[fields.orderNo])
    ).trim();

    if (!orderNo) {
      continue;
    }

    const customerName = (
      resolvedCustomer?.customerName ||
      readableText(f[fields.customer]) ||
      text(f[fields.customer])
    ).trim();

    const customerMobile = (
      resolvedCustomer?.customerMobile ||
      readableText(f[fields.mobile])
    ).trim();

    const orderStatus = (
      readableText(f[fields.orderStatus]) ||
      text(f[fields.orderStatus])
    ).trim();

    const item: OrderItem = {
      itemCode: text(f[fields.itemCode]),
      itemDetail: text(f[fields.itemDetail]),
      quantity: number(f[fields.quantity]),
      supplier: text(f[fields.supplier]),
      billNo: text(f[fields.billNo]),
      receivedWH: text(f[fields.receivedWH]),
      receivedUAE: text(f[fields.receivedUAE]),
    };

    if (!orders.has(orderNo)) {
      orders.set(orderNo, {
        orderNo,
        customer: customerName,
        mobile: customerMobile,
        orderStatus,
        date: normalizeDate(text(f[fields.date])),
        items: [],
      });
    } else {
      const existing = orders.get(orderNo)!;
      if (!existing.customer && customerName) existing.customer = customerName;
      if (!existing.mobile && customerMobile) existing.mobile = customerMobile;
      if (!existing.orderStatus && orderStatus) {
        existing.orderStatus = orderStatus;
      }
    }

    orders.get(orderNo)!.items.push(item);
  }

  return Array.from(orders.values());
}

function createReportRows(orders: OrderGroup[]) {
  return orders.map((order) => {
    const itemLines = order.items.map((item) => {
      const reason = getReason(item);
      const skuText = formatItemSkuText(item.itemCode, item.itemDetail);

      return `${skuText}
Status: ${reason}`;
    });

    const statusBadgeText = order.orderStatus ? ` [${order.orderStatus}]` : "";
    const customerLabel = [order.customer, order.mobile]
      .filter(Boolean)
      .join(" | ");
    const customerBracket = customerLabel ? ` (${customerLabel})` : "";

    const line = `${order.orderNo}${statusBadgeText}${customerBracket} ${order.date}

${itemLines.join("\n\n")}`;

    const copyText = `${order.orderNo}${statusBadgeText}${customerBracket} ${order.date}

${order.items
  .map(
    (item) =>
      `${formatItemSkuText(item.itemCode, item.itemDetail)} -${getReason(item)}`
  )
  .join("\n")}`;

    return {
      orderNo: order.orderNo,
      orderStatus: order.orderStatus,
      customer: order.customer,
      mobile: order.mobile,
      date: order.date,
      items: order.items.length,
      reason: order.items.map((item) => getReason(item)).join("\n"),
      copyText,
      line,
    };
  });
}

function getOrderFields(table: SchemaTable) {
  const fields = table.fields || [];

  return {
    orderNo: findField(fields, ORDER_NUMBER_CANDIDATES),
    customer: findField(fields, CUSTOMER_NAME_CANDIDATES),
    mobile: findField(fields, CUSTOMER_MOBILE_CANDIDATES),
    date: findField(fields, ["date", "Date", "Order Date", "Created Date"]),
    itemCode: findField(fields, ["Item Code", "SKU", "sku"]),
    itemDetail: findField(fields, [
      "Color",
      "Colour",
      "Product Description",
      "Product/Service",
    ]),
    quantity: findField(fields, ["quantity", "Quantity", "Qty"]),
    supplier: findField(fields, ["Supplier"]),
    billNo: findField(fields, ["bill_no", "Bill No", "Bill No."]),
    receivedWH: findField(fields, [
      "received_in_wh_1",
      "Received In WH 1",
      "Received in WH 1",
    ]),
    receivedUAE: findField(fields, ["Received In UAE", "Received in UAE"]),
    orderStatus: findField(fields, [
      "Order_status",
      "order_status",
      "Order Status",
      "Status",
    ]),
  };
}

export async function GET(request: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    const { searchParams } = new URL(request.url);
    const statusParam = (searchParams.get("status") || "").trim();

    const schemaResponse = await fetch(
      `https://api.airtable.com/v0/meta/bases/${airtable.baseId}/tables`,
      {
        headers: {
          Authorization: `Bearer ${airtable.token}`,
        },
        cache: "no-store",
      }
    );

    const schemaData = await schemaResponse.json();
    const schemaTables = (schemaData.tables || []) as SchemaTable[];

    const table = schemaTables.find(
      (t) =>
        t.name === "BS Order Entry" ||
        t.name === "FAB Order Entry" ||
        t.name === "BS Invoice" ||
        t.name === "Invoice"
    );

    if (!table) {
      throw new Error("Order Entry / Invoice table not found");
    }

    const tableName = table.name;
    const fieldMap = getOrderFields(table);
    const statusFieldName = fieldMap.orderStatus || "Order_status";

    const invoiceTable = schemaTables.find(
      (t) =>
        t.name === "BS Invoice" ||
        t.name === "FAB Invoice" ||
        t.name.trim().toLowerCase().includes("invoice")
    );
    const invoiceLinkField = invoiceTable
      ? table.fields.find(
          (f) =>
            f.type === "multipleRecordLinks" &&
            f.options?.linkedTableId === invoiceTable.id
        )
      : undefined;

    const customerLinkFields = detectCustomerLinkFields(table, schemaTables).map(
      (f) => f.name
    );

    const requiredFields = [
      fieldMap.orderNo,
      fieldMap.customer,
      fieldMap.mobile,
      fieldMap.date,
      fieldMap.itemCode,
      fieldMap.itemDetail,
      fieldMap.quantity,
      fieldMap.supplier,
      fieldMap.billNo,
      fieldMap.receivedWH,
      fieldMap.receivedUAE,
      fieldMap.orderStatus,
      invoiceLinkField?.name || "",
      ...customerLinkFields,
    ].filter(Boolean);

    const records = await fetchOrderRecords(
      airtable,
      tableName,
      requiredFields,
      statusParam,
      statusFieldName
    );

    const customerDetailsMap = await resolveOrderCustomerDetails({
      baseId: airtable.baseId,
      token: airtable.token,
      schema: schemaTables,
      entryTable: table,
      orderNoFieldName: fieldMap.orderNo,
      records,
    });

    const orders = groupOrders(records, fieldMap, customerDetailsMap);

    const rows = createReportRows(orders).sort((a, b) => {
      function convertDate(date: string) {
        const day = Number(date.substring(0, 2));
        const month = Number(date.substring(2, 4));
        const year = Number(date.substring(4, 8));

        return new Date(year, month - 1, day).getTime();
      }

      return convertDate(a.date) - convertDate(b.date);
    });

    return NextResponse.json({
      success: true,
      rows,
      count: rows.length,
    });
  } catch (error: any) {
    return handleApiError(error, "Order Received Pending Report Failed");
  }
}