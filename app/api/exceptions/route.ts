import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
} from "@/lib/airtable";
import {
  BasePermission,
  getSession,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type SessionBase = BasePermission & {
  invoiceTable?: string;
  orderEntryTable?: string;
  customersTable?: string;
  productsTable?: string;
};

type SchemaField = {
  id: string;
  name: string;
  type: string;
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: SchemaField[];
};

type AirtableRecord = {
  id: string;
  createdTime?: string;
  fields?: Record<string, unknown>;
};

type ExceptionType =
  | "customer_details"
  | "missing_supplier"
  | "missing_bill"
  | "stuck_order"
  | "partially_ready"
  | "courier_booking_failed"
  | "delivery_failed"
  | "stock_mismatch"
  | "duplicate_order"
  | "cod_overdue";

type Severity = "high" | "medium" | "low";

type ExceptionIssue = {
  id: string;
  type: ExceptionType;
  severity: Severity;
  title: string;
  detail: string;
  baseId: string;
  baseName: string;
  orderNo: string;
  recordId: string;
  tableName: string;
  status: string;
  ageDays: number | null;
  amount?: number;
};

type BaseResult = {
  baseId: string;
  baseName: string;
  invoiceTable: string;
  orderEntryTable: string;
  issueCount: number;
  coverage: string[];
  warnings: string[];
  error?: string;
  truncated: boolean;
};

type InvoiceMap = {
  orderNo?: SchemaField;
  status?: SchemaField;
  customer?: SchemaField;
  phone?: SchemaField;
  address?: SchemaField;
  city?: SchemaField;
  courier?: SchemaField;
  awb?: SchemaField;
  courierError?: SchemaField;
  orderDate?: SchemaField;
  deliveredDate?: SchemaField;
  cod?: SchemaField;
  codReceiveDate?: SchemaField;
  amount?: SchemaField;
};

type LineMap = {
  orderNo?: SchemaField;
  itemCode?: SchemaField;
  supplier?: SchemaField;
  billNo?: SchemaField;
  quantity?: SchemaField;
  receivedInUae?: SchemaField;
  receivedInWarehouse?: SchemaField;
  inStock?: SchemaField;
  soldOut?: SchemaField;
  processed?: SchemaField;
  supplierActivity?: SchemaField;
};

type NormalizedInvoice = {
  recordId: string;
  orderNo: string;
  status: string;
  customer: string;
  phone: string;
  address: string;
  city: string;
  courier: string;
  awb: string;
  courierError: string;
  createdAt: string;
  deliveredAt: string;
  codValue: unknown;
  codReceivedAt: string;
  amount: number;
  raw: AirtableRecord;
};

type NormalizedLine = {
  recordId: string;
  orderNo: string;
  itemCode: string;
  supplier: string;
  billNo: string;
  quantity: number;
  receivedInUae: boolean;
  receivedInWarehouse: boolean;
  inStock: boolean;
  soldOut: boolean;
  processed: boolean;
  supplierActivity: string;
};

const TERMINAL_STATUSES = [
  "delivered",
  "cancelled",
  "canceled",
  "returned",
  "refunded",
  "completed",
  "closed",
];

const DELIVERY_FAILURE_WORDS = [
  "delivery failed",
  "failed delivery",
  "undelivered",
  "refused",
  "customer unavailable",
  "return to origin",
  "rto",
];

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function displayText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => displayText(item))
      .filter(Boolean)
      .join(", ");
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;

    return String(
      objectValue.name ??
        objectValue.value ??
        objectValue.text ??
        "",
    ).trim();
  }

  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.reduce(
      (sum, item) => sum + numberValue(item),
      0,
    );
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;

    return numberValue(
      objectValue.value ??
        objectValue.amount ??
        objectValue.number ??
        0,
    );
  }

  const parsed = Number(
    String(value ?? "")
      .replace(/[^0-9.-]/g, "")
      .trim(),
  );

  return Number.isFinite(parsed) ? parsed : 0;
}

function isTruthy(value: unknown) {
  if (value === true || value === 1) return true;

  const text = normalize(displayText(value));

  return [
    "yes",
    "true",
    "received",
    "paid",
    "done",
    "instock",
    "stock",
    "processed",
    "1",
  ].includes(text);
}

function isSoldOut(value: unknown) {
  const text = normalize(displayText(value));

  return (
    text.includes("soldout") ||
    text.includes("stockout")
  );
}

function findField(
  fields: SchemaField[],
  candidates: string[],
) {
  const names = new Map(
    fields.map((field) => [
      normalize(field.name),
      field,
    ]),
  );

  for (const candidate of candidates) {
    const found = names.get(normalize(candidate));

    if (found) return found;
  }

  return undefined;
}

function findTable(
  tables: SchemaTable[],
  preferredName: string,
  exactCandidates: string[],
  containsCandidates: string[],
) {
  const preferred = preferredName.trim();

  if (preferred) {
    const exactPreferred = tables.find(
      (table) =>
        normalize(table.name) === normalize(preferred),
    );

    if (exactPreferred) return exactPreferred;
  }

  for (const candidate of exactCandidates) {
    const exact = tables.find(
      (table) =>
        normalize(table.name) === normalize(candidate),
    );

    if (exact) return exact;
  }

  return tables.find((table) => {
    const tableName = normalize(table.name);

    return containsCandidates.some((candidate) =>
      tableName.includes(normalize(candidate)),
    );
  });
}

function resolveToken(base: SessionBase) {
  return (
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    base.airtableToken ||
    ""
  ).trim();
}

async function loadSchema(
  baseId: string,
  token: string,
) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(
      baseId,
    )}/tables`,
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "Unable to load Airtable schema",
    );
  }

  return (data.tables || []) as SchemaTable[];
}

async function loadRecords({
  baseId,
  token,
  tableName,
  fields,
  maxRecords,
}: {
  baseId: string;
  token: string;
  tableName: string;
  fields: string[];
  maxRecords: number;
}) {
  const records: AirtableRecord[] = [];
  let offset = "";
  let truncated = false;

  do {
    const params = new URLSearchParams({
      pageSize: "100",
    });

    for (const field of Array.from(new Set(fields))) {
      if (field) params.append("fields[]", field);
    }

    if (offset) params.set("offset", offset);

    const response = await fetch(
      airtableUrl(baseId, tableName, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to load ${tableName}`,
      );
    }

    records.push(...(data.records || []));
    offset = String(data.offset || "");

    if (records.length >= maxRecords) {
      records.splice(maxRecords);
      truncated = Boolean(offset);
      break;
    }
  } while (offset);

  return {
    records,
    truncated,
  };
}

function value(
  fields: Record<string, unknown>,
  field?: SchemaField,
) {
  return field ? fields[field.name] : undefined;
}

function isoDate(
  valueToParse: unknown,
  fallback = "",
) {
  const text = displayText(valueToParse);

  if (!text) return fallback;

  const parsed = new Date(text);

  return Number.isNaN(parsed.getTime())
    ? fallback
    : parsed.toISOString();
}

function ageInDays(dateValue: string) {
  if (!dateValue) return null;

  const timestamp = new Date(dateValue).getTime();

  if (!Number.isFinite(timestamp)) return null;

  return Math.max(
    0,
    Math.floor(
      (Date.now() - timestamp) /
        (1000 * 60 * 60 * 24),
    ),
  );
}

function isTerminalStatus(status: string) {
  const text = status.toLowerCase();

  return TERMINAL_STATUSES.some((terminal) =>
    text.includes(terminal),
  );
}

function isDeliveryFailureStatus(status: string) {
  const text = status.toLowerCase();

  return DELIVERY_FAILURE_WORDS.some((word) =>
    text.includes(word),
  );
}

function isDohaLikeBase(
  baseName: string,
  invoiceTable: string,
) {
  const identity =
    `${baseName} ${invoiceTable}`.toLowerCase();

  return (
    identity.includes("doha") ||
    identity.includes("fab") ||
    identity.includes("dq") ||
    identity.includes("i5q")
  );
}

function buildInvoiceMap(
  table: SchemaTable,
): InvoiceMap {
  const fields = table.fields || [];

  return {
    orderNo:
      findField(fields, [
        "Order No.",
        "Order No",
        "Order Number",
        "order_no.",
        "order no.",
        "Invoice No.",
        "Invoice No",
        "Invoice Number",
        "Order ID",
      ]) ||
      fields.find(
        (field) =>
          field.id === table.primaryFieldId,
      ),
    status: findField(fields, [
      "Order Status",
      "Order_status",
      "order_status",
      "Status",
    ]),
    customer: findField(fields, [
      "Customer Name",
      "Customer",
      "Consignee",
      "Name",
      "Contact Name",
    ]),
    phone: findField(fields, [
      "Mobile Number",
      "Customer Mobile",
      "Contact no.",
      "Contact No.",
      "Contact No",
      "Phone",
      "Mobile",
      "Telephone1",
      "Consignee Mobile No 1",
    ]),
    address: findField(fields, [
      "Address",
      "Shipping Address",
      "Customer Address",
      "Billing Address Line 1",
      "Consignee Address 1",
      "address_bak",
      "Address BAK",
    ]),
    city: findField(fields, [
      "City",
      "City Name",
      "Billing Address City",
      "Emirate",
      "Destination",
      "Consignee City",
    ]),
    courier: findField(fields, [
      "Courier",
      "Courier Name",
      "Delivery Partner",
      "Ship Via",
      "Driver",
      "Driver Name",
    ]),
    awb: findField(fields, [
      "TFM AWB Number",
      "TFM AWB",
      "AWB Number",
      "AWB",
      "Tracking Number",
      "tracking_code",
      "Tracking Code",
    ]),
    courierError: findField(fields, [
      "TFM Error Message",
      "Courier Error",
      "Booking Error",
      "Shipment Error",
      "Courier Booking Error",
    ]),
    orderDate: findField(fields, [
      "Order Date",
      "Invoice Date",
      "Date",
      "Created Date",
      "created Date",
    ]),
    deliveredDate: findField(fields, [
      "Delivered Date",
      "COD Delivered Date",
      "Delivery Date",
      "Date Delivered",
      "Despatch Date",
      "Dispatch Date",
    ]),
    cod: findField(fields, [
      "cod_status",
      "COD_Status",
      "COD Status",
      "COD",
      "COD Received",
      "COD Receive",
      "COD Paid",
    ]),
    codReceiveDate: findField(fields, [
      "COD Receive Date",
      "COD Received Date",
      "COD Date",
      "Payment Received Date",
    ]),
    amount: findField(fields, [
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
    ]),
  };
}

function buildLineMap(
  table: SchemaTable,
): LineMap {
  const fields = table.fields || [];

  return {
    // Prefer the readable lookup/formula before the linked-record field.
    orderNo: findField(fields, [
      "Order Number",
      "Invoice No",
      "Invoice No.",
      "Order No.",
      "Order No",
      "order no.",
      "order no",
      "Invoice",
    ]),
    itemCode:
      findField(fields, [
        "Item Code",
        "SKU",
        "sku",
        "Product/Service",
        "Product Description",
        "Product",
      ]) ||
      fields.find(
        (field) =>
          field.id === table.primaryFieldId,
      ),
    supplier: findField(fields, [
      "Supplier",
      "Supplier Code",
      "Vendor",
    ]),
    billNo: findField(fields, [
      "bill_no",
      "Bill No",
      "Bill No.",
      "Bill Number",
      "Supplier Bill No",
      "Supplier Bill",
    ]),
    quantity: findField(fields, [
      "quantity",
      "Quantity",
      "Qty",
      "Order Quantity",
      "Product/Service Quantity",
    ]),
    receivedInUae: findField(fields, [
      "Received In UAE",
      "Received in UAE",
      "received_in_uae",
    ]),
    receivedInWarehouse: findField(fields, [
      "received_in_wh_1",
      "Received in WH 1",
      "Received In WH 1",
      "Received in Warehouse",
      "Received In Warehouse",
    ]),
    inStock: findField(fields, [
      "instock",
      "In Stock",
      "Instock",
    ]),
    soldOut: findField(fields, [
      "Sold Out",
      "Sold out",
      "sold_out",
    ]),
    processed: findField(fields, [
      "Processed",
      "processed",
    ]),
    supplierActivity: findField(fields, [
      "Supplier Activity",
      "Activity",
    ]),
  };
}

function mappedFieldNames(
  map: Record<string, SchemaField | undefined>,
) {
  return Object.values(map)
    .filter(
      (field): field is SchemaField =>
        Boolean(field?.name),
    )
    .map((field) => field.name);
}

function normalizeInvoice(
  record: AirtableRecord,
  map: InvoiceMap,
): NormalizedInvoice {
  const fields = record.fields || {};

  return {
    recordId: record.id,
    orderNo: displayText(value(fields, map.orderNo)),
    status: displayText(value(fields, map.status)),
    customer: displayText(value(fields, map.customer)),
    phone: displayText(value(fields, map.phone)),
    address: displayText(value(fields, map.address)),
    city: displayText(value(fields, map.city)),
    courier: displayText(value(fields, map.courier)),
    awb: displayText(value(fields, map.awb)),
    courierError: displayText(
      value(fields, map.courierError),
    ),
    createdAt: isoDate(
      value(fields, map.orderDate),
      record.createdTime || "",
    ),
    deliveredAt: isoDate(
      value(fields, map.deliveredDate),
    ),
    codValue: value(fields, map.cod),
    codReceivedAt: isoDate(
      value(fields, map.codReceiveDate),
    ),
    amount: numberValue(value(fields, map.amount)),
    raw: record,
  };
}

function normalizeLine(
  record: AirtableRecord,
  map: LineMap,
): NormalizedLine {
  const fields = record.fields || {};

  return {
    recordId: record.id,
    orderNo: displayText(value(fields, map.orderNo)),
    itemCode: displayText(value(fields, map.itemCode)),
    supplier: displayText(value(fields, map.supplier)),
    billNo: displayText(value(fields, map.billNo)),
    quantity: numberValue(value(fields, map.quantity)),
    receivedInUae: isTruthy(
      value(fields, map.receivedInUae),
    ),
    receivedInWarehouse: isTruthy(
      value(fields, map.receivedInWarehouse),
    ),
    inStock: isTruthy(value(fields, map.inStock)),
    soldOut: isSoldOut(value(fields, map.soldOut)),
    processed: isTruthy(value(fields, map.processed)),
    supplierActivity: displayText(
      value(fields, map.supplierActivity),
    ),
  };
}

function issueId(
  baseId: string,
  type: ExceptionType,
  identity: string,
) {
  return `${baseId}:${type}:${identity}`;
}

function addIssue(
  issues: ExceptionIssue[],
  issue: ExceptionIssue,
) {
  if (
    !issues.some(
      (existing) => existing.id === issue.id,
    )
  ) {
    issues.push(issue);
  }
}

async function processBase({
  base,
  stuckDays,
  maxRecords,
}: {
  base: SessionBase;
  stuckDays: number;
  maxRecords: number;
}): Promise<{
  issues: ExceptionIssue[];
  result: BaseResult;
}> {
  const token = resolveToken(base);

  if (!token) {
    throw new Error(
      `Airtable token missing for ${base.baseName}`,
    );
  }

  const schema = await loadSchema(base.baseId, token);

  const invoiceTable = findTable(
    schema,
    base.invoiceTable || "",
    [
      "BS Invoice",
      "DQ Invoice",
      "FAB Invoice",
      "Invoice",
    ],
    ["invoice"],
  );

  const orderEntryTable = findTable(
    schema,
    base.orderEntryTable || "",
    [
      "BS Order Entry",
      "DQ Order Entry",
      "FAB Order Entry",
      "Line Items",
      "Order Entry",
    ],
    ["orderentry", "lineitems"],
  );

  if (!invoiceTable && !orderEntryTable) {
    throw new Error(
      "Invoice and order-entry tables were not found",
    );
  }

  const warnings: string[] = [];
  const coverage: string[] = [];
  const issues: ExceptionIssue[] = [];
  let truncated = false;

  const invoiceMap = invoiceTable
    ? buildInvoiceMap(invoiceTable)
    : {};
  const lineMap = orderEntryTable
    ? buildLineMap(orderEntryTable)
    : {};

  let invoices: NormalizedInvoice[] = [];
  let lines: NormalizedLine[] = [];

  if (invoiceTable) {
    const invoiceLoad = await loadRecords({
      baseId: base.baseId,
      token,
      tableName: invoiceTable.name,
      fields: mappedFieldNames(invoiceMap),
      maxRecords,
    });

    truncated =
      truncated || invoiceLoad.truncated;
    invoices = invoiceLoad.records.map((record) =>
      normalizeInvoice(record, invoiceMap),
    );
  } else {
    warnings.push("Invoice table not found");
  }

  if (orderEntryTable) {
    const lineLoad = await loadRecords({
      baseId: base.baseId,
      token,
      tableName: orderEntryTable.name,
      fields: mappedFieldNames(lineMap),
      maxRecords,
    });

    truncated = truncated || lineLoad.truncated;
    lines = lineLoad.records
      .map((record) =>
        normalizeLine(record, lineMap),
      )
      .filter(
        (line) =>
          line.orderNo &&
          !line.orderNo.startsWith("rec"),
      );
  } else {
    warnings.push("Order-entry table not found");
  }

  if (
    invoiceMap.phone ||
    invoiceMap.address ||
    invoiceMap.customer
  ) {
    coverage.push("Customer details");
  }

  if (invoiceMap.status) {
    coverage.push("Stuck and delivery status");
  }

  if (
    invoiceMap.courierError ||
    invoiceMap.awb
  ) {
    coverage.push("Courier booking");
  }

  if (
    invoiceMap.cod ||
    invoiceMap.codReceiveDate
  ) {
    coverage.push("COD overdue");
  }

  if (
    lineMap.orderNo &&
    lineMap.supplier
  ) {
    coverage.push("Missing supplier");
  }

  if (
    lineMap.orderNo &&
    lineMap.billNo
  ) {
    coverage.push("Missing bill");
  }

  if (
    lineMap.orderNo &&
    (lineMap.receivedInUae ||
      lineMap.receivedInWarehouse ||
      lineMap.inStock)
  ) {
    coverage.push("Partial readiness");
  }

  const invoiceByOrder = new Map<
    string,
    NormalizedInvoice
  >();

  const duplicateMap = new Map<
    string,
    NormalizedInvoice[]
  >();

  for (const invoice of invoices) {
    if (!invoice.orderNo) continue;

    const key = normalize(invoice.orderNo);

    if (!invoiceByOrder.has(key)) {
      invoiceByOrder.set(key, invoice);
    }

    const duplicates =
      duplicateMap.get(key) || [];

    duplicates.push(invoice);
    duplicateMap.set(key, duplicates);
  }

  for (const [key, duplicateInvoices] of duplicateMap) {
    if (duplicateInvoices.length < 2) continue;

    const first = duplicateInvoices[0];

    addIssue(issues, {
      id: issueId(
        base.baseId,
        "duplicate_order",
        key,
      ),
      type: "duplicate_order",
      severity: "medium",
      title: "Duplicate order number",
      detail: `${duplicateInvoices.length} invoice records use the same order number.`,
      baseId: base.baseId,
      baseName: base.baseName,
      orderNo: first.orderNo,
      recordId: first.recordId,
      tableName: invoiceTable?.name || "",
      status: first.status,
      ageDays: ageInDays(first.createdAt),
    });
  }

  for (const invoice of invoices) {
    const orderNo =
      invoice.orderNo || invoice.recordId;
    const status = invoice.status;
    const terminal = isTerminalStatus(status);
    const ageDays = ageInDays(invoice.createdAt);
    const active =
      !terminal &&
      !isDeliveryFailureStatus(status);

    if (active) {
      const missingParts: string[] = [];

      if (
        invoiceMap.customer &&
        !invoice.customer
      ) {
        missingParts.push("customer name");
      }

      if (invoiceMap.phone && !invoice.phone) {
        missingParts.push("mobile");
      }

      if (
        invoiceMap.address &&
        !invoice.address
      ) {
        missingParts.push("address");
      }

      if (invoiceMap.city && !invoice.city) {
        missingParts.push("city");
      }

      if (missingParts.length) {
        addIssue(issues, {
          id: issueId(
            base.baseId,
            "customer_details",
            invoice.recordId,
          ),
          type: "customer_details",
          severity: "medium",
          title: "Missing customer details",
          detail: `Missing: ${missingParts.join(
            ", ",
          )}.`,
          baseId: base.baseId,
          baseName: base.baseName,
          orderNo,
          recordId: invoice.recordId,
          tableName: invoiceTable?.name || "",
          status,
          ageDays,
        });
      }

      if (
        invoiceMap.status &&
        ageDays !== null &&
        ageDays >= stuckDays
      ) {
        addIssue(issues, {
          id: issueId(
            base.baseId,
            "stuck_order",
            invoice.recordId,
          ),
          type: "stuck_order",
          severity:
            ageDays >= stuckDays * 2
              ? "high"
              : "medium",
          title: "Stuck active order",
          detail: `Order has remained active for ${ageDays} day(s).`,
          baseId: base.baseId,
          baseName: base.baseName,
          orderNo,
          recordId: invoice.recordId,
          tableName: invoiceTable?.name || "",
          status,
          ageDays,
        });
      }
    }

    if (
      invoice.courierError ||
      status
        .toLowerCase()
        .includes("booking failed") ||
      status
        .toLowerCase()
        .includes("courier failed")
    ) {
      addIssue(issues, {
        id: issueId(
          base.baseId,
          "courier_booking_failed",
          invoice.recordId,
        ),
        type: "courier_booking_failed",
        severity: "high",
        title: "Courier booking failed",
        detail:
          invoice.courierError ||
          `Courier status: ${status || "Failed"}.`,
        baseId: base.baseId,
        baseName: base.baseName,
        orderNo,
        recordId: invoice.recordId,
        tableName: invoiceTable?.name || "",
        status,
        ageDays,
      });
    } else if (
      normalize(invoice.courier).includes("tfm") &&
      invoiceMap.awb &&
      !invoice.awb &&
      status.toLowerCase().includes("dispatched")
    ) {
      addIssue(issues, {
        id: issueId(
          base.baseId,
          "courier_booking_failed",
          invoice.recordId,
        ),
        type: "courier_booking_failed",
        severity: "high",
        title: "TFM AWB missing",
        detail:
          "Order is marked dispatched with TFM but has no AWB/tracking number.",
        baseId: base.baseId,
        baseName: base.baseName,
        orderNo,
        recordId: invoice.recordId,
        tableName: invoiceTable?.name || "",
        status,
        ageDays,
      });
    }

    if (isDeliveryFailureStatus(status)) {
      addIssue(issues, {
        id: issueId(
          base.baseId,
          "delivery_failed",
          invoice.recordId,
        ),
        type: "delivery_failed",
        severity: "high",
        title: "Delivery failed",
        detail: `Current status: ${
          status || "Delivery failed"
        }.`,
        baseId: base.baseId,
        baseName: base.baseName,
        orderNo,
        recordId: invoice.recordId,
        tableName: invoiceTable?.name || "",
        status,
        ageDays,
      });
    }

    const delivered =
      normalize(status) === "delivered";

    const codRuleAvailable =
      Boolean(invoiceMap.cod) ||
      Boolean(invoiceMap.codReceiveDate);

    if (
      delivered &&
      codRuleAvailable &&
      !isDohaLikeBase(
        base.baseName,
        invoiceTable?.name || "",
      )
    ) {
      const codReceived =
        (invoiceMap.cod &&
          isTruthy(invoice.codValue)) ||
        (invoiceMap.codReceiveDate &&
          Boolean(invoice.codReceivedAt));

      if (!codReceived) {
        addIssue(issues, {
          id: issueId(
            base.baseId,
            "cod_overdue",
            invoice.recordId,
          ),
          type: "cod_overdue",
          severity: "high",
          title: "Delivered COD not received",
          detail:
            invoice.amount > 0
              ? `Pending COD amount: ${invoice.amount}.`
              : "Delivered order has no COD received confirmation/date.",
          baseId: base.baseId,
          baseName: base.baseName,
          orderNo,
          recordId: invoice.recordId,
          tableName: invoiceTable?.name || "",
          status,
          ageDays: ageInDays(
            invoice.deliveredAt ||
              invoice.createdAt,
          ),
          amount: invoice.amount,
        });
      }
    }
  }

  const linesByOrder = new Map<
    string,
    NormalizedLine[]
  >();

  for (const line of lines) {
    const key = normalize(line.orderNo);
    const group = linesByOrder.get(key) || [];

    group.push(line);
    linesByOrder.set(key, group);
  }

  for (const [orderKey, orderLines] of linesByOrder) {
    const parent = invoiceByOrder.get(orderKey);
    const orderNo =
      parent?.orderNo ||
      orderLines[0]?.orderNo ||
      "";
    const status = parent?.status || "";
    const terminal = parent
      ? isTerminalStatus(parent.status)
      : false;

    const activeLines = orderLines.filter(
      (line) => !line.processed,
    );

    const missingSupplierLines =
      activeLines.filter(
        (line) =>
          !line.supplier &&
          !line.inStock &&
          !line.soldOut,
      );

    if (
      lineMap.supplier &&
      !terminal &&
      missingSupplierLines.length
    ) {
      const itemCodes =
        missingSupplierLines
          .map((line) => line.itemCode)
          .filter(Boolean)
          .slice(0, 5);

      addIssue(issues, {
        id: issueId(
          base.baseId,
          "missing_supplier",
          orderKey,
        ),
        type: "missing_supplier",
        severity: "medium",
        title: "Item supplier missing",
        detail: `${missingSupplierLines.length} item line(s) have no supplier${
          itemCodes.length
            ? `: ${itemCodes.join(", ")}`
            : ""
        }.`,
        baseId: base.baseId,
        baseName: base.baseName,
        orderNo,
        recordId:
          missingSupplierLines[0].recordId,
        tableName: orderEntryTable?.name || "",
        status,
        ageDays: parent
          ? ageInDays(parent.createdAt)
          : null,
      });
    }

    const missingBillLines =
      activeLines.filter((line) => {
        const supplierDispatched =
          normalize(
            line.supplierActivity,
          ).includes("dispatched");

        const receivingStarted =
          line.receivedInUae ||
          line.receivedInWarehouse ||
          supplierDispatched;

        return (
          Boolean(line.supplier) &&
          receivingStarted &&
          !line.billNo &&
          !line.inStock &&
          !line.soldOut
        );
      });

    if (
      lineMap.billNo &&
      !terminal &&
      missingBillLines.length
    ) {
      const itemCodes =
        missingBillLines
          .map((line) => line.itemCode)
          .filter(Boolean)
          .slice(0, 5);

      addIssue(issues, {
        id: issueId(
          base.baseId,
          "missing_bill",
          orderKey,
        ),
        type: "missing_bill",
        severity: "medium",
        title: "Supplier bill missing",
        detail: `${missingBillLines.length} received/dispatched item line(s) have no bill number${
          itemCodes.length
            ? `: ${itemCodes.join(", ")}`
            : ""
        }.`,
        baseId: base.baseId,
        baseName: base.baseName,
        orderNo,
        recordId: missingBillLines[0].recordId,
        tableName: orderEntryTable?.name || "",
        status,
        ageDays: parent
          ? ageInDays(parent.createdAt)
          : null,
      });
    }

    const actionableLines = activeLines.filter(
      (line) => !line.soldOut,
    );

    const readyLines = actionableLines.filter(
      (line) =>
        line.inStock ||
        line.receivedInUae ||
        (!lineMap.receivedInUae &&
          line.receivedInWarehouse),
    );

    if (
      !terminal &&
      actionableLines.length > 1 &&
      readyLines.length > 0 &&
      readyLines.length < actionableLines.length
    ) {
      const readyPcs = readyLines.reduce(
        (sum, line) =>
          sum + Math.max(line.quantity, 1),
        0,
      );

      const totalPcs = actionableLines.reduce(
        (sum, line) =>
          sum + Math.max(line.quantity, 1),
        0,
      );

      addIssue(issues, {
        id: issueId(
          base.baseId,
          "partially_ready",
          orderKey,
        ),
        type: "partially_ready",
        severity: "medium",
        title: "Order partially ready",
        detail: `${readyLines.length}/${actionableLines.length} item line(s) ready; ${readyPcs}/${totalPcs} piece(s) ready.`,
        baseId: base.baseId,
        baseName: base.baseName,
        orderNo,
        recordId: actionableLines[0].recordId,
        tableName: orderEntryTable?.name || "",
        status,
        ageDays: parent
          ? ageInDays(parent.createdAt)
          : null,
      });
    }

    const mismatchLines =
      activeLines.filter(
        (line) =>
          line.quantity <= 0 &&
          (line.inStock ||
            line.receivedInUae ||
            line.receivedInWarehouse),
      );

    if (
      lineMap.quantity &&
      mismatchLines.length
    ) {
      const itemCodes =
        mismatchLines
          .map((line) => line.itemCode)
          .filter(Boolean)
          .slice(0, 5);

      addIssue(issues, {
        id: issueId(
          base.baseId,
          "stock_mismatch",
          orderKey,
        ),
        type: "stock_mismatch",
        severity: "high",
        title: "Ready item has zero quantity",
        detail: `${mismatchLines.length} received/in-stock line(s) have zero or blank quantity${
          itemCodes.length
            ? `: ${itemCodes.join(", ")}`
            : ""
        }.`,
        baseId: base.baseId,
        baseName: base.baseName,
        orderNo,
        recordId: mismatchLines[0].recordId,
        tableName: orderEntryTable?.name || "",
        status,
        ageDays: parent
          ? ageInDays(parent.createdAt)
          : null,
      });
    }
  }

  return {
    issues,
    result: {
      baseId: base.baseId,
      baseName: base.baseName,
      invoiceTable: invoiceTable?.name || "",
      orderEntryTable:
        orderEntryTable?.name || "",
      issueCount: issues.length,
      coverage,
      warnings,
      truncated,
    },
  };
}

function uniqueBases(bases: SessionBase[]) {
  const seen = new Set<string>();

  return bases.filter((base) => {
    const baseId = String(base.baseId || "").trim();

    if (!baseId || seen.has(baseId)) {
      return false;
    }

    seen.add(baseId);
    return true;
  });
}

function severityRank(severity: Severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Not authenticated",
        },
        { status: 401 },
      );
    }

    if (session.role === "Supplier") {
      return NextResponse.json(
        {
          success: false,
          message:
            "Supplier accounts cannot access the Exception Dashboard",
        },
        { status: 403 },
      );
    }

    const isAdmin =
      session.role === "Admin" ||
      session.superAdmin === true;

    const selectedBase =
      session.selectedBase ||
      session.permissions?.[0];

    const allSessionBases = uniqueBases(
      (
        session.availableBases?.length
          ? session.availableBases
          : session.permissions || []
      ) as SessionBase[],
    );

    const requestedBases = isAdmin
      ? allSessionBases
      : selectedBase
        ? [selectedBase as SessionBase]
        : [];

    const accessibleBases = requestedBases.filter(
      (base) =>
        isAdmin ||
        Boolean(base.canView || base.canReports),
    );

    if (!accessibleBases.length) {
      return NextResponse.json(
        {
          success: false,
          message:
            "No accessible Airtable base is available for this dashboard",
        },
        { status: 403 },
      );
    }

    const stuckDaysRaw = Number(
      request.nextUrl.searchParams.get(
        "stuckDays",
      ) || 3,
    );

    const stuckDays = Math.min(
      30,
      Math.max(
        1,
        Number.isFinite(stuckDaysRaw)
          ? Math.round(stuckDaysRaw)
          : 3,
      ),
    );

    const configuredLimit = Number(
      process.env
        .EXCEPTION_DASHBOARD_MAX_RECORDS_PER_TABLE ||
        3000,
    );

    const maxRecords = Math.min(
      10000,
      Math.max(
        500,
        Number.isFinite(configuredLimit)
          ? Math.round(configuredLimit)
          : 3000,
      ),
    );

    const issues: ExceptionIssue[] = [];
    const baseResults: BaseResult[] = [];

    // Sequential base processing avoids avoidable Airtable rate-limit spikes.
    for (const base of accessibleBases) {
      try {
        const processed = await processBase({
          base,
          stuckDays,
          maxRecords,
        });

        issues.push(...processed.issues);
        baseResults.push(processed.result);
      } catch (error) {
        baseResults.push({
          baseId: base.baseId,
          baseName: base.baseName,
          invoiceTable:
            base.invoiceTable || "",
          orderEntryTable:
            base.orderEntryTable || "",
          issueCount: 0,
          coverage: [],
          warnings: [],
          error:
            error instanceof Error
              ? error.message
              : "Base scan failed",
          truncated: false,
        });
      }
    }

    issues.sort((a, b) => {
      const severityDifference =
        severityRank(b.severity) -
        severityRank(a.severity);

      if (severityDifference !== 0) {
        return severityDifference;
      }

      return (
        (b.ageDays ?? -1) -
        (a.ageDays ?? -1)
      );
    });

    const byType = issues.reduce<
      Record<ExceptionType, number>
    >(
      (summary, issue) => {
        summary[issue.type] += 1;
        return summary;
      },
      {
        customer_details: 0,
        missing_supplier: 0,
        missing_bill: 0,
        stuck_order: 0,
        partially_ready: 0,
        courier_booking_failed: 0,
        delivery_failed: 0,
        stock_mismatch: 0,
        duplicate_order: 0,
        cod_overdue: 0,
      },
    );

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      scope: isAdmin ? "all-bases" : "selected-base",
      selectedBaseId:
        selectedBase?.baseId || "",
      selectedBaseName:
        selectedBase?.baseName || "",
      stuckDays,
      maxRecordsPerTable: maxRecords,
      summary: {
        total: issues.length,
        high: issues.filter(
          (issue) => issue.severity === "high",
        ).length,
        medium: issues.filter(
          (issue) =>
            issue.severity === "medium",
        ).length,
        low: issues.filter(
          (issue) => issue.severity === "low",
        ).length,
        basesScanned: baseResults.filter(
          (base) => !base.error,
        ).length,
        basesFailed: baseResults.filter(
          (base) => Boolean(base.error),
        ).length,
        byType,
      },
      bases: baseResults,
      issues,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Exception Dashboard failed",
      },
      { status: 500 },
    );
  }
}
