import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { auditedFetch } from "@/lib/audit-airtable-fetch";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import {
  loadSupplierWhatsAppContexts,
  sendSupplierWhatsAppUndoNotification,
} from "@/lib/supplier-whatsapp";

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

function getSupplierCode(session: any) {
  return String(
    session?.permissions?.find((permission: any) => permission?.supplierCode)
      ?.supplierCode || "",
  ).trim();
}

function getSourceByRowId(rowId: string) {
  const source = SOURCES.find((item) => rowId.startsWith(`${item.baseId}-`));
  if (!source) return null;

  const recordId = rowId.slice(source.baseId.length + 1).trim();
  if (!recordId || !recordId.startsWith("rec")) return null;

  return { source, recordId };
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

async function fetchSource(
  token: string,
  source: Source,
  supplier: string,
  status: string,
  billNo: string,
  includeCustomerDetails: boolean,
) {
  const f = source.fields;
  const filters: string[] = [
    `{${f.activity}}!=''`,
    `{${f.activityDateTime}}!=''`,
  ];

  if (supplier) {
    filters.push(
      `LOWER({${f.supplier}} & '')=LOWER('${escapeAirtableString(supplier)}')`,
    );
  }

  if (status) {
    filters.push(
      `LOWER({${f.activity}} & '')=LOWER('${escapeAirtableString(status)}')`,
    );
  }

  if (billNo) {
    filters.push(
      `LOWER({${f.billNo}} & '')=LOWER('${escapeAirtableString(billNo)}')`,
    );
  }

  let customerSchemaFields: string[] = [];
  if (includeCustomerDetails) {
    const schema = await getSchema(source.baseId, token);
    const entryTable = schema.find((table) => table.name === source.tableName);
    const invoiceTable = schema.find(
      (table) => table.name === source.invoiceTableName,
    );

    if (entryTable) {
      const directName = findField(entryTable.fields, CUSTOMER_NAME_CANDIDATES);
      const directMobile = findField(
        entryTable.fields,
        CUSTOMER_MOBILE_CANDIDATES,
      );
      const invoiceLink = invoiceTable
        ? entryTable.fields.find(
            (field) =>
              field.type === "multipleRecordLinks" &&
              field.options?.linkedTableId === invoiceTable.id,
          )
        : undefined;

      customerSchemaFields = [
        directName?.name || "",
        directMobile?.name || "",
        invoiceLink?.name || "",
        ...detectCustomerLinkFields(entryTable, schema).map(
          (field) => field.name,
        ),
      ].filter(Boolean);
    }
  }

  const requestedFields = Array.from(
    new Set(
      [
        f.orderNo,
        f.itemCode,
        f.quantity,
        f.supplier,
        f.billNo,
        f.activity,
        f.activityDateTime,
        f.orderDate,
        f.image,
        ...customerSchemaFields,
      ].filter(Boolean),
    ),
  );

  let offset = "";
  const records: any[] = [];

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set("filterByFormula", `AND(${filters.join(",")})`);
    params.set("sort[0][field]", f.activityDateTime);
    params.set("sort[0][direction]", "desc");

    requestedFields.forEach((field) => params.append("fields[]", field));
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
          `Supplier activity failed for ${source.sourceName}`,
        error: data,
      };
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  const resolvedDetails = includeCustomerDetails
    ? await resolveOrderCustomerDetails({ token, source, records })
    : new Map<string, CustomerDetails>();

  return {
    success: true as const,
    rows: records.map((record) => {
      const fields = record.fields || {};
      const imageValue = fields[f.image];
      const statusValue = String(valueOf(fields, f.activity) || "");
      const soldOut = statusValue.trim().toLowerCase() === "sold out";
      const details = resolvedDetails.get(record.id);

      return {
        id: `${source.baseId}-${record.id}`,
        source: source.sourceName,
        orderNo:
          details?.orderNo || String(valueOf(fields, f.orderNo) || ""),
        sku: String(valueOf(fields, f.itemCode) || ""),
        qty: Number(valueOf(fields, f.quantity) || 0),
        supplier: String(valueOf(fields, f.supplier) || ""),
        billNo: String(valueOf(fields, f.billNo) || ""),
        status: statusValue,
        activityDateTime: String(valueOf(fields, f.activityDateTime) || ""),
        orderDate: String(valueOf(fields, f.orderDate) || ""),
        imageUrl: Array.isArray(imageValue)
          ? String(imageValue[0]?.url || "")
          : String(imageValue?.url || ""),
        customerName:
          includeCustomerDetails && soldOut ? details?.customerName || "" : "",
        customerMobile:
          includeCustomerDetails && soldOut
            ? details?.customerMobile || ""
            : "",
      };
    }),
  };
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

    const currentAirtable = await getCurrentAirtableBase();
    const isSupplier = session.role === "Supplier";

    if (!isSupplier && !currentAirtable.canReports) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view reports",
        },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const supplierFromQuery = searchParams.get("supplier")?.trim() || "";
    const supplierCode = isSupplier
      ? getSupplierCode(session)
      : supplierFromQuery;
    const status = searchParams.get("status")?.trim() || "";
    const billNo = searchParams.get("billNo")?.trim() || "";
    const activityDate = searchParams.get("activityDate")?.trim() || "";
    const todayOnly = searchParams.get("todayOnly") === "1";

    if (isSupplier && !supplierCode) {
      return NextResponse.json(
        {
          success: false,
          message: "Supplier code is missing in login permission",
        },
        { status: 403 },
      );
    }

    const results = await Promise.all(
      SOURCES.map((source) => {
        const token = getToken(currentAirtable, session, source.baseId);
        if (!token) {
          return Promise.resolve({
            success: false as const,
            status: 500,
            message: `Airtable token missing for ${source.sourceName}`,
            error: null,
          });
        }
        return fetchSource(token, source, supplierCode, status, billNo, !isSupplier);
      }),
    );

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

    let rows = allRows;

    if (activityDate) {
      rows = rows.filter(
        (row) => formatKarachiDate(row.activityDateTime) === activityDate,
      );
    } else if (todayOnly) {
      const today = formatKarachiDate(new Date().toISOString());
      rows = rows.filter(
        (row) => formatKarachiDate(row.activityDateTime) === today,
      );
    }

    rows.sort(
      (a, b) =>
        new Date(b.activityDateTime).getTime() -
        new Date(a.activityDateTime).getTime(),
    );

    const suppliers = isSupplier
      ? supplierCode
        ? [supplierCode]
        : []
      : Array.from(
          new Set(allRows.map((row) => row.supplier).filter(Boolean)),
        ).sort((a, b) => a.localeCompare(b));

    const dispatchedRows = rows.filter(
      (row) => row.status.toLowerCase() === "dispatched",
    );
    const soldOutRows = rows.filter(
      (row) => row.status.toLowerCase() === "sold out",
    );

    return NextResponse.json({
      success: true,
      rows,
      suppliers,
      supplierLocked: isSupplier,
      supplier: supplierCode,
      showCustomerDetails: !isSupplier,
      summary: {
        totalLines: rows.length,
        totalQty: rows.reduce((total, row) => total + row.qty, 0),
        dispatchedLines: dispatchedRows.length,
        dispatchedQty: dispatchedRows.reduce(
          (total, row) => total + row.qty,
          0,
        ),
        soldOutLines: soldOutRows.length,
        soldOutQty: soldOutRows.reduce(
          (total, row) => total + row.qty,
          0,
        ),
      },
    });
  } catch (error) {
    return handleApiError(error, "Supplier activity report failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    const currentAirtable = await getCurrentAirtableBase();
    const isSupplier = session.role === "Supplier";

    if (!isSupplier && !currentAirtable.canReports) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to undo activity",
        },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const rowId = String(body?.id || "").trim();
    const resolved = getSourceByRowId(rowId);

    if (!resolved) {
      return NextResponse.json(
        { success: false, message: "Invalid supplier activity record" },
        { status: 400 },
      );
    }

    const { source, recordId } = resolved;
    const token = getToken(currentAirtable, session, source.baseId);

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: `Airtable token missing for ${source.sourceName}`,
        },
        { status: 500 },
      );
    }

    const recordResponse = await fetch(
      `${airtableUrl(source.baseId, source.tableName)}/${encodeURIComponent(recordId)}`,
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      },
    );
    const recordData = await recordResponse.json();

    if (!recordResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          message: recordData?.error?.message || "Activity record not found",
          error: recordData,
        },
        { status: recordResponse.status },
      );
    }

    const previousActivity = textValue(
      recordData?.fields?.[source.fields.activity],
    )
      .trim()
      .toLowerCase();

    const undoWhatsAppAction =
      previousActivity === "sold out"
        ? ("stock_out" as const)
        : previousActivity === "dispatched"
          ? ("dispatch" as const)
          : null;

    if (isSupplier) {
      const supplierCode = getSupplierCode(session);
      const recordSupplier = textValue(
        recordData?.fields?.[source.fields.supplier],
      ).toLowerCase();

      if (!supplierCode || recordSupplier !== supplierCode.toLowerCase()) {
        return NextResponse.json(
          { success: false, message: "You can undo only your own activity" },
          { status: 403 },
        );
      }
    }

    const updateResponse = await auditedFetch(
      `${airtableUrl(source.baseId, source.tableName)}/${encodeURIComponent(recordId)}`,
      {
        method: "PATCH",
        headers: {
          ...airtableHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            [source.fields.activity]: null,
            [source.fields.activityDateTime]: null,
            [source.fields.billNo]: "",
            [source.fields.receivedInWh1]: null,
            [source.fields.soldOut]: null,
          },
          typecast: true,
        }),
        cache: "no-store",
      },
    );

    const updateData = await updateResponse.json();

    if (!updateResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            updateData?.error?.message || "Undo supplier activity failed",
          error: updateData,
        },
        { status: updateResponse.status },
      );
    }

    let whatsapp: Record<string, unknown> | null = null;

    if (undoWhatsAppAction) {
      try {
        const contexts = await loadSupplierWhatsAppContexts({
          baseId: source.baseId,
          tableName: source.tableName,
          recordIds: [recordId],
          token,
        });
        const context = contexts.get(recordId);

        if (context) {
          whatsapp = await sendSupplierWhatsAppUndoNotification(
            undoWhatsAppAction,
            context,
          );
        } else {
          whatsapp = {
            success: false,
            message: "Undo completed, but WhatsApp context could not be resolved",
          };
        }
      } catch (whatsappError) {
        console.error("Supplier undo WhatsApp notification failed:", whatsappError);
        whatsapp = {
          success: false,
          message:
            whatsappError instanceof Error
              ? whatsappError.message
              : "Undo completed, but WhatsApp notification failed",
        };
      }
    }

    return NextResponse.json({
      success: true,
      message: "Supplier activity undone successfully",
      whatsapp,
    });
  } catch (error) {
    return handleApiError(error, "Undo supplier activity failed");
  }
}
