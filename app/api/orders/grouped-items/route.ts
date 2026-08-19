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
  receivedUae: string;
  receivedUaeDateTime: string;
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

function escapeAirtableFormulaText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function fieldTextExpression(field: SchemaField | undefined, fieldName: string) {
  const arrayLikeTypes = new Set([
    "multipleRecordLinks",
    "multipleLookupValues",
    "multipleSelects",
    "rollup",
  ]);

  if (field && arrayLikeTypes.has(String(field.type || ""))) {
    return `ARRAYJOIN({${fieldName}}&"")`;
  }

  return `({${fieldName}}&"")`;
}

function containsFieldFormula(
  fields: SchemaField[],
  fieldName: string,
  value: string
) {
  const field = fields.find((item) => item.name === fieldName);
  const expression = fieldTextExpression(field, fieldName);
  const escapedValue = escapeAirtableFormulaText(value);

  return `FIND(LOWER("${escapedValue}"),LOWER(${expression}))>0`;
}

function equalsFieldFormula(
  fields: SchemaField[],
  fieldName: string,
  value: string
) {
  const field = fields.find((item) => item.name === fieldName);
  const expression = fieldTextExpression(field, fieldName);
  const escapedValue = escapeAirtableFormulaText(value);

  return `LOWER(TRIM(${expression}))=LOWER("${escapedValue}")`;
}

function normalizePhoneDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function phoneMatches(value: unknown, searchValue: string) {
  const rawValue = String(value ?? "").trim().toLowerCase();
  const rawSearch = String(searchValue ?? "").trim().toLowerCase();

  if (!rawSearch) return true;
  if (rawValue.includes(rawSearch)) return true;

  const valueDigits = normalizePhoneDigits(rawValue);
  const searchDigits = normalizePhoneDigits(rawSearch);

  if (!searchDigits) return false;
  if (valueDigits.includes(searchDigits)) return true;

  // Local vs international formats, e.g. 0300... vs +92300...
  const suffixLength = Math.min(10, valueDigits.length, searchDigits.length);
  return (
    suffixLength >= 7 &&
    valueDigits.slice(-suffixLength) === searchDigits.slice(-suffixLength)
  );
}

function phoneFieldFormula(
  fields: SchemaField[],
  fieldName: string,
  value: string
) {
  const field = fields.find((item) => item.name === fieldName);
  const expression = fieldTextExpression(field, fieldName);
  const digits = normalizePhoneDigits(value);

  if (!digits) {
    return containsFieldFormula(fields, fieldName, value);
  }

  const normalizedExpression =
    `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(` +
    `${expression}," ",""),"+",""),"-",""),"(",""),")",""),".","")`;

  // Compare the last up-to-10 digits so +92xxxxxxxxxx and 0xxxxxxxxxx can match.
  const searchSuffix = digits.slice(-Math.min(10, digits.length));
  return `FIND("${escapeAirtableFormulaText(searchSuffix)}",RIGHT(${normalizedExpression},10))>0`;
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
      "Telephone1",
      "Telephone 1",
      "Customer Mobile",
      "Mobile Number",
      "Contact no.",
      "Contact No.",
      "Contact No",
      "Contact Number",
      "ConsigneeTel1",
      "Consignee Mobile No 1",
      "ConsigneeMob1",
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
    // Keep Item Code and SKU separate. In BS Order Entry both can exist,
    // but SKU is the product relationship / primary product identifier.
    itemCode: getFieldName(fields, [
      "Item Code",
      "item code",
      "Product Code",
    ]),
    sku: getFieldName(fields, [
      "SKU",
      "sku",
      "Product SKU",
      "Product",
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
    receivedUae: getFieldName(fields, [
      "Received in UAE 2",
      "Received In UAE 2",
      "Received in UAE",
      "Received In UAE",
      "received_in_uae_2",
    ]),
    receivedUaeDateTime: getFieldName(fields, [
      "Received In UAE DateTime",
      "Received in UAE DateTime",
      "Received In UAE Date Time",
      "Received in UAE Date Time",
      "Received in UAE Date",
      "Received In UAE Date",
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

function findCustomerLinkField(
  orderEntryTable: SchemaTable,
  schema: SchemaTable[]
) {
  const fields = orderEntryTable.fields || [];

  return (
    fields.find((field) => {
      if (
        field.type !== "multipleRecordLinks" ||
        !field.options?.linkedTableId
      ) {
        return false;
      }

      const linkedTable = schema.find(
        (table) => table.id === field.options?.linkedTableId
      );
      const linkedName = String(linkedTable?.name || "")
        .trim()
        .toLowerCase();

      return linkedName === "customer" || linkedName.includes("customer");
    }) ||
    fields.find((field) => {
      if (
        field.type !== "multipleRecordLinks" ||
        !field.options?.linkedTableId
      ) {
        return false;
      }

      const name = field.name.trim().toLowerCase();
      return ["contact bak", "contact no.", "contact no", "customer", "contact"].includes(name);
    })
  );
}

async function loadLinkedCustomerDetails({
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
  const values = new Map<string, { name: string; phone: string }>();

  if (uniqueIds.length === 0) return values;

  const customerNameField = getFieldName(linkedTable.fields || [], [
    "Customer Name",
    "Name",
    "Consignee",
    "Full Name",
  ]);
  const customerPhoneField = getFieldName(linkedTable.fields || [], [
    "Contact No.",
    "Contact No",
    "Contact",
    "Mobile Number",
    "Mobile No.",
    "Mobile No",
    "Phone",
    "Mobile",
    "Telephone1",
  ]);

  const primaryField =
    linkedTable.fields.find((field) => field.id === linkedTable.primaryFieldId)?.name ||
    linkedTable.fields[0]?.name ||
    "";

  for (let index = 0; index < uniqueIds.length; index += 40) {
    const batch = uniqueIds.slice(index, index + 40);
    const formula =
      batch.length === 1
        ? `RECORD_ID()='${batch[0]}'`
        : `OR(${batch.map((id) => `RECORD_ID()='${id}'`).join(",")})`;

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
          `Unable to resolve customers from ${linkedTable.name}`
      );
    }

    for (const record of data.records || []) {
      const primaryValue = primaryField
        ? textValue(record.fields?.[primaryField])
        : "";
      const name = customerNameField
        ? textValue(record.fields?.[customerNameField])
        : "";
      const phone = customerPhoneField
        ? textValue(record.fields?.[customerPhoneField])
        : "";

      values.set(record.id, {
        name: name || (!phone ? primaryValue : ""),
        phone: phone || (/\d{7,}/.test(normalizePhoneDigits(primaryValue)) ? primaryValue : ""),
      });
    }
  }

  return values;
}


function findCustomerLinkFieldInTable(
  table: SchemaTable,
  schema: SchemaTable[]
) {
  return (
    table.fields.find((field) => {
      if (
        field.type !== "multipleRecordLinks" ||
        !field.options?.linkedTableId
      ) {
        return false;
      }

      const linkedTable = schema.find(
        (item) => item.id === field.options?.linkedTableId
      );
      const linkedName = String(linkedTable?.name || "")
        .trim()
        .toLowerCase();

      return linkedName === "customer" || linkedName.includes("customer");
    }) ||
    table.fields.find((field) => {
      if (
        field.type !== "multipleRecordLinks" ||
        !field.options?.linkedTableId
      ) {
        return false;
      }

      const normalizedName = field.name.trim().toLowerCase();
      return [
        "customer",
        "contact",
        "contact no.",
        "contact no",
        "contact bak",
      ].includes(normalizedName);
    })
  );
}

async function loadInvoiceCustomerDetails({
  baseId,
  token,
  invoiceTable,
  schema,
  invoiceIds,
}: {
  baseId: string;
  token: string;
  invoiceTable: SchemaTable;
  schema: SchemaTable[];
  invoiceIds: string[];
}) {
  const uniqueIds = Array.from(
    new Set(invoiceIds.filter((id) => String(id || "").startsWith("rec")))
  );

  const result = new Map<string, { name: string; phone: string }>();
  if (uniqueIds.length === 0) return result;

  const invoiceCustomerNameField = getFieldName(invoiceTable.fields || [], [
    "Consignee",
    "Customer Name",
    "Customer Name (from Contact No. )",
    "Name (from Contact No.)",
    "Contact Name",
    "Consignee Name",
    "Name",
  ]);

  const invoicePhoneField = getFieldName(invoiceTable.fields || [], [
    "Telephone1",
    "Telephone 1",
    "Customer Mobile",
    "Mobile Number",
    "Contact no.",
    "Contact No.",
    "Contact No",
    "Contact Number",
    "ConsigneeTel1",
    "Consignee Mobile No 1",
    "ConsigneeMob1",
    "Phone",
    "Mobile",
  ]);

  const customerLinkField = findCustomerLinkFieldInTable(invoiceTable, schema);
  const invoiceToCustomerId = new Map<string, string>();
  const customerIds: string[] = [];

  for (let index = 0; index < uniqueIds.length; index += 40) {
    const batch = uniqueIds.slice(index, index + 40);
    const formula =
      batch.length === 1
        ? `RECORD_ID()='${batch[0]}'`
        : `OR(${batch.map((id) => `RECORD_ID()='${id}'`).join(",")})`;

    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: formula,
    });

    const requestedFields = Array.from(
      new Set(
        [
          invoiceCustomerNameField,
          invoicePhoneField,
          customerLinkField?.name || "",
        ].filter(Boolean)
      )
    );

    requestedFields.forEach((fieldName) =>
      params.append("fields[]", fieldName)
    );

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
          data?.error?.error?.message ||
          `Unable to resolve invoice customer details from ${invoiceTable.name}`
      );
    }

    for (const record of data.records || []) {
      const fields = record.fields || {};
      const directName = invoiceCustomerNameField
        ? textValue(fields[invoiceCustomerNameField])
        : "";
      const directPhone = invoicePhoneField
        ? textValue(fields[invoicePhoneField])
        : "";

      result.set(record.id, {
        name:
          directName && !directName.startsWith("rec")
            ? directName
            : "",
        phone:
          directPhone && !directPhone.startsWith("rec")
            ? directPhone
            : "",
      });

      if (customerLinkField) {
        const rawCustomer = fields[customerLinkField.name];
        const customerId = Array.isArray(rawCustomer)
          ? String(rawCustomer[0] || "")
          : String(rawCustomer || "");

        if (customerId.startsWith("rec")) {
          invoiceToCustomerId.set(record.id, customerId);
          customerIds.push(customerId);
        }
      }
    }
  }

  if (
    customerLinkField?.options?.linkedTableId &&
    customerIds.length > 0
  ) {
    const customerTable = schema.find(
      (table) => table.id === customerLinkField.options?.linkedTableId
    );

    if (customerTable) {
      const customerDetails = await loadLinkedCustomerDetails({
        baseId,
        token,
        linkedTable: customerTable,
        recordIds: customerIds,
      });

      for (const [invoiceId, customerId] of invoiceToCustomerId) {
        const current = result.get(invoiceId) || { name: "", phone: "" };
        const linked = customerDetails.get(customerId);

        result.set(invoiceId, {
          name: current.name || linked?.name || "",
          phone: current.phone || linked?.phone || "",
        });
      }
    }
  }

  return result;
}

async function findInvoiceOrderLabelsByPhone({
  baseId,
  token,
  orderEntryTable,
  schema,
  fieldMap,
  phone,
}: {
  baseId: string;
  token: string;
  orderEntryTable: SchemaTable;
  schema: SchemaTable[];
  fieldMap: FieldMap;
  phone: string;
}): Promise<string[] | null> {
  const orderFieldName = fieldMap.orderNo || fieldMap.orderLink;
  if (!orderFieldName) return null;

  const orderField = orderEntryTable.fields.find(
    (field) => field.name === orderFieldName
  );

  if (
    orderField?.type !== "multipleRecordLinks" ||
    !orderField.options?.linkedTableId
  ) {
    return null;
  }

  const invoiceTable = schema.find(
    (table) => table.id === orderField.options?.linkedTableId
  );
  if (!invoiceTable) return null;

  const invoiceFields = invoiceTable.fields || [];
  const primaryField =
    invoiceTable.fields.find(
      (field) => field.id === invoiceTable.primaryFieldId
    )?.name ||
    invoiceTable.fields[0]?.name ||
    "";

  const invoiceOrderNoField =
    getFieldName(invoiceFields, [
      "Order No.",
      "Order No",
      "order_no.",
      "Order Number",
      "Invoice No.",
      "Invoice No",
      "Invoice Number",
      "Number",
    ]) || primaryField;

  if (!invoiceOrderNoField) return null;

  const invoicePhoneField = getFieldName(invoiceFields, [
    "Telephone1",
    "Telephone 1",
    "Customer Mobile",
    "Mobile Number",
    "Contact no.",
    "Contact No.",
    "Contact No",
    "Contact Number",
    "ConsigneeTel1",
    "Consignee Mobile No 1",
    "ConsigneeMob1",
    "Phone",
    "Mobile",
  ]);

  let invoiceFilterFormula = "";

  if (invoicePhoneField) {
    const invoicePhoneSchemaField = invoiceFields.find(
      (field) => field.name === invoicePhoneField
    );

    // A lookup/text phone field can be searched directly on the invoice.
    // If the field itself is a linked record, resolve through the Customer table.
    if (invoicePhoneSchemaField?.type !== "multipleRecordLinks") {
      invoiceFilterFormula = phoneFieldFormula(
        invoiceFields,
        invoicePhoneField,
        phone
      );
    }
  }

  if (!invoiceFilterFormula) {
    const customerLinkField = findCustomerLinkFieldInTable(
      invoiceTable,
      schema
    );

    if (
      !customerLinkField?.options?.linkedTableId
    ) {
      return null;
    }

    const customerTable = schema.find(
      (table) => table.id === customerLinkField.options?.linkedTableId
    );
    if (!customerTable) return null;

    const customerPhoneField = getFieldName(customerTable.fields || [], [
      "Contact No.",
      "Contact No",
      "Contact",
      "Mobile Number",
      "Mobile No.",
      "Mobile No",
      "Telephone1",
      "Phone",
      "Mobile",
    ]);

    if (!customerPhoneField) return null;

    const customerParams = new URLSearchParams({
      pageSize: "100",
      filterByFormula: phoneFieldFormula(
        customerTable.fields,
        customerPhoneField,
        phone
      ),
    });

    const customerPrimary =
      customerTable.fields.find(
        (field) => field.id === customerTable.primaryFieldId
      )?.name ||
      customerTable.fields[0]?.name ||
      "";

    if (!customerPrimary) return null;

    customerParams.append("fields[]", customerPrimary);

    const matchedCustomerLabels: string[] = [];
    let customerOffset = "";

    do {
      if (customerOffset) customerParams.set("offset", customerOffset);
      else customerParams.delete("offset");

      const response = await fetch(
        airtableUrl(baseId, customerTable.name, customerParams),
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
            `Unable to search customers in ${customerTable.name}`
        );
      }

      for (const record of data.records || []) {
        const label = textValue(record.fields?.[customerPrimary]);
        if (label) matchedCustomerLabels.push(label);
      }

      customerOffset = data.offset || "";
    } while (customerOffset);

    const uniqueCustomerLabels = Array.from(
      new Set(matchedCustomerLabels.filter(Boolean))
    );

    if (uniqueCustomerLabels.length === 0) return [];

    const customerLinkFormulas = uniqueCustomerLabels
      .slice(0, 50)
      .map((label) =>
        containsFieldFormula(
          invoiceFields,
          customerLinkField.name,
          label
        )
      );

    invoiceFilterFormula =
      customerLinkFormulas.length === 1
        ? customerLinkFormulas[0]
        : `OR(${customerLinkFormulas.join(",")})`;
  }

  const orderLabels: string[] = [];
  let invoiceOffset = "";

  do {
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: invoiceFilterFormula,
    });

    params.append("fields[]", invoiceOrderNoField);
    if (invoiceOffset) params.set("offset", invoiceOffset);

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
          data?.error?.error?.message ||
          `Unable to search contact number in ${invoiceTable.name}`
      );
    }

    for (const record of data.records || []) {
      const label = textValue(record.fields?.[invoiceOrderNoField]);
      if (label) orderLabels.push(label);
    }

    invoiceOffset = data.offset || "";
  } while (invoiceOffset);

  return Array.from(new Set(orderLabels.filter(Boolean)));
}

function normalizeRecord(
  record: any,
  map: FieldMap,
  linkedSkuNames: Map<string, string>,
  linkedOrderNames: Map<string, string>,
  linkedCustomers: Map<string, { name: string; phone: string }>,
  customerLinkFieldName: string,
  linkedInvoiceCustomers: Map<string, { name: string; phone: string }>
) {
  const fields = record.fields || {};

  const rawOrderValue =
    fields[map.orderNo] ??
    fields[map.orderLink] ??
    "";

  const rawOrderId = Array.isArray(rawOrderValue)
    ? String(rawOrderValue[0] || "")
    : String(rawOrderValue || "");

  const orderNo =
    linkedOrderNames.get(rawOrderId) ||
    textValue(rawOrderValue) ||
    "Unknown";

  const rawItemValue =
    fields[map.sku] ??
    fields[map.itemCode] ??
    "";

  const rawLinkedId = Array.isArray(rawItemValue)
    ? String(rawItemValue[0] || "")
    : String(rawItemValue || "");

  const resolvedItemCode =
    linkedSkuNames.get(rawLinkedId) ||
    textValue(rawItemValue) ||
    "";

  const rawCustomerLink = customerLinkFieldName
    ? fields[customerLinkFieldName]
    : "";
  const customerRecordId = Array.isArray(rawCustomerLink)
    ? String(rawCustomerLink[0] || "")
    : String(rawCustomerLink || "");
  const linkedCustomer = linkedCustomers.get(customerRecordId);
  const invoiceCustomer = linkedInvoiceCustomers.get(rawOrderId);

  const directCustomer = textValue(fields[map.customer]);
  const directPhone = textValue(fields[map.customerNumber]);
  const resolvedCustomer =
    (directCustomer && !directCustomer.startsWith("rec") ? directCustomer : "") ||
    invoiceCustomer?.name ||
    linkedCustomer?.name ||
    "";
  const resolvedPhone =
    invoiceCustomer?.phone ||
    (directPhone && !directPhone.startsWith("rec") ? directPhone : "") ||
    linkedCustomer?.phone ||
    "";

  const normalizedFields = {
    ...fields,
    "Order Number": orderNo ? [orderNo] : [],
    "Item Code": resolvedItemCode,
    Customer: resolvedCustomer,
    "Mobile Number": resolvedPhone,
    "created Date": textValue(fields[map.createdDate]) || "",
    date: textValue(fields[map.date]) || "",
    Store: textValue(fields[map.store]) || "",
    Order_status: textValue(fields[map.orderStatus]) || "",
    quantity: numberValue(fields[map.quantity]),
    Supplier: textValue(fields[map.supplier]) || "",
    received_in_wh_1: textValue(fields[map.receivedWh]) || "",
    received_in_uae_2: map.receivedUae ? fields[map.receivedUae] : "",
    received_in_uae_datetime: map.receivedUaeDateTime
      ? textValue(fields[map.receivedUaeDateTime])
      : "",
    bill_no: textValue(fields[map.billNo]) || "",
    image: [],
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
  const customerNameFilter = (searchParams.get("customerName") || "")
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
      customerNameFilter ||
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
    const dispatchDateField = getFieldName(invoiceFields, [
      "Dispatch Date",
      "Dispatched Date",
      "Despatch Date",
      "Date Dispatched",
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
        !phoneMatches(customerPhone, customerFilter)
      ) {
        continue;
      }

      if (
        customerNameFilter &&
        !customerName.toLowerCase().includes(customerNameFilter)
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
          receivedInUae: 0,
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
          image: [],
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

  const finalOrders = latest && !hasFilters
    ? allGroups.slice(0, 100)
    : allGroups;

  return finalOrders;
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
    const customerName = (searchParams.get("customerName") || "")
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
      customerName ||
      dateFrom ||
      dateTo ||
      orderStatus ||
      storeName;

    const contactOrderLabels = customerNumber
      ? await findInvoiceOrderLabelsByPhone({
          baseId: airtable.baseId,
          token: airtable.token,
          orderEntryTable,
          schema,
          fieldMap,
          phone: customerNumber,
        })
      : null;

    if (
      customerNumber &&
      Array.isArray(contactOrderLabels) &&
      contactOrderLabels.length === 0
    ) {
      return NextResponse.json({
        success: true,
        baseName: airtable.baseName,
        tableName: orderEntryTableName,
        orders: [],
      });
    }

    const maxRecords = latest && !hasFilters
      ? 300
      : customerNumber && contactOrderLabels === null
        ? 10000
        : 5000;

    const contactLabelBatches =
      Array.isArray(contactOrderLabels) && contactOrderLabels.length > 0
        ? Array.from(
            { length: Math.ceil(contactOrderLabels.length / 20) },
            (_, index) => contactOrderLabels.slice(index * 20, index * 20 + 20)
          )
        : [null];

    let allRecords: any[] = [];

    for (const contactLabelBatch of contactLabelBatches) {
      let offset = "";

      do {
        const params = new URLSearchParams({
          pageSize: "100",
        });

      // Server-side filtering to reduce Airtable payload.
      // Use field-type-aware text expressions so linked/lookup fields work
      // the same way as normal text/select fields.
      const formulaParts: string[] = [];

      const orderSearchField = fieldMap.orderNo || fieldMap.orderLink;

      if (orderNo && orderSearchField) {
        formulaParts.push(
          containsFieldFormula(orderEntryTable.fields, orderSearchField, orderNo)
        );
      }

      // Contact Number is header/customer data. When invoice-side phone lookup
      // succeeds, restrict Order Entry rows by the matching invoice Order No(s).
      if (contactLabelBatch && orderSearchField) {
        const contactOrderFormulas = contactLabelBatch.map((label) =>
          equalsFieldFormula(
            orderEntryTable.fields,
            orderSearchField,
            label
          )
        );

        formulaParts.push(
          contactOrderFormulas.length === 1
            ? contactOrderFormulas[0]
            : `OR(${contactOrderFormulas.join(",")})`
        );
      }

      // SKU search must target the actual SKU/product-link field first.
      // Item Code is only a fallback for bases that do not expose a SKU field.
      const skuSearchField = fieldMap.sku || fieldMap.itemCode;
      if (sku && skuSearchField) {
        formulaParts.push(
          containsFieldFormula(orderEntryTable.fields, skuSearchField, sku)
        );
      }

      if (customerName && fieldMap.customer) {
        formulaParts.push(
          containsFieldFormula(
            orderEntryTable.fields,
            fieldMap.customer,
            customerName
          )
        );
      }

      if (orderStatus && fieldMap.orderStatus) {
        formulaParts.push(
          equalsFieldFormula(
            orderEntryTable.fields,
            fieldMap.orderStatus,
            orderStatus
          )
        );
      }

      if (storeName && fieldMap.store) {
        formulaParts.push(
          equalsFieldFormula(orderEntryTable.fields, fieldMap.store, storeName)
        );
      }

      if (formulaParts.length) {
        params.set(
          "filterByFormula",
          formulaParts.length === 1
            ? formulaParts[0]
            : `AND(${formulaParts.join(",")})`
        );
      }

      // Keep Airtable payload smaller. Images are already lazy loaded.
      const requiredFields = [
        fieldMap.orderLink,
        fieldMap.orderNo,
        fieldMap.itemCode,
        fieldMap.sku,
        fieldMap.quantity,
        fieldMap.customer,
        fieldMap.customerNumber,
        fieldMap.createdDate,
        fieldMap.date,
        fieldMap.store,
        fieldMap.orderStatus,
        fieldMap.supplier,
        fieldMap.receivedWh,
        fieldMap.receivedUae,
        fieldMap.billNo,
      ].filter(Boolean);

      requiredFields.forEach((field) =>
        params.append("fields[]", field)
      );

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

      if (allRecords.length >= maxRecords) break;
    }

    allRecords = Array.from(
      new Map(
        allRecords
          .filter((record) => record?.id)
          .map((record) => [String(record.id), record])
      ).values()
    ).slice(0, maxRecords);

    const orderFieldName = fieldMap.orderNo || fieldMap.orderLink;
    const orderSchemaField = orderEntryTable.fields.find(
      (field) => field.name === orderFieldName
    );

    let linkedOrderNames = new Map<string, string>();

    if (
      orderSchemaField?.type === "multipleRecordLinks" &&
      orderSchemaField.options?.linkedTableId
    ) {
      const linkedOrderTable = schema.find(
        (table) => table.id === orderSchemaField.options?.linkedTableId
      );

      if (linkedOrderTable) {
        const linkedOrderIds: string[] = [];

        for (const record of allRecords) {
          const rawValue = record.fields?.[orderFieldName];

          if (Array.isArray(rawValue)) {
            for (const id of rawValue) {
              if (typeof id === "string") linkedOrderIds.push(id);
            }
          } else if (typeof rawValue === "string") {
            linkedOrderIds.push(rawValue);
          }
        }

        linkedOrderNames = await loadLinkedRecordNames({
          baseId: airtable.baseId,
          token: airtable.token,
          linkedTable: linkedOrderTable,
          recordIds: linkedOrderIds,
        });
      }
    }

    let linkedInvoiceCustomers = new Map<
      string,
      { name: string; phone: string }
    >();

    if (
      orderSchemaField?.type === "multipleRecordLinks" &&
      orderSchemaField.options?.linkedTableId
    ) {
      const linkedInvoiceTable = schema.find(
        (table) => table.id === orderSchemaField.options?.linkedTableId
      );

      if (linkedInvoiceTable) {
        const invoiceIds: string[] = [];

        for (const record of allRecords) {
          const rawValue = record.fields?.[orderFieldName];

          if (Array.isArray(rawValue)) {
            for (const id of rawValue) {
              if (typeof id === "string" && id.startsWith("rec")) {
                invoiceIds.push(id);
              }
            }
          } else if (
            typeof rawValue === "string" &&
            rawValue.startsWith("rec")
          ) {
            invoiceIds.push(rawValue);
          }
        }

        linkedInvoiceCustomers = await loadInvoiceCustomerDetails({
          baseId: airtable.baseId,
          token: airtable.token,
          invoiceTable: linkedInvoiceTable,
          schema,
          invoiceIds,
        });
      }
    }

    const skuFieldName = fieldMap.sku || fieldMap.itemCode;
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

    const customerLinkField = findCustomerLinkField(orderEntryTable, schema);
    let linkedCustomers = new Map<string, { name: string; phone: string }>();

    if (customerLinkField?.options?.linkedTableId) {
      const linkedCustomerTable = schema.find(
        (table) => table.id === customerLinkField.options?.linkedTableId
      );

      if (linkedCustomerTable) {
        const customerIds: string[] = [];

        for (const record of allRecords) {
          const rawValue = record.fields?.[customerLinkField.name];
          if (Array.isArray(rawValue)) {
            for (const id of rawValue) {
              if (typeof id === "string") customerIds.push(id);
            }
          } else if (typeof rawValue === "string") {
            customerIds.push(rawValue);
          }
        }

        linkedCustomers = await loadLinkedCustomerDetails({
          baseId: airtable.baseId,
          token: airtable.token,
          linkedTable: linkedCustomerTable,
          recordIds: customerIds,
        });
      }
    }

    allRecords = allRecords.map((record) =>
      normalizeRecord(
        record,
        fieldMap,
        linkedSkuNames,
        linkedOrderNames,
        linkedCustomers,
        customerLinkField?.name || "",
        linkedInvoiceCustomers
      )
    );

    let matchingRecords = allRecords;

    if (hasFilters) {
      const matchingOrderNumbers = new Set<string>();

      for (const record of allRecords) {
        const fields = record.fields || {};

        const recordOrder = lowerValue(fields["Order Number"]);
        const item = lowerValue(fields["Item Code"]);
        const mobile = lowerValue(fields["Mobile Number"]);
        const customer = lowerValue(fields.Customer);
        const recordDate = textValue(fields.date);
        const status = lowerValue(fields.Order_status);
        const store = lowerValue(fields.Store);

        if (orderNo && !recordOrder.includes(orderNo)) continue;
        if (sku && !item.includes(sku)) continue;
        if (customerNumber && !phoneMatches(mobile, customerNumber)) continue;
        if (customerName && !customer.includes(customerName)) continue;
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

        const linkedOrderId = fields[fieldMap.orderLink]?.[0] || "";

        grouped[groupedOrderNo] = {
          orderNo: groupedOrderNo,
          orderNumber:
            numberValue(fields[fieldMap.orderNumber]) ||
            fallbackOrderNumber,
          customer: textValue(fields.Customer) || "",
          customerNumber: textValue(fields["Mobile Number"]) || "",
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
          receivedInUae: 0,
        };
      }

      const itemPrice = numberValue(fields["Price"] || fields["Selling Price"] || fields["Sale Price"] || 0);
      record.fields = {
        ...record.fields,
        "item value": itemPrice * numberValue(fields.quantity),
      };
      grouped[groupedOrderNo].items.push(record);

      const qty = numberValue(fields.quantity);
      const received =
        lowerValue(fields.received_in_wh_1) === "yes";
      const receivedInUaeValue = lowerValue(fields.received_in_uae_2);
      const receivedInUae =
        receivedInUaeValue === "yes" ||
        receivedInUaeValue === "true" ||
        receivedInUaeValue === "1" ||
        receivedInUaeValue === "checked";
      const billNo = textValue(fields.bill_no).trim();
      const billNoLower = billNo.toLowerCase();

      const isStockOut =
        billNoLower === "stock out" ||
        billNoLower === "sold out" ||
        billNoLower === "sold";

      grouped[groupedOrderNo].totalQty += qty;
      grouped[groupedOrderNo].totalItems += qty;

      // Keep operational summary buckets mutually exclusive.
      // Priority: Stock Out -> Instock -> Received in UAE -> Pending -> Dispatched.
      // Instock means the item is received in WH 1 and has no supplier bill number yet.
      // Instock items must never be counted as Received in UAE, even if a stale UAE flag exists.
      // Once a dispatched item is received in UAE, it must leave the Dispatched count.
      // Stock Out / Sold Out items must never be counted as Received in UAE.
      const isInstock = received && !billNo;

      if (isStockOut) {
        grouped[groupedOrderNo].stockOut += qty;
      } else if (isInstock) {
        grouped[groupedOrderNo].instock += qty;
      } else if (receivedInUae) {
        grouped[groupedOrderNo].receivedInUae += qty;
      } else if (!received) {
        grouped[groupedOrderNo].pending += qty;
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
