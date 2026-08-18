import { airtableHeaders, airtableUrl } from "@/lib/airtable";
import {
  getGreenApiGroup,
  sendGreenApiFileByUrl,
  sendGreenApiText,
} from "@/lib/green-api";

type SupplierAction = "dispatch" | "stock_out";

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

type SourceConfig = {
  baseId: string;
  tableName: string;
  invoiceTableName: string;
  orderNo: string;
  itemCode: string;
  quantity: string;
  supplier: string;
  image: string;
};

export type SupplierWhatsAppContext = {
  recordId: string;
  orderNo: string;
  sku: string;
  qty: number;
  supplier: string;
  imageUrl: string;
  imageFileName: string;
  customerName: string;
  customerMobile: string;
};

export type SupplierWhatsAppResult = {
  success: boolean;
  action: SupplierAction;
  targetGroup: string;
  idMessage?: string;
  message?: string;
};

const SOURCES: SourceConfig[] = [
  {
    baseId: "app2hjpuQoeEL1Rn2",
    tableName: "BS Order Entry",
    invoiceTableName: "BS Invoice",
    orderNo: "Order Number",
    itemCode: "Item Code",
    quantity: "quantity",
    supplier: "Supplier",
    image: "image",
  },
  {
    baseId: "appiz6tozkQO2TQXt",
    tableName: "FAB Order Entry",
    invoiceTableName: "FAB Invoice",
    orderNo: "Order Number",
    itemCode: "Item Code",
    quantity: "quantity",
    supplier: "Supplier",
    image: "image",
  },
];

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

const IMAGE_CANDIDATES = [
  "image",
  "Image",
  "Product Image",
  "Product Images",
  "Images",
  "Image Lookup",
];

const schemaCache = new Map<string, SchemaTable[]>();

function sourceFor(baseId: string, tableName: string) {
  return SOURCES.find(
    (source) => source.baseId === baseId && source.tableName === tableName,
  );
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

function primaryField(table: SchemaTable) {
  return (
    table.fields.find((field) => field.id === table.primaryFieldId) ||
    table.fields[0]
  );
}

function looksLikePhone(value: string) {
  return value.replace(/\D/g, "").length >= 7;
}

function firstImageInfo(value: unknown): { url: string; fileName: string } {
  if (!value) return { url: "", fileName: "" };

  if (typeof value === "string") {
    if (!/^https?:\/\//i.test(value)) return { url: "", fileName: "" };
    let fileName = "";
    try {
      const parsed = new URL(value);
      fileName = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    } catch {
      fileName = "";
    }
    return { url: value, fileName };
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageInfo(item);
      if (found.url) return found;
    }
    return { url: "", fileName: "" };
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, any>;
    if (typeof objectValue.url === "string" && objectValue.url) {
      return {
        url: objectValue.url,
        fileName: String(objectValue.filename || objectValue.fileName || ""),
      };
    }

    const thumbnailUrl =
      objectValue.thumbnails?.large?.url ||
      objectValue.thumbnails?.full?.url ||
      objectValue.thumbnails?.small?.url;
    if (typeof thumbnailUrl === "string" && thumbnailUrl) {
      return {
        url: thumbnailUrl,
        fileName: String(objectValue.filename || objectValue.fileName || ""),
      };
    }

    for (const nested of Object.values(objectValue)) {
      const found = firstImageInfo(nested);
      if (found.url) return found;
    }
  }

  return { url: "", fileName: "" };
}

function safeFileName(fileName: string, sku: string, imageUrl: string) {
  let candidate = String(fileName || "").trim();

  if (!candidate) {
    try {
      candidate = decodeURIComponent(new URL(imageUrl).pathname.split("/").pop() || "");
    } catch {
      candidate = "";
    }
  }

  candidate = candidate
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!/\.[a-z0-9]{2,5}$/i.test(candidate)) {
    candidate = `${String(sku || "sold-out-item").replace(/[^a-z0-9_-]+/gi, "-")}.jpg`;
  }

  return candidate.slice(0, 160) || "sold-out-item.jpg";
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
    throw new Error(data?.error?.message || `Unable to inspect Airtable schema (${baseId})`);
  }

  const tables = (data.tables || []) as SchemaTable[];
  schemaCache.set(baseId, tables);
  return tables;
}

function recordIdFormula(ids: string[]) {
  const formulas = ids.map(
    (id) => `RECORD_ID()='${escapeAirtableString(id)}'`,
  );
  return formulas.length === 1 ? formulas[0] : `OR(${formulas.join(",")})`;
}

async function fetchRecordsByIds(input: {
  baseId: string;
  token: string;
  table: SchemaTable;
  ids: string[];
}) {
  const uniqueIds = Array.from(
    new Set(input.ids.filter((id) => /^rec[a-z0-9]+$/i.test(id))),
  );
  const records: any[] = [];

  for (let index = 0; index < uniqueIds.length; index += 40) {
    const batch = uniqueIds.slice(index, index + 40);
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: recordIdFormula(batch),
    });
    const response = await fetch(
      airtableUrl(input.baseId, input.table.name, params),
      { headers: airtableHeaders(input.token), cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Unable to load ${input.table.name} records`,
      );
    }
    records.push(...(data.records || []));
  }

  return records;
}

async function fetchInvoiceRecordsByOrderNumbers(input: {
  baseId: string;
  token: string;
  invoiceTable: SchemaTable;
  orderField: SchemaField;
  orderNumbers: string[];
}) {
  const uniqueOrderNumbers = Array.from(
    new Set(input.orderNumbers.map((value) => value.trim()).filter(Boolean)),
  );
  const records: any[] = [];

  for (let index = 0; index < uniqueOrderNumbers.length; index += 15) {
    const batch = uniqueOrderNumbers.slice(index, index + 15);
    const formulas = batch.map(
      (orderNo) =>
        `LOWER({${input.orderField.name}} & '')=LOWER('${escapeAirtableString(orderNo)}')`,
    );
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula:
        formulas.length === 1 ? formulas[0] : `OR(${formulas.join(",")})`,
    });
    const response = await fetch(
      airtableUrl(input.baseId, input.invoiceTable.name, params),
      { headers: airtableHeaders(input.token), cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Unable to match orders in ${input.invoiceTable.name}`,
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

    const linkedName = linkedTable.name.toLowerCase();
    const fieldName = field.name.toLowerCase();
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

function customerDetailsFromRecord(record: any, table: SchemaTable) {
  const fields = record.fields || {};
  const nameField = findField(table.fields, CUSTOMER_NAME_CANDIDATES);
  const mobileField = findField(table.fields, CUSTOMER_MOBILE_CANDIDATES);
  const primary = primaryField(table);

  let customerName = readableText(fields[nameField?.name || ""]);
  let customerMobile = readableText(fields[mobileField?.name || ""]);
  const primaryValue = readableText(fields[primary?.name || ""]);

  if (!customerMobile && primaryValue && looksLikePhone(primaryValue)) {
    customerMobile = primaryValue;
  }
  if (!customerName && primaryValue && !looksLikePhone(primaryValue)) {
    customerName = primaryValue;
  }

  return { customerName, customerMobile };
}

async function resolveLinkedCustomerDetails(input: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  parentTable: SchemaTable;
  parentRecords: any[];
}) {
  const linkFields = detectCustomerLinkFields(input.parentTable, input.schema);
  const result = new Map<string, { customerName: string; customerMobile: string }>();

  for (const linkField of linkFields) {
    const linkedTable = input.schema.find(
      (table) => table.id === linkField.options?.linkedTableId,
    );
    if (!linkedTable) continue;

    const ids = input.parentRecords.flatMap((record) =>
      recordIds(record.fields?.[linkField.name]),
    );
    if (!ids.length) continue;

    const linkedRecords = await fetchRecordsByIds({
      baseId: input.baseId,
      token: input.token,
      table: linkedTable,
      ids,
    });
    const linkedById = new Map(
      linkedRecords.map((record) => [
        record.id,
        customerDetailsFromRecord(record, linkedTable),
      ]),
    );

    for (const parent of input.parentRecords) {
      const current = result.get(parent.id) || {
        customerName: "",
        customerMobile: "",
      };
      for (const linkedId of recordIds(parent.fields?.[linkField.name])) {
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
  ...values: Array<{ customerName: string; customerMobile: string } | undefined>
) {
  const merged = { customerName: "", customerMobile: "" };
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

async function resolveOrderCustomerDetails(input: {
  token: string;
  source: SourceConfig;
  schema: SchemaTable[];
  entryTable: SchemaTable;
  invoiceTable?: SchemaTable;
  records: any[];
}) {
  const result = new Map<
    string,
    { orderNo: string; customerName: string; customerMobile: string }
  >();

  const directNameField = findField(
    input.entryTable.fields,
    CUSTOMER_NAME_CANDIDATES,
  );
  const directMobileField = findField(
    input.entryTable.fields,
    CUSTOMER_MOBILE_CANDIDATES,
  );

  if (!input.invoiceTable) {
    for (const record of input.records) {
      result.set(record.id, {
        orderNo: readableText(record.fields?.[input.source.orderNo]),
        customerName: readableText(record.fields?.[directNameField?.name || ""]),
        customerMobile: readableText(record.fields?.[directMobileField?.name || ""]),
      });
    }
    return result;
  }

  const configuredOrderField = input.entryTable.fields.find(
    (field) => field.name === input.source.orderNo,
  );
  const invoiceLinkField =
    (configuredOrderField?.type === "multipleRecordLinks" &&
    configuredOrderField.options?.linkedTableId === input.invoiceTable.id
      ? configuredOrderField
      : undefined) ||
    input.entryTable.fields.find(
      (field) =>
        field.type === "multipleRecordLinks" &&
        field.options?.linkedTableId === input.invoiceTable?.id,
    );
  const invoiceOrderField =
    findField(input.invoiceTable.fields, ORDER_NUMBER_CANDIDATES) ||
    primaryField(input.invoiceTable);

  const invoiceIds = invoiceLinkField
    ? input.records.flatMap((record) =>
        recordIds(record.fields?.[invoiceLinkField.name]),
      )
    : [];
  const directOrderNumbers = input.records
    .map((record) => readableText(record.fields?.[input.source.orderNo]))
    .filter(Boolean);

  const invoicesById = invoiceIds.length
    ? await fetchRecordsByIds({
        baseId: input.source.baseId,
        token: input.token,
        table: input.invoiceTable,
        ids: invoiceIds,
      })
    : [];

  const knownInvoiceIds = new Set(invoicesById.map((record) => record.id));
  const missingOrderNumbers = invoiceIds.length
    ? input.records
        .filter((record) => {
          const linkedIds = invoiceLinkField
            ? recordIds(record.fields?.[invoiceLinkField.name])
            : [];
          return (
            linkedIds.length === 0 ||
            linkedIds.every((id) => !knownInvoiceIds.has(id))
          );
        })
        .map((record) => readableText(record.fields?.[input.source.orderNo]))
        .filter(Boolean)
    : directOrderNumbers;

  const invoicesByOrder =
    invoiceOrderField && missingOrderNumbers.length
      ? await fetchInvoiceRecordsByOrderNumbers({
          baseId: input.source.baseId,
          token: input.token,
          invoiceTable: input.invoiceTable,
          orderField: invoiceOrderField,
          orderNumbers: missingOrderNumbers,
        })
      : [];

  const invoiceRecordMap = new Map<string, any>();
  for (const record of [...invoicesById, ...invoicesByOrder]) {
    invoiceRecordMap.set(record.id, record);
  }
  const invoiceRecords = Array.from(invoiceRecordMap.values());

  const entryLinked = await resolveLinkedCustomerDetails({
    baseId: input.source.baseId,
    token: input.token,
    schema: input.schema,
    parentTable: input.entryTable,
    parentRecords: input.records,
  });
  const invoiceLinked = await resolveLinkedCustomerDetails({
    baseId: input.source.baseId,
    token: input.token,
    schema: input.schema,
    parentTable: input.invoiceTable,
    parentRecords: invoiceRecords,
  });

  const invoiceDetailsById = new Map<
    string,
    { orderNo: string; customerName: string; customerMobile: string }
  >();
  const invoiceDetailsByOrder = new Map<
    string,
    { orderNo: string; customerName: string; customerMobile: string }
  >();

  for (const invoiceRecord of invoiceRecords) {
    const direct = customerDetailsFromRecord(invoiceRecord, input.invoiceTable);
    const merged = mergeCustomerDetails(
      direct,
      invoiceLinked.get(invoiceRecord.id),
    );
    const orderNo = readableText(
      invoiceRecord.fields?.[invoiceOrderField?.name || ""],
    );
    const details = { orderNo, ...merged };
    invoiceDetailsById.set(invoiceRecord.id, details);
    if (orderNo) invoiceDetailsByOrder.set(orderNo.toLowerCase(), details);
  }

  for (const record of input.records) {
    const direct = {
      customerName: readableText(
        record.fields?.[directNameField?.name || ""],
      ),
      customerMobile: readableText(
        record.fields?.[directMobileField?.name || ""],
      ),
    };
    const displayedOrderNo = readableText(
      record.fields?.[input.source.orderNo],
    );
    const linkedInvoiceDetails = invoiceLinkField
      ? recordIds(record.fields?.[invoiceLinkField.name])
          .map((id) => invoiceDetailsById.get(id))
          .find(Boolean)
      : undefined;
    const matchedInvoiceDetails = displayedOrderNo
      ? invoiceDetailsByOrder.get(displayedOrderNo.toLowerCase())
      : undefined;
    const invoiceDetails = linkedInvoiceDetails || matchedInvoiceDetails;
    const merged = mergeCustomerDetails(
      invoiceDetails,
      entryLinked.get(record.id),
      direct,
    );

    result.set(record.id, {
      orderNo: invoiceDetails?.orderNo || displayedOrderNo,
      ...merged,
    });
  }

  return result;
}

export async function loadSupplierWhatsAppContexts(input: {
  baseId: string;
  tableName: string;
  recordIds: string[];
  token: string;
}) {
  const source = sourceFor(input.baseId, input.tableName);
  if (!source) throw new Error("Unsupported supplier source for WhatsApp notification");

  const schema = await getSchema(input.baseId, input.token);
  const entryTable = schema.find((table) => table.name === input.tableName);
  if (!entryTable) throw new Error(`${input.tableName} table was not found`);

  const invoiceTable =
    schema.find((table) => table.name === source.invoiceTableName) ||
    schema.find((table) => table.name.toLowerCase().includes("invoice"));
  const records = await fetchRecordsByIds({
    baseId: input.baseId,
    token: input.token,
    table: entryTable,
    ids: input.recordIds,
  });

  const details = await resolveOrderCustomerDetails({
    token: input.token,
    source,
    schema,
    entryTable,
    invoiceTable,
    records,
  });

  const orderField =
    entryTable.fields.find((field) => field.name === source.orderNo) ||
    findField(entryTable.fields, ORDER_NUMBER_CANDIDATES);
  const skuField =
    entryTable.fields.find((field) => field.name === source.itemCode) ||
    findField(entryTable.fields, ["Item Code", "SKU", "Sku", "Item SKU"]);
  const qtyField =
    entryTable.fields.find((field) => field.name === source.quantity) ||
    findField(entryTable.fields, ["quantity", "Quantity", "Qty"]);
  const supplierField =
    entryTable.fields.find((field) => field.name === source.supplier) ||
    findField(entryTable.fields, ["Supplier", "Purchase Supplier", "Supplier Code"]);
  const imageField =
    entryTable.fields.find((field) => field.name === source.image) ||
    findField(entryTable.fields, IMAGE_CANDIDATES);

  const output = new Map<string, SupplierWhatsAppContext>();
  for (const record of records) {
    const customer = details.get(record.id);
    const image = firstImageInfo(record.fields?.[imageField?.name || ""]);
    const qtyText = readableText(record.fields?.[qtyField?.name || ""]);
    const qtyNumber = Number(qtyText.replace(/,/g, ""));

    output.set(record.id, {
      recordId: record.id,
      orderNo:
        customer?.orderNo || readableText(record.fields?.[orderField?.name || ""]),
      sku: readableText(record.fields?.[skuField?.name || ""]),
      qty: Number.isFinite(qtyNumber) ? qtyNumber : 0,
      supplier: readableText(record.fields?.[supplierField?.name || ""]),
      imageUrl: image.url,
      imageFileName: image.fileName,
      customerName: customer?.customerName || "",
      customerMobile: customer?.customerMobile || "",
    });
  }

  return output;
}

export function supplierOwnedBy(
  context: SupplierWhatsAppContext | undefined,
  supplierCode: string,
) {
  if (!context || !supplierCode.trim()) return false;
  return context.supplier.trim().toLowerCase() === supplierCode.trim().toLowerCase();
}

export async function sendSupplierPendingWhatsAppImage(
  context: SupplierWhatsAppContext,
): Promise<SupplierWhatsAppResult> {
  const action: SupplierAction = "dispatch";
  const targetGroup = getGreenApiGroup("dispatch");

  if (!context.imageUrl) {
    return {
      success: false,
      action,
      targetGroup,
      message: `Image missing for ${context.sku || context.recordId}; pending item was not sent`,
    };
  }

  const caption = `${context.orderNo || "-"} - ${context.sku || "-"} - ${context.qty || 0}`;
  const result = await sendGreenApiFileByUrl({
    chatId: targetGroup,
    urlFile: context.imageUrl,
    fileName: safeFileName(
      context.imageFileName,
      context.sku,
      context.imageUrl,
    ),
    caption,
  });

  return {
    success: true,
    action,
    targetGroup,
    idMessage: String(result.idMessage || ""),
  };
}

export async function sendSupplierWhatsAppNotification(
  action: SupplierAction,
  context: SupplierWhatsAppContext,
): Promise<SupplierWhatsAppResult> {
  if (action === "stock_out") {
    const targetGroup = getGreenApiGroup("soldOut");
    if (!context.imageUrl) {
      return {
        success: false,
        action,
        targetGroup,
        message: `Image missing for ${context.sku || context.recordId}; Sold Out WhatsApp was not sent`,
      };
    }

    const caption = [
      "SOLD OUT",
      "",
      `Order No: ${context.orderNo || "-"}`,
      `SKU: ${context.sku || "-"}`,
      `Supplier: ${context.supplier || "-"}`,
      `Customer: ${context.customerName || "-"}`,
      `Contact: ${context.customerMobile || "-"}`,
    ].join("\n");

    const result = await sendGreenApiFileByUrl({
      chatId: targetGroup,
      urlFile: context.imageUrl,
      fileName: safeFileName(
        context.imageFileName,
        context.sku,
        context.imageUrl,
      ),
      caption,
    });

    return {
      success: true,
      action,
      targetGroup,
      idMessage: String(result.idMessage || ""),
    };
  }

  const targetGroup = getGreenApiGroup("dispatch");
  const message = [
    `Order No: ${context.orderNo || "-"}`,
    `SKU: ${context.sku || "-"}`,
    `Qty: ${context.qty || 0}`,
  ].join("\n");
  const result = await sendGreenApiText({ chatId: targetGroup, message });

  return {
    success: true,
    action,
    targetGroup,
    idMessage: String(result.idMessage || ""),
  };
}

export async function sendSupplierWhatsAppUndoNotification(
  action: SupplierAction,
  context: SupplierWhatsAppContext,
): Promise<SupplierWhatsAppResult> {
  if (action === "stock_out") {
    const targetGroup = getGreenApiGroup("soldOut");
    const caption = [
      "UNDO SOLD OUT",
      "",
      `Order No: ${context.orderNo || "-"}`,
      `SKU: ${context.sku || "-"}`,
      `Supplier: ${context.supplier || "-"}`,
      `Customer: ${context.customerName || "-"}`,
      `Contact: ${context.customerMobile || "-"}`,
    ].join("\n");

    if (context.imageUrl) {
      const result = await sendGreenApiFileByUrl({
        chatId: targetGroup,
        urlFile: context.imageUrl,
        fileName: safeFileName(
          context.imageFileName,
          context.sku,
          context.imageUrl,
        ),
        caption,
      });

      return {
        success: true,
        action,
        targetGroup,
        idMessage: String(result.idMessage || ""),
      };
    }

    const result = await sendGreenApiText({
      chatId: targetGroup,
      message: caption,
    });

    return {
      success: true,
      action,
      targetGroup,
      idMessage: String(result.idMessage || ""),
      message: "Undo Sold Out sent without image because the product image was unavailable",
    };
  }

  const targetGroup = getGreenApiGroup("dispatch");
  const message = [
    "DISPATCH UNDONE",
    "",
    `Order No: ${context.orderNo || "-"}`,
    `SKU: ${context.sku || "-"}`,
    `Qty: ${context.qty || 0}`,
  ].join("\n");

  const result = await sendGreenApiText({ chatId: targetGroup, message });

  return {
    success: true,
    action,
    targetGroup,
    idMessage: String(result.idMessage || ""),
  };
}

