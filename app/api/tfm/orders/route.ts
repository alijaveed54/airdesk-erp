import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtablePaginatedFetch,
  airtableUrl,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import { getSession } from "@/lib/auth";
import {
  getTfmSupportedBase,
  isTfmSupportedBase,
} from "@/lib/tfm";

type SchemaField = {
  id: string;
  name: string;
  type: string;
  options?: {
    linkedTableId?: string;
  };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: SchemaField[];
};

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
};

type ValidationIssue = {
  field: string;
  message: string;
  severity: "error" | "warning";
};

type TfmStatusGroup =
  | "Created"
  | "In Transit"
  | "Out for Delivery"
  | "On Hold"
  | "Delivered"
  | "Returned"
  | "Cancelled"
  | "Unknown";

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function firstValue(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value[0];

    if (first && typeof first === "object") {
      const objectValue = first as Record<string, unknown>;

      return String(
        objectValue.name ??
          objectValue.value ??
          objectValue.text ??
          objectValue.id ??
          "",
      ).trim();
    }

    return String(first ?? "").trim();
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;

    return String(
      objectValue.name ??
        objectValue.value ??
        objectValue.text ??
        objectValue.id ??
        "",
    ).trim();
  }

  return String(value ?? "").trim();
}

function numberValue(value: unknown): number {
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

function normalizePhone(value: unknown) {
  const raw = firstValue(value);
  const cleaned = raw.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("00")) {
    return `+${cleaned.slice(2)}`;
  }

  return cleaned;
}

function findField(
  fields: SchemaField[],
  candidates: string[],
): SchemaField | undefined {
  const exactNames = new Set(
    candidates.map((candidate) => normalize(candidate)),
  );

  return fields.find((field) =>
    exactNames.has(normalize(field.name)),
  );
}

function escapeFormulaValue(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

async function loadSchema(baseId: string, token: string) {
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
      data?.error?.message || "Unable to load Airtable schema",
    );
  }

  return (data.tables || []) as SchemaTable[];
}

async function fetchCustomerRecords({
  baseId,
  token,
  table,
  recordIds,
}: {
  baseId: string;
  token: string;
  table: string;
  recordIds: string[];
}) {
  const uniqueIds = Array.from(
    new Set(recordIds.filter(Boolean)),
  );

  const records: AirtableRecord[] = [];

  for (let index = 0; index < uniqueIds.length; index += 40) {
    const chunk = uniqueIds.slice(index, index + 40);

    if (!chunk.length) continue;

    const formula =
      chunk.length === 1
        ? `RECORD_ID()='${escapeFormulaValue(chunk[0])}'`
        : `OR(${chunk
            .map(
              (recordId) =>
                `RECORD_ID()='${escapeFormulaValue(recordId)}'`,
            )
            .join(",")})`;

    const params = new URLSearchParams({
      filterByFormula: formula,
      pageSize: "100",
    });

    const response = await fetch(
      airtableUrl(baseId, table, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to load customer records from ${table}`,
      );
    }

    records.push(...(data.records || []));
  }

  return new Map(records.map((record) => [record.id, record]));
}

function readField(
  invoiceValues: Record<string, unknown>,
  customerValues: Record<string, unknown>,
  invoiceField?: SchemaField,
  customerField?: SchemaField,
) {
  return (
    firstValue(invoiceValues[invoiceField?.name || ""]) ||
    firstValue(customerValues[customerField?.name || ""])
  );
}

function getLinkedRecordId(value: unknown) {
  if (Array.isArray(value)) {
    const first = value[0];

    if (typeof first === "string") return first;

    if (first && typeof first === "object") {
      return String(
        (first as Record<string, unknown>).id || "",
      ).trim();
    }
  }

  if (typeof value === "string" && value.startsWith("rec")) {
    return value;
  }

  return "";
}


function listValues(value: unknown) {
  const raw = Array.isArray(value)
    ? value.map((item) => firstValue(item)).join("|")
    : firstValue(value);

  const unique = new Map<string, string>();

  for (const item of raw.split(/[\n,;|]+/g)) {
    const text = item.trim();
    const key = normalize(text);

    if (key && !unique.has(key)) {
      unique.set(key, text);
    }
  }

  return Array.from(unique.values());
}

function statusGroup(value: unknown): TfmStatusGroup {
  const text = normalize(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!text) return "Unknown";

  if (
    text.includes("cancel") ||
    text.includes("void")
  ) {
    return "Cancelled";
  }

  if (
    text.includes("return") ||
    text.includes("rto") ||
    text.includes("shipper return")
  ) {
    return "Returned";
  }

  if (
    text.includes("delivered") ||
    text.includes("completed")
  ) {
    return "Delivered";
  }

  if (
    text.includes("out for delivery") ||
    text === "ofd" ||
    text.includes("with courier")
  ) {
    return "Out for Delivery";
  }

  if (
    text.includes("on hold") ||
    text.includes("delivery failed") ||
    text.includes("failed delivery") ||
    text.includes("delivery exception") ||
    text.includes("address issue")
  ) {
    return "On Hold";
  }

  if (
    text.includes("checked in") ||
    text.includes("checkedin") ||
    text.includes("check in") ||
    text.includes("in transit") ||
    text.includes("picked") ||
    text.includes("collected") ||
    text.includes("manifest") ||
    text.includes("facility") ||
    text.includes("hub") ||
    text.includes("shipped") ||
    text.includes("far area delivery") ||
    text.includes("transit")
  ) {
    return "In Transit";
  }

  if (
    text.includes("created") ||
    text.includes("booked") ||
    text.includes("registered") ||
    text.includes("pending pickup") ||
    text.includes("shipment schedule") ||
    text.includes("scheduled") ||
    text.includes("ready for pickup")
  ) {
    return "Created";
  }

  return "Unknown";
}

function daysSince(value: string) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return Math.max(
    0,
    Math.floor(
      (Date.now() - date.getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );
}

function isTerminalStatus(group: TfmStatusGroup) {
  return (
    group === "Delivered" ||
    group === "Returned" ||
    group === "Cancelled"
  );
}

export async function GET() {
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
        { success: false, message: "Supplier access is not allowed" },
        { status: 403 },
      );
    }

    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view TFM orders",
        },
        { status: 403 },
      );
    }

    if (!isTfmSupportedBase(airtable.baseId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "TFM integration is available only for BS Order Entry and Tatlumput Siyam Order Entry",
        },
        { status: 400 },
      );
    }

    const supportedBase = getTfmSupportedBase(airtable.baseId);
    const schema = await loadSchema(
      airtable.baseId,
      airtable.token,
    );

    const invoiceTable =
      schema.find(
        (table) => table.name === airtable.tables.invoice,
      ) ||
      schema.find(
        (table) => table.name === supportedBase?.invoiceTable,
      );

    if (!invoiceTable) {
      throw new Error(
        `Invoice table not found: ${
          airtable.tables.invoice || supportedBase?.invoiceTable
        }`,
      );
    }

    const fields = invoiceTable.fields || [];

    const orderNoField =
      findField(fields, [
        "Order No.",
        "Order No",
        "order_no.",
        "order no.",
        "Order Number",
        "Invoice No.",
        "Invoice No",
      ]) ||
      fields.find(
        (field) => field.id === invoiceTable.primaryFieldId,
      );

    const statusField = findField(fields, [
      "Order Status",
      "Order_status",
      "order_status",
      "Status",
    ]);

    const courierField = findField(fields, [
      "Courier",
      "courier",
      "Courier Name",
      "Delivery Partner",
    ]);

    if (!orderNoField) {
      throw new Error(
        "Order Number field was not found in the selected invoice table",
      );
    }

    if (!statusField || !courierField) {
      throw new Error(
        "Order Status or Courier field was not found in the selected invoice table",
      );
    }

    const customerLinkField =
      fields.find((field) => {
        if (
          field.type !== "multipleRecordLinks" ||
          !field.options?.linkedTableId
        ) {
          return false;
        }

        const linkedTable = schema.find(
          (table) =>
            table.id === field.options?.linkedTableId,
        );

        return Boolean(
          linkedTable?.name
            .trim()
            .toLowerCase()
            .includes("customer"),
        );
      }) ||
      findField(fields, [
        "Customer",
        "Contact",
        "Contact No.",
        "Contact Bak",
      ]);

    const customerTable = customerLinkField?.options?.linkedTableId
      ? schema.find(
          (table) =>
            table.id === customerLinkField.options?.linkedTableId,
        )
      : schema.find(
          (table) =>
            table.name === airtable.tables.customers,
        );

    const customerFields = customerTable?.fields || [];

    const fieldMap = {
      invoiceCustomer: findField(fields, [
        "Consignee",
        "Customer Name",
        "Contact Name",
        "Consignee Name",
        "Customer",
      ]),
      invoicePhone: findField(fields, [
        "Telephone1",
        "Contact No.",
        "Mobile Number",
        "Customer Mobile",
        "Phone",
        "Mobile",
        "Consignee Mobile No 1",
      ]),
      invoiceAddress: findField(fields, [
        "Consignee Address 1",
        "Address",
        "Shipping Address",
        "Customer Address",
        "address_bak",
        "Address BAK",
        "Billing Address Line 1",
      ]),
      invoiceCity: findField(fields, [
        "City",
        "City Name",
        "Billing Address City",
        "Emirate",
        "Destination",
        "Consignee City",
      ]),
      invoiceArea: findField(fields, [
        "Area",
        "Consignee Area",
        "Location",
      ]),
      invoiceBuilding: findField(fields, [
        "Building",
        "Building Name",
        "Flat / Building",
        "Consignee Building",
      ]),
      invoiceStreet: findField(fields, [
        "Street",
        "Street Name",
        "Consignee Street",
      ]),
      invoiceTotal: findField(fields, [
        "total_order_value",
        "Total Order Value",
        "Order_Total",
        "Grand Total",
        "item value + shipping",
        "Total (item Cost + Shipping)",
        "Total Amount(Including shipping and VAT Reducing Discount)",
      ]),
      invoiceAdvance: findField(fields, [
        "Advance",
        "Advance Payment",
        "advance_payment",
        "Paid Amount",
        "Payment Received",
      ]),
      invoiceStore: findField(fields, [
        "Select Store",
        "Store",
        "Select_Store",
      ]),
      invoiceNote: findField(fields, [
        "Order Note",
        "order note",
        "Note",
        "Notes",
        "Remarks",
        "Special Instructions",
      ]),
      invoicePieces: findField(fields, [
        "Number of Pieces",
        "Pieces",
        "Pcs",
        "quantity",
        "Quantity",
        "Order Quantity",
      ]),
      awb: findField(fields, [
        "TFM AWB Number",
        "TFM AWB",
        "AWB Number",
        "AWB",
        "Tracking Number",
        "tracking_code",
      ]),
      shipmentId: findField(fields, [
        "TFM Shipment ID",
        "Shipment ID",
      ]),
      tfmStatus: findField(fields, [
        "TFM Status",
        "Courier Status",
        "Tracking Status",
      ]),
      previousAwbs: findField(fields, [
        "TFM Previous AWBs",
        "Previous AWBs",
        "AWB History",
      ]),
      bookingDate: findField(fields, [
        "TFM Booking Date",
        "Booking Date",
        "Created",
      ]),
      lastActionDate: findField(fields, [
        "TFM Last Action Date",
        "Last Action Date",
        "Courier Last Action Date",
      ]),
      lastSync: findField(fields, [
        "TFM Last Sync",
        "Courier Last Sync",
        "Last Sync",
      ]),
      tfmLocation: findField(fields, [
        "TFM Location",
        "Tracking Location",
        "Current Location",
      ]),
      tfmExpectedDelivery: findField(fields, [
        "TFM Expected Delivery",
        "Expected Delivery Date",
        "Future Delivery Date",
      ]),
      codStatus: findField(fields, [
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
        "COD Collection Date",
        "Payment Received Date",
      ]),
      customerName: findField(customerFields, [
        "Customer Name",
        "Name",
        "Consignee",
        "Full Name",
      ]),
      customerPhone: findField(customerFields, [
        "Contact No.",
        "Contact No",
        "Contact",
        "Phone",
        "Mobile",
        "Mobile Number",
      ]),
      customerAddress: findField(customerFields, [
        "Address",
        "Customer Address",
        "Shipping Address",
      ]),
      customerCity: findField(customerFields, [
        "City",
        "City Name",
        "Emirate",
      ]),
      customerArea: findField(customerFields, [
        "Area",
        "Location",
      ]),
      customerBuilding: findField(customerFields, [
        "Building",
        "Building Name",
        "Flat / Building",
      ]),
      customerStreet: findField(customerFields, [
        "Street",
        "Street Name",
      ]),
    };

    const filterByFormula = `LEN(TRIM({${orderNoField.name}}&''))>0`;

    const params = new URLSearchParams({
      filterByFormula,
      pageSize: "100",
    });

    const invoiceRecords = (await airtablePaginatedFetch({
      baseId: airtable.baseId,
      token: airtable.token,
      table: invoiceTable.name,
      params,
    })) as AirtableRecord[];

    const customerRecordIds = invoiceRecords
      .map((record) =>
        getLinkedRecordId(
          record.fields[customerLinkField?.name || ""],
        ),
      )
      .filter(Boolean);

    const customers =
      customerTable && customerRecordIds.length
        ? await fetchCustomerRecords({
            baseId: airtable.baseId,
            token: airtable.token,
            table: customerTable.name,
            recordIds: customerRecordIds,
          })
        : new Map<string, AirtableRecord>();

    const orders = invoiceRecords.map((record) => {
      const invoiceValues = record.fields || {};
      const customerRecordId = getLinkedRecordId(
        invoiceValues[customerLinkField?.name || ""],
      );
      const customerValues =
        customers.get(customerRecordId)?.fields || {};

      const customerName =
        readField(
          invoiceValues,
          customerValues,
          fieldMap.invoiceCustomer,
          fieldMap.customerName,
        ) || "";

      const phone = normalizePhone(
        readField(
          invoiceValues,
          customerValues,
          fieldMap.invoicePhone,
          fieldMap.customerPhone,
        ),
      );

      const address = readField(
        invoiceValues,
        customerValues,
        fieldMap.invoiceAddress,
        fieldMap.customerAddress,
      );

      const city = readField(
        invoiceValues,
        customerValues,
        fieldMap.invoiceCity,
        fieldMap.customerCity,
      );

      const area = readField(
        invoiceValues,
        customerValues,
        fieldMap.invoiceArea,
        fieldMap.customerArea,
      );

      const building = readField(
        invoiceValues,
        customerValues,
        fieldMap.invoiceBuilding,
        fieldMap.customerBuilding,
      );

      const street = readField(
        invoiceValues,
        customerValues,
        fieldMap.invoiceStreet,
        fieldMap.customerStreet,
      );

      const total = numberValue(
        invoiceValues[fieldMap.invoiceTotal?.name || ""],
      );

      const advance = numberValue(
        invoiceValues[fieldMap.invoiceAdvance?.name || ""],
      );

      const rawCodAmount = Number(
        (total - advance).toFixed(2),
      );

      const codAmount = Math.max(rawCodAmount, 0);

      const pieces = Math.max(
        Math.round(
          numberValue(
            invoiceValues[fieldMap.invoicePieces?.name || ""],
          ),
        ),
        1,
      );

      const orderNo =
        firstValue(
          invoiceValues[orderNoField?.name || ""],
        ) || record.id;

      const awbNumber = firstValue(
        invoiceValues[fieldMap.awb?.name || ""],
      );

      const shipmentId = firstValue(
        invoiceValues[fieldMap.shipmentId?.name || ""],
      );

      const tfmStatus = firstValue(
        invoiceValues[fieldMap.tfmStatus?.name || ""],
      );

      const previousAwbNumbers = listValues(
        invoiceValues[fieldMap.previousAwbs?.name || ""],
      ).filter(
        (value) => normalize(value) !== normalize(awbNumber),
      );

      const bookingDate = firstValue(
        invoiceValues[fieldMap.bookingDate?.name || ""],
      );

      const lastActionDate = firstValue(
        invoiceValues[fieldMap.lastActionDate?.name || ""],
      );

      const lastSync = firstValue(
        invoiceValues[fieldMap.lastSync?.name || ""],
      );

      const tfmLocation = firstValue(
        invoiceValues[fieldMap.tfmLocation?.name || ""],
      );

      const tfmExpectedDelivery = firstValue(
        invoiceValues[fieldMap.tfmExpectedDelivery?.name || ""],
      );

      const codStatus = firstValue(
        invoiceValues[fieldMap.codStatus?.name || ""],
      );

      const codReceiveDate = firstValue(
        invoiceValues[fieldMap.codReceiveDate?.name || ""],
      );

      const normalizedCodStatus = normalize(codStatus);
      const codReceived =
        Boolean(codReceiveDate) ||
        ["yes", "true", "received", "paid", "released", "settled", "remitted", "1"].includes(
          normalizedCodStatus,
        );

      const groupedStatus = statusGroup(tfmStatus);
      const ageReference =
        lastActionDate ||
        bookingDate ||
        record.createdTime ||
        "";
      const daysWithoutAction = daysSince(ageReference);

      const stale =
        Boolean(awbNumber) &&
        !isTerminalStatus(groupedStatus) &&
        daysWithoutAction !== null &&
        daysWithoutAction >= 3;

      const currentOrderStatus = firstValue(
        invoiceValues[statusField.name],
      );
      const currentCourier = firstValue(
        invoiceValues[courierField.name],
      );
      const issues: ValidationIssue[] = [];

      if (
        normalize(currentOrderStatus) !== "order received"
      ) {
        issues.push({
          field: "Order Status",
          message: `Current value is ${
            currentOrderStatus || "blank"
          }; it will change to Order Received after successful TFM AWB creation`,
          severity: "warning",
        });
      }

      if (normalize(currentCourier) !== "tfm") {
        issues.push({
          field: "Courier",
          message: `Current value is ${
            currentCourier || "blank"
          }; it will change to TFM after successful TFM AWB creation`,
          severity: "warning",
        });
      }

      if (!orderNo || orderNo.startsWith("rec")) {
        issues.push({
          field: "Order Number",
          message: "Valid order number is missing",
          severity: "error",
        });
      }

      if (!customerName) {
        issues.push({
          field: "Customer",
          message: "Customer name is missing",
          severity: "error",
        });
      }

      if (!phone) {
        issues.push({
          field: "Mobile",
          message: "Customer mobile number is missing",
          severity: "error",
        });
      } else if (phone.replace(/\D/g, "").length < 8) {
        issues.push({
          field: "Mobile",
          message: "Customer mobile number looks invalid",
          severity: "error",
        });
      }

      if (![building, street, address].some(Boolean)) {
        issues.push({
          field: "Address",
          message: "Delivery address is missing",
          severity: "error",
        });
      }

      if (!city) {
        issues.push({
          field: "City",
          message: "Delivery city is missing",
          severity: "error",
        });
      }

      if (total <= 0) {
        issues.push({
          field: "Total",
          message: "Order total is missing or invalid",
          severity: "error",
        });
      }

      if (advance < 0) {
        issues.push({
          field: "Advance",
          message: "Advance cannot be negative",
          severity: "error",
        });
      }

      if (rawCodAmount < 0) {
        issues.push({
          field: "COD",
          message: "Advance is greater than order total",
          severity: "error",
        });
      }

      if (awbNumber) {
        issues.push({
          field: "AWB",
          message: `Existing AWB found: ${awbNumber}. New AWB remains allowed after review.`,
          severity: "warning",
        });
      }

      if (previousAwbNumbers.length) {
        issues.push({
          field: "AWB History",
          message: `Previous AWBs: ${previousAwbNumbers.join(
            ", ",
          )}. New AWB remains allowed after review.`,
          severity: "warning",
        });
      }

      if (awbNumber && !tfmStatus) {
        issues.push({
          field: "TFM Status",
          message: "AWB exists but tracking status is missing",
          severity: "warning",
        });
      }

      if (stale) {
        issues.push({
          field: "Tracking",
          message: `No new action for ${daysWithoutAction} days`,
          severity: "warning",
        });
      }

      const hasErrors = issues.some(
        (issue) => issue.severity === "error",
      );

      return {
        recordId: record.id,
        orderNo,
        orderStatus: currentOrderStatus,
        courier: currentCourier,
        customerName,
        phone,
        address,
        city,
        area,
        building,
        street,
        store:
          firstValue(
            invoiceValues[fieldMap.invoiceStore?.name || ""],
          ) || "Mysmar",
        note: firstValue(
          invoiceValues[fieldMap.invoiceNote?.name || ""],
        ),
        pieces,
        total,
        advance,
        codAmount,
        paymentType: codAmount > 0 ? "COD" : "Prepaid",
        awbNumber,
        previousAwbNumbers,
        shipmentId,
        tfmStatus,
        statusGroup: groupedStatus,
        bookingDate,
        lastActionDate,
        lastSync,
        tfmLocation,
        tfmExpectedDelivery,
        codStatus,
        codReceiveDate,
        codReceived,
        daysSinceLastAction: daysWithoutAction,
        stale,
        alreadyBooked: Boolean(
          awbNumber ||
            shipmentId ||
            previousAwbNumbers.length,
        ),
        canCreateNewAwb: !hasErrors,
        valid: !hasErrors,
        issues,
      };
    });

    const validCount = orders.filter(
      (order) => order.valid,
    ).length;

    const invalidCount = orders.filter(
      (order) => !order.valid,
    ).length;

    const alreadyBookedCount = orders.filter(
      (order) => order.alreadyBooked,
    ).length;

    const statusCounts = {
      Created: 0,
      "In Transit": 0,
      "Out for Delivery": 0,
      "On Hold": 0,
      Delivered: 0,
      Returned: 0,
      Cancelled: 0,
      Unknown: 0,
    } satisfies Record<TfmStatusGroup, number>;

    for (const order of orders) {
      statusCounts[order.statusGroup] += 1;
    }

    const staleCount = orders.filter(
      (order) => order.stale,
    ).length;
    const codPendingCount = orders.filter(
      (order) => order.codAmount > 0 && !order.codReceived,
    ).length;
    const codReceivedCount = orders.filter(
      (order) => order.codAmount > 0 && order.codReceived,
    ).length;

    return NextResponse.json({
      success: true,
      base: {
        baseId: airtable.baseId,
        baseName: airtable.baseName,
        invoiceTable: invoiceTable.name,
      },
      summary: {
        total: orders.length,
        valid: validCount,
        invalid: invalidCount,
        alreadyBooked: alreadyBookedCount,
        stale: staleCount,
        codPending: codPendingCount,
        codReceived: codReceivedCount,
        statusCounts,
      },
      orders,
    });
  } catch (error) {
    return handleApiError(
      error,
      "TFM shipment-ready orders could not load",
    );
  }
}

