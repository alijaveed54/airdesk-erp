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

type Source = {
  baseId: string;
  tableName: string;
  invoiceTableName: string;
  sourceName: string;
  fields: {
    orderNo: string;
    itemCode: string;
    quantity: string;
    supplier: string;
    billNo: string;
    activity: string;
    activityDateTime: string;
    orderDate: string;
    image: string;
    receivedInWh1: string;
    soldOut: string;
  };
};

const SOURCES: Source[] = [
  {
    baseId: "app2hjpuQoeEL1Rn2",
    tableName: "BS Order Entry",
    invoiceTableName: "BS Invoice",
    sourceName: "BS",
    fields: {
      orderNo: "Order Number",
      itemCode: "Item Code",
      quantity: "quantity",
      supplier: "Supplier",
      billNo: "bill_no",
      activity: "Supplier Activity",
      activityDateTime: "Activity DateTime",
      orderDate: "date",
      image: "image",
      receivedInWh1: "received_in_wh_1",
      soldOut: "Sold Out",
    },
  },
  {
    baseId: "appiz6tozkQO2TQXt",
    tableName: "FAB Order Entry",
    invoiceTableName: "FAB Invoice",
    sourceName: "FAB Non-Stock",
    fields: {
      orderNo: "Order Number",
      itemCode: "Item Code",
      quantity: "quantity",
      supplier: "Supplier",
      billNo: "bill_no",
      activity: "Supplier Activity",
      activityDateTime: "Activity DateTime",
      orderDate: "date",
      image: "image",
      receivedInWh1: "received_in_wh_1",
      soldOut: "Sold out",
    },
  },
];

const schemaCache = new Map<string, SchemaTable[]>();

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
  "Order No.",
  "Order No",
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
        "",
    ).trim();
  }

  return String(value).trim();
}

function textValue(value: unknown): string {
  return rawValues(value)
    .map(rawText)
    .filter(Boolean)
    .join(" ")
    .trim();
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

function normalizeKey(value: unknown): string {
  return readableText(value).trim().toLowerCase();
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

function findField(fields: SchemaField[], candidates: string[]) {
  const lookup = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field]),
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

async function getSchema(baseId: string, token: string) {
  const cached = schemaCache.get(baseId);
  if (cached) return cached;

  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Unable to inspect Airtable schema (${baseId})`,
    );
  }

  const tables = (data.tables || []) as SchemaTable[];
  schemaCache.set(baseId, tables);
  return tables;
}

function makeRecordIdFormula(ids: string[]) {
  const formulas = ids.map(
    (id) => `RECORD_ID()='${escapeAirtableString(id)}'`,
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
    new Set(ids.filter((id) => /^rec[a-z0-9]+$/i.test(id))),
  );
  const records: any[] = [];

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
          `Unable to resolve linked records from ${table.name}`,
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
    new Set(orderNumbers.map((value) => value.trim()).filter(Boolean)),
  );
  const records: any[] = [];

  for (let index = 0; index < uniqueOrderNumbers.length; index += 15) {
    const batch = uniqueOrderNumbers.slice(index, index + 15);
    const formulas = batch.map(
      (orderNo) =>
        `LOWER({${orderField.name}} & '')=LOWER('${escapeAirtableString(
          orderNo,
        )}')`,
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
      },
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to match customer orders in ${invoiceTable.name}`,
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
      (item) => item.id === field.options?.linkedTableId,
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
  record: any,
  table: SchemaTable,
): Omit<CustomerDetails, "orderNo"> {
  const fields = record.fields || {};
  const nameField = findField(table.fields, CUSTOMER_NAME_CANDIDATES);
  const mobileField = findField(table.fields, CUSTOMER_MOBILE_CANDIDATES);
  const primary = primaryField(table);

  let customerName = readableText(valueOf(fields, nameField?.name || ""));
  let customerMobile = readableText(
    valueOf(fields, mobileField?.name || ""),
  );
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
  parentRecords: any[];
}) {
  const linkFields = detectCustomerLinkFields(parentTable, schema);
  const result = new Map<
    string,
    Omit<CustomerDetails, "orderNo">
  >();

  for (const linkField of linkFields) {
    const linkedTable = schema.find(
      (table) => table.id === linkField.options?.linkedTableId,
    );
    if (!linkedTable) continue;

    const ids = parentRecords.flatMap((record) =>
      recordIds(record.fields?.[linkField.name]),
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
      ]),
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
  token,
  source,
  records,
}: {
  token: string;
  source: Source;
  records: any[];
}) {
  const schema = await getSchema(source.baseId, token);
  const entryTable = schema.find((table) => table.name === source.tableName);
  const invoiceTable =
    schema.find((table) => table.name === source.invoiceTableName) ||
    schema.find((table) =>
      table.name.trim().toLowerCase().includes("invoice"),
    );

  if (!entryTable || !invoiceTable) {
    return new Map<string, CustomerDetails>();
  }

  const directNameField = findField(
    entryTable.fields,
    CUSTOMER_NAME_CANDIDATES,
  );
  const directMobileField = findField(
    entryTable.fields,
    CUSTOMER_MOBILE_CANDIDATES,
  );
  const configuredOrderField = entryTable.fields.find(
    (field) => field.name === source.fields.orderNo,
  );
  const invoiceLinkField =
    (configuredOrderField?.type === "multipleRecordLinks" &&
    configuredOrderField.options?.linkedTableId === invoiceTable.id
      ? configuredOrderField
      : undefined) ||
    entryTable.fields.find(
      (field) =>
        field.type === "multipleRecordLinks" &&
        field.options?.linkedTableId === invoiceTable.id,
    );
  const invoiceOrderField =
    findField(invoiceTable.fields, ORDER_NUMBER_CANDIDATES) ||
    primaryField(invoiceTable);

  const invoiceIds = invoiceLinkField
    ? records.flatMap((record) =>
        recordIds(record.fields?.[invoiceLinkField.name]),
      )
    : [];
  const entryOrderNumbers = records
    .map((record) => readableText(record.fields?.[source.fields.orderNo]))
    .filter(Boolean);

  const invoiceRecordsById = invoiceIds.length
    ? await fetchRecordsByIds({
        baseId: source.baseId,
        token,
        table: invoiceTable,
        ids: invoiceIds,
      })
    : [];

  const linkedInvoiceIds = new Set(invoiceRecordsById.map((record) => record.id));
  const missingOrderNumbers = invoiceIds.length
    ? records
        .filter((record) => {
          const linkedIds = invoiceLinkField
            ? recordIds(record.fields?.[invoiceLinkField.name])
            : [];
          return linkedIds.length === 0 || linkedIds.every((id) => !linkedInvoiceIds.has(id));
        })
        .map((record) => readableText(record.fields?.[source.fields.orderNo]))
        .filter(Boolean)
    : entryOrderNumbers;

  const invoiceRecordsByOrder =
    invoiceOrderField && missingOrderNumbers.length
      ? await fetchInvoiceRecordsByOrderNumbers({
          baseId: source.baseId,
          token,
          invoiceTable,
          orderField: invoiceOrderField,
          orderNumbers: missingOrderNumbers,
        })
      : [];

  const invoiceRecordMap = new Map<string, any>();
  for (const record of [...invoiceRecordsById, ...invoiceRecordsByOrder]) {
    invoiceRecordMap.set(record.id, record);
  }
  const invoiceRecords = Array.from(invoiceRecordMap.values());

  const entryLinkedDetails = await resolveLinkedCustomerDetails({
    baseId: source.baseId,
    token,
    schema,
    parentTable: entryTable,
    parentRecords: records,
  });
  const invoiceLinkedDetails = await resolveLinkedCustomerDetails({
    baseId: source.baseId,
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
      invoiceRecord.fields?.[invoiceOrderField?.name || ""],
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
      customerName: readableText(
        valueOf(fields, directNameField?.name || ""),
      ),
      customerMobile: readableText(
        valueOf(fields, directMobileField?.name || ""),
      ),
    };
    const entryLinked = entryLinkedDetails.get(record.id);
    const displayedOrderNo = readableText(fields[source.fields.orderNo]);
    const linkedInvoiceDetails = invoiceLinkField
      ? recordIds(fields[invoiceLinkField.name])
          .map((id) => invoiceDetailsById.get(id))
          .find(Boolean)
      : undefined;
    const matchedInvoiceDetails = displayedOrderNo
      ? invoiceDetailsByOrder.get(displayedOrderNo.toLowerCase())
      : undefined;
    const invoiceDetails = linkedInvoiceDetails || matchedInvoiceDetails;
    const merged = mergeCustomerDetails(
      invoiceDetails,
      entryLinked,
      direct,
    );

    result.set(record.id, {
      orderNo: invoiceDetails?.orderNo || displayedOrderNo,
      customerName: merged.customerName,
      customerMobile: merged.customerMobile,
    });
  }

  return result;
}


function formatKarachiDate(value: string) {
  if (!value) return "";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

const ORDER_STATUS_CANDIDATES = [
  "Order_status",
  "order_status",
  "Order Status",
  "Order status",
  "Status",
];

const ORDER_DATE_CANDIDATES = ["date", "Order Date", "order_date", "Order date"];
const RECEIVED_UAE_CANDIDATES = [
  "Received in UAE",
  "received_in_uae",
  "Received_in_UAE",
  "received in uae",
  "Received UAE",
];
const RECEIVED_UAE_DATE_CANDIDATES = [
  "Received in UAE Date",
  "received_in_uae_date",
  "Received_in_UAE_Date",
  "received in uae date",
  "Received UAE Date",
  "UAE Received Date",
];
const RECEIVED_WH1_CANDIDATES = [
  "received_in_wh_1",
  "Received in WH 1",
  "Received in WH1",
  "Received WH 1",
];
const STOCK_OUT_CANDIDATES = ["Stock Out", "stock_out", "Stock out"];

function detectedField(
  table: SchemaTable,
  configuredName: string,
  candidates: string[] = [],
) {
  return (
    table.fields.find(
      (field) =>
        field.name.trim().toLowerCase() === configuredName.trim().toLowerCase(),
    ) || findField(table.fields, candidates)
  );
}

function karachiDateKey(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const direct = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatKarachiDate(parsed.toISOString());
}

function dateKeyToUtcMs(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function pendingAgeDays(orderDate: unknown) {
  const orderKey = karachiDateKey(orderDate);
  const todayKey = formatKarachiDate(new Date().toISOString());
  const orderMs = dateKeyToUtcMs(orderKey);
  const todayMs = dateKeyToUtcMs(todayKey);

  if (!Number.isFinite(orderMs) || !Number.isFinite(todayMs)) return -1;
  return Math.floor((todayMs - orderMs) / 86_400_000);
}

function isYes(value: unknown) {
  if (value === true) return true;
  const normalized = readableText(value).trim().toLowerCase();
  return ["yes", "y", "true", "1", "received", "done"].includes(normalized);
}

function displayFlag(value: unknown) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return readableText(value) || "";
}

function firstImageUrl(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageUrl(item);
      if (found) return found;
    }
    return "";
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, any>;
    if (typeof objectValue.url === "string" && objectValue.url) {
      return objectValue.url;
    }

    const thumbnailUrl =
      objectValue.thumbnails?.large?.url ||
      objectValue.thumbnails?.full?.url ||
      objectValue.thumbnails?.small?.url;
    if (typeof thumbnailUrl === "string") return thumbnailUrl;

    for (const nested of Object.values(objectValue)) {
      const found = firstImageUrl(nested);
      if (found) return found;
    }
  }

  return "";
}

function getToken(currentAirtable: any, session: any, baseId: string) {
  const permissionForBase = session?.permissions?.find(
    (permission: any) => permission?.baseId === baseId,
  );

  return String(
    process.env.AIRTABLE_TOKEN ||
      process.env.AUTH_AIRTABLE_TOKEN ||
      permissionForBase?.airtableToken ||
      currentAirtable?.token ||
      "",
  ).trim();
}

function canAccessSource(session: any, source: Source) {
  if (session?.role === "Admin" || session?.superAdmin) return true;

  return Boolean(
    session?.permissions?.some(
      (permission: any) =>
        String(permission?.baseId || "") === source.baseId &&
        Boolean(permission?.canReports),
    ),
  );
}

function resolveSelectedSource(currentAirtable: any): Source | null {
  const selectedBaseId = String(
    currentAirtable?.baseId ??
      currentAirtable?.id ??
      "",
  ).trim();

  if (selectedBaseId) {
    const sourceById = SOURCES.find((source) => source.baseId === selectedBaseId);
    if (sourceById) return sourceById;
  }

  const selectedBaseName = String(
    currentAirtable?.baseName ??
      currentAirtable?.name ??
      "",
  )
    .trim()
    .toLowerCase();

  if (!selectedBaseName) return null;

  if (
    selectedBaseName === "bs" ||
    selectedBaseName.includes("bs order entry")
  ) {
    return SOURCES.find((source) => source.sourceName === "BS") || null;
  }

  if (
    selectedBaseName.includes("fab") &&
    (selectedBaseName.includes("non stock") ||
      selectedBaseName.includes("non-stock"))
  ) {
    return (
      SOURCES.find((source) => source.sourceName === "FAB Non-Stock") || null
    );
  }

  return null;
}

async function fetchPendingSource({
  token,
  source,
  minAgeDays,
}: {
  token: string;
  source: Source;
  minAgeDays: number;
}) {
  const schema = await getSchema(source.baseId, token);
  const entryTable = schema.find((table) => table.name === source.tableName);

  if (!entryTable) {
    return {
      success: false as const,
      status: 500,
      message: `Table ${source.tableName} not found for ${source.sourceName}`,
      error: null,
    };
  }

  const orderNoField = detectedField(entryTable, source.fields.orderNo, ORDER_NUMBER_CANDIDATES);
  const skuField = detectedField(entryTable, source.fields.itemCode, ["Item Code", "SKU", "Sku"]);
  const qtyField = detectedField(entryTable, source.fields.quantity, ["quantity", "Quantity", "Qty"]);
  const supplierField = detectedField(entryTable, source.fields.supplier, ["Supplier", "supplier"]);
  const billNoField = detectedField(entryTable, source.fields.billNo, ["bill_no", "Bill No", "Bill Number", "Dispatch Bill No"]);
  const orderDateField = detectedField(entryTable, source.fields.orderDate, ORDER_DATE_CANDIDATES);
  const imageField = detectedField(entryTable, source.fields.image, ["image", "Image", "Item Image", "Product Image"]);
  const receivedWh1Field = detectedField(entryTable, source.fields.receivedInWh1, RECEIVED_WH1_CANDIDATES);
  const orderStatusField = findField(entryTable.fields, ORDER_STATUS_CANDIDATES);
  const receivedUaeField = findField(entryTable.fields, RECEIVED_UAE_CANDIDATES);
  const receivedUaeDateField = findField(entryTable.fields, RECEIVED_UAE_DATE_CANDIDATES);
  const stockOutField = findField(entryTable.fields, STOCK_OUT_CANDIDATES);

  if (!orderStatusField || !orderDateField) {
    return {
      success: false as const,
      status: 500,
      message: `Required Order Status / Order Date field not found for ${source.sourceName}`,
      error: {
        orderStatusFound: Boolean(orderStatusField),
        orderDateFound: Boolean(orderDateField),
      },
    };
  }

  const formula = `AND(LOWER({${orderStatusField.name}} & '')='order received',{${orderDateField.name}}!='')`;
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: formula,
    });
    params.set("sort[0][field]", orderDateField.name);
    params.set("sort[0][direction]", "asc");
    if (offset) params.set("offset", offset);

    const response = await fetch(
      airtableUrl(source.baseId, source.tableName, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      },
    );
    const data = await response.json();

    if (!response.ok) {
      return {
        success: false as const,
        status: response.status,
        message:
          data?.error?.message ||
          `Order pending report failed for ${source.sourceName}`,
        error: data,
      };
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  const agedRecords = records.filter((record) => {
    const orderDate = record.fields?.[orderDateField.name];
    return pendingAgeDays(orderDate) >= minAgeDays;
  });

  const effectiveSource: Source = {
    ...source,
    fields: {
      ...source.fields,
      orderNo: orderNoField?.name || source.fields.orderNo,
      itemCode: skuField?.name || source.fields.itemCode,
      quantity: qtyField?.name || source.fields.quantity,
      supplier: supplierField?.name || source.fields.supplier,
      billNo: billNoField?.name || source.fields.billNo,
      orderDate: orderDateField.name,
      image: imageField?.name || source.fields.image,
      receivedInWh1: receivedWh1Field?.name || source.fields.receivedInWh1,
    },
  };

  const customerDetails = await resolveOrderCustomerDetails({
    token,
    source: effectiveSource,
    records: agedRecords,
  });

  const rows = agedRecords.map((record) => {
    const fields = record.fields || {};
    const details = customerDetails.get(record.id);
    const orderDateRaw = fields[orderDateField.name];
    const billNo = readableText(valueOf(fields, billNoField?.name || ""));
    const receivedWh1Raw = valueOf(fields, receivedWh1Field?.name || "");
    const receivedUaeRaw = valueOf(fields, receivedUaeField?.name || "");
    const stockOutRaw = valueOf(fields, stockOutField?.name || "");
    const stockOut =
      billNo.trim().toLowerCase() === "stock out" ||
      isYes(stockOutRaw) ||
      readableText(stockOutRaw).trim().toLowerCase() === "stock out";

    return {
      id: `${source.baseId}-${record.id}`,
      source: source.sourceName,
      orderNo:
        details?.orderNo ||
        readableText(valueOf(fields, orderNoField?.name || "")),
      orderDate: karachiDateKey(orderDateRaw),
      pendingDays: pendingAgeDays(orderDateRaw),
      customerName: details?.customerName || "",
      customerMobile: details?.customerMobile || "",
      sku: readableText(valueOf(fields, skuField?.name || "")),
      qty: Number(readableText(valueOf(fields, qtyField?.name || "")) || 0),
      supplier: readableText(valueOf(fields, supplierField?.name || "")),
      billNo,
      receivedInWh1: displayFlag(receivedWh1Raw),
      receivedInWh1Yes: isYes(receivedWh1Raw),
      receivedInUae: displayFlag(receivedUaeRaw),
      receivedInUaeYes: isYes(receivedUaeRaw),
      receivedInUaeDate: karachiDateKey(
        valueOf(fields, receivedUaeDateField?.name || ""),
      ),
      imageUrl: firstImageUrl(valueOf(fields, imageField?.name || "")),
      stockOut,
    };
  });

  return { success: true as const, rows };
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
        { success: false, message: "Supplier accounts cannot view this report" },
        { status: 403 },
      );
    }

    const currentAirtable = await getCurrentAirtableBase();
    const { searchParams } = new URL(request.url);
    const supplier = searchParams.get("supplier")?.trim() || "";
    const state = searchParams.get("state")?.trim() || "";
    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const requestedAge = Number(searchParams.get("minAgeDays") || 5);
    const minAgeDays = Number.isFinite(requestedAge)
      ? Math.min(365, Math.max(5, Math.floor(requestedAge)))
      : 5;

    const selectedSource = resolveSelectedSource(currentAirtable);

    if (!selectedSource) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Order Pending Report is available only for BS and FAB Doha Non Stock. Please select one of these bases first.",
        },
        { status: 400 },
      );
    }

    const isAdmin = session.role === "Admin" || session.superAdmin;
    if (!isAdmin && !currentAirtable.canReports) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to view this report" },
        { status: 403 },
      );
    }

    if (!isAdmin && !canAccessSource(session, selectedSource)) {
      return NextResponse.json(
        { success: false, message: "You do not have permission for the selected base" },
        { status: 403 },
      );
    }

    const token = getToken(currentAirtable, session, selectedSource.baseId);
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: `Airtable token missing for ${selectedSource.sourceName}`,
        },
        { status: 500 },
      );
    }

    const result = await fetchPendingSource({
      token,
      source: selectedSource,
      minAgeDays,
    });

    const results = [result];

    const failed = results.find((result) => !result.success);
    if (failed && !failed.success) {
      return NextResponse.json(
        {
          success: false,
          message: failed.message,
          error: failed.error,
        },
        { status: failed.status },
      );
    }

    const allRows = results.flatMap((result) =>
      result.success ? result.rows : [],
    );

    const allSuppliers = Array.from(
      new Set(allRows.map((row) => row.supplier).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    let rows = allRows;

    if (supplier) {
      rows = rows.filter(
        (row) => row.supplier.trim().toLowerCase() === supplier.toLowerCase(),
      );
    }

    if (state === "stock-out") {
      rows = rows.filter((row) => row.stockOut);
    } else if (state === "received-uae") {
      rows = rows.filter((row) => !row.stockOut && row.receivedInUaeYes);
    } else if (state === "received-wh1") {
      rows = rows.filter(
        (row) => !row.stockOut && !row.receivedInUaeYes && row.receivedInWh1Yes,
      );
    } else if (state === "pending") {
      rows = rows.filter(
        (row) =>
          !row.stockOut && !row.receivedInUaeYes && !row.receivedInWh1Yes,
      );
    }

    if (search) {
      rows = rows.filter((row) =>
        [
          row.orderNo,
          row.customerName,
          row.customerMobile,
          row.sku,
          row.supplier,
          row.billNo,
          row.source,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search),
      );
    }

    rows.sort((a, b) => {
      if (b.pendingDays !== a.pendingDays) return b.pendingDays - a.pendingDays;
      return a.orderNo.localeCompare(b.orderNo, undefined, { numeric: true });
    });

    return NextResponse.json({
      success: true,
      rows,
      suppliers: allSuppliers,
      selectedBase: selectedSource.sourceName,
      minAgeDays,
      summary: {
        totalLines: rows.length,
        totalQty: rows.reduce((total, row) => total + row.qty, 0),
        stockOutLines: rows.filter((row) => row.stockOut).length,
        receivedUaeLines: rows.filter((row) => !row.stockOut && row.receivedInUaeYes).length,
        receivedWh1Lines: rows.filter(
          (row) => !row.stockOut && !row.receivedInUaeYes && row.receivedInWh1Yes,
        ).length,
        pendingLines: rows.filter(
          (row) => !row.stockOut && !row.receivedInUaeYes && !row.receivedInWh1Yes,
        ).length,
      },
    });
  } catch (error) {
    return handleApiError(error, "Order pending report failed");
  }
}
