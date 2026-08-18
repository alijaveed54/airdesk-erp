import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
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
    linkedTableId?: string;
  };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: SchemaField[];
};

type CourierName = "TFM" | "EWE";

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

  return String(resolved).trim();
}

function amount(value: unknown): number {
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

function exactFormula(fieldName: string, value: string) {
  return `LOWER({${fieldName}} & '')=LOWER('${escapeFormulaValue(
    value
  )}')`;
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

function supportsCourierDownloadBase(baseName: string) {
  const normalized = baseName.trim().toLowerCase();

  return (
    normalized.includes("bs order") ||
    normalized.includes("bs invoice") ||
    normalized.includes("uae") ||
    normalized === "bs" ||
    normalized.includes("tatlumput") ||
    normalized.includes("siyam") ||
    normalized === "tat" ||
    normalized === "ts" ||
    normalized.startsWith("ts ")
  );
}

function booleanFlag(value: unknown) {
  const resolved = first(value);

  if (typeof resolved === "boolean") return resolved;

  const normalized = String(resolved ?? "")
    .trim()
    .toLowerCase();

  return (
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "checked" ||
    normalized === "1"
  );
}

function destinationCode(city: string) {
  const normalized = city.toLowerCase();

  if (normalized.includes("dubai")) return "DXB";
  if (normalized.includes("sharjah")) return "SHJ";
  if (normalized.includes("ajman")) return "AJM";
  if (
    normalized.includes("ras al khaimah") ||
    normalized.includes("rak")
  ) {
    return "RAK";
  }
  if (normalized.includes("abu dhabi")) return "AUH";
  if (normalized.includes("al ain")) return "ALN";
  if (normalized.includes("fujairah")) return "FJR";
  if (
    normalized.includes("umm al quwain") ||
    normalized.includes("uaq")
  ) {
    return "UAQ";
  }
  if (
    normalized.includes("western region") ||
    normalized.includes("al dhafra")
  ) {
    return "WR";
  }

  return "";
}

async function fetchAllRecords({
  airtable,
  tableName,
  formula,
}: {
  airtable: Awaited<
    ReturnType<typeof getCurrentAirtableBase>
  >;
  tableName: string;
  formula: string;
}) {
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: formula,
    });

    if (offset) params.set("offset", offset);

    const response = await fetch(
      airtableUrl(airtable.baseId, tableName, params),
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
          `Unable to load ${tableName}`
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

async function resolveCustomers({
  airtable,
  schema,
  invoiceTable,
  customerLinkField,
  invoiceRecords,
}: {
  airtable: Awaited<
    ReturnType<typeof getCurrentAirtableBase>
  >;
  schema: SchemaTable[];
  invoiceTable: SchemaTable;
  customerLinkField: SchemaField | undefined;
  invoiceRecords: any[];
}) {
  const customers = new Map<string, Record<string, unknown>>();

  if (!customerLinkField?.options?.linkedTableId) {
    return customers;
  }

  const customerTable = schema.find(
    (table) =>
      table.id === customerLinkField.options?.linkedTableId
  );

  if (!customerTable) return customers;

  const ids = Array.from(
    new Set(
      invoiceRecords
        .flatMap((record) => {
          const value =
            record.fields?.[customerLinkField.name];

          return Array.isArray(value)
            ? value
            : value
              ? [value]
              : [];
        })
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.startsWith("rec")
        )
    )
  );

  for (let start = 0; start < ids.length; start += 40) {
    const batch = ids.slice(start, start + 40);

    const formula =
      batch.length === 1
        ? `RECORD_ID()='${batch[0]}'`
        : `OR(${batch
            .map((id) => `RECORD_ID()='${id}'`)
            .join(",")})`;

    const records = await fetchAllRecords({
      airtable,
      tableName: customerTable.name,
      formula,
    });

    for (const record of records) {
      customers.set(record.id, record.fields || {});
    }
  }

  return customers;
}

function choose(
  invoiceFields: Record<string, unknown>,
  customerFields: Record<string, unknown>,
  invoiceField: string,
  customerField: string
) {
  return (
    text(invoiceFields[invoiceField]) ||
    text(customerFields[customerField])
  );
}

function makeWorkbook(
  courier: CourierName,
  orders: Array<Record<string, string | number>>
) {
  if (courier === "TFM") {
    const headers = [
      "SHIPPERREF",
      "CONSIGNEE",
      "CONSIGNEEMOBILE",
      "CONSIGNEETELEPHONE",
      "CONSIGNEEADDRESS",
      "DESTINATIONCODE",
      "CONSIGNEEAREA",
      "CONSIGNEEBUILDING",
      "CONSIGNEESTREET",
      "PIECES",
      "TOTALWEIGHT",
      "TOTALVOLWEIGHT",
      "SERVICE",
      "COD",
      "PICKUPAMOUNT",
      "LATITUDE",
      "LONGITUDE",
      "CONTENTS",
      "REMARKS",
      "HANDLEPACK",
      "HANDLECOLD",
      "HANDLEFRAGILE",
      "DELIVERYSLOT",
      "BAssmb-LG",
      "BAssmb-Furn",
      "BI MDA (CH)",
      "BI MDA (RLD)",
      "CompA-Furn",
      "CompA-LG",
      "CompA-Sports",
      "Free MDA Instl",
      "Gas-Elec Instl",
      "Split-AC",
      "TV Mount Set Up",
      "TV Mount Set Up 65",
      "Window-AC",
      "Require Handling",
    ];

    const rows = orders.map((order) => [
      order.orderNo,
      order.customer,
      order.mobile,
      order.telephone,
      order.address,
      order.destinationCode,
      order.city,
      order.building,
      order.street,
      1,
      1,
      1,
      order.service,
      order.cod,
      "",
      "",
      "",
      "Customer is allowed to open and Check Before Delivery",
      order.note,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      order.requireHandling,
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      ...rows,
    ]);

    worksheet["!cols"] = headers.map((header) => ({
      wch: Math.max(12, Math.min(42, header.length + 2)),
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Template"
    );

    return {
      buffer: XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      }),
      extension: "xlsx",
    };
  }

  const headers = [
    "no.",
    "رقم الراسل الفرعي ",
    "رقم الشحنة",
    "الاسم",
    "رقم التليفون",
    "رقم تليفون آخر",
    "العنوان",
    "المحافظة",
    "المنطقة",
    "الاجمالى",
    "الطلب",
    "نوع التسليم",
    "ملاحظات",
    "كميه",
  ];

  const rows = orders.map((order) => [
    "",
    "",
    order.orderNo,
    `${order.customer} / ${order.sender}`,
    order.mobile,
    order.telephone || order.mobile,
    order.address,
    order.city,
    order.area,
    order.cod,
    "Clothes",
    "Delivery",
    "Delivery with Return shipment",
    1,
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows,
  ]);

  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 18 },
    { wch: 18 },
    { wch: 32 },
    { wch: 18 },
    { wch: 18 },
    { wch: 55 },
    { wch: 18 },
    { wch: 26 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 34 },
    { wch: 10 },
  ];

  worksheet["!rows"] = [
    { hpt: 24 },
    ...rows.map(() => ({ hpt: 20 })),
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Easyway");

  return {
    buffer: XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }),
    extension: "xlsx",
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
            "You do not have permission to download courier files",
        },
        { status: 403 }
      );
    }

    if (!supportsCourierDownloadBase(airtable.baseName)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Courier Download is available only for BS / TS TFM-supported orders",
        },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const requestedCourier = (
      searchParams.get("courier") || ""
    )
      .trim()
      .toUpperCase();

    if (
      requestedCourier !== "TFM" &&
      requestedCourier !== "EWE"
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Courier must be TFM or EWE",
        },
        { status: 400 }
      );
    }

    const courier = requestedCourier as CourierName;
    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );

    const configuredInvoice =
      airtable.tables?.invoice || "";

    const invoiceTable =
      schema.find(
        (table) => table.name === configuredInvoice
      ) ||
      schema.find((table) =>
        ["BS Invoice", "Invoice"].includes(table.name)
      );

    if (!invoiceTable) {
      throw new Error(
        "Courier invoice table was not found"
      );
    }

    const fields = invoiceTable.fields || [];

    const statusField = findField(fields, [
      "order_status",
      "Order Status",
      "Order_Status",
      "Order_status",
    ]);

    const courierField = findField(fields, [
      "Courier",
      "courier",
    ]);

    if (!statusField || !courierField) {
      throw new Error(
        "Order Status or Courier field was not found"
      );
    }

    const formula = `AND(${exactFormula(
      statusField,
      "Order Received"
    )},${exactFormula(courierField, courier)})`;

    const invoiceRecords = await fetchAllRecords({
      airtable,
      tableName: invoiceTable.name,
      formula,
    });

    if (invoiceRecords.length === 0) {
      return NextResponse.json(
        {
          success: false,
          empty: true,
          message: `No ${courier} orders with Order Received status`,
        },
        { status: 404 }
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
            table.id === field.options?.linkedTableId
        );

        return Boolean(
          linkedTable?.name
            .toLowerCase()
            .includes("customer")
        );
      }) ||
      fields.find(
        (field) =>
          field.type === "multipleRecordLinks" &&
          ["Customer", "Contact No.", "Contact"].includes(
            field.name
          )
      );

    const customers = await resolveCustomers({
      airtable,
      schema,
      invoiceTable,
      customerLinkField,
      invoiceRecords,
    });

    const orderNoField =
      findField(fields, [
        "Order No.",
        "Order No",
        "order_no.",
        "Order Number",
      ]) ||
      fields.find(
        (field) =>
          field.id === invoiceTable.primaryFieldId
      )?.name ||
      "";

    const invoiceCustomerField = findField(fields, [
      "Consignee",
      "Customer Name",
      "Contact Name",
      "Consignee Name",
    ]);

    const invoicePhoneField = findField(fields, [
      "Telephone1",
      "Contact No.",
      "Mobile Number",
      "Phone",
      "Mobile",
      "Consignee Mobile No 1",
    ]);

    const invoiceTelephoneField = findField(fields, [
      "Telephone2",
      "Contact No. 2",
      "Mobile Number 2",
      "Phone 2",
      "ConsigneeTel1",
    ]);

    const invoiceAddressField = findField(fields, [
      "Consignee Address 1",
      "Address",
      "Shipping Address",
      "Customer Address",
      "address_bak",
    ]);

    const invoiceCityField = findField(fields, [
      "City",
      "Emirate",
      "Destination",
      "Consignee City",
    ]);

    const invoiceAreaField = findField(fields, [
      "Area",
      "Consignee Area",
      "Location",
    ]);

    const invoiceBuildingField = findField(fields, [
      "Building",
      "Building Name",
      "Flat / Building",
      "Consignee Building",
    ]);

    const invoiceStreetField = findField(fields, [
      "Street",
      "Street Name",
      "Consignee Street",
    ]);

    const invoiceTotalField = findField(fields, [
      "total_order_value",
      "Total Order Value",
      "Order_Total",
      "Grand Total",
      "item value + shipping",
      "Total (item Cost + Shipping)",
    ]);

    const invoiceAdvanceField = findField(fields, [
      "Advance",
      "Advance Payment",
      "advance_payment",
      "Paid Amount",
      "Payment Received",
    ]);

    const invoiceStoreField = findField(fields, [
      "Select Store",
      "Store",
      "Select_Store",
    ]);

    const invoiceNoteField = findField(fields, [
      "Order Note",
      "Note",
      "Notes",
      "Remarks",
      "Special Instructions",
    ]);

    const invoiceReplacementField = findField(fields, [
      "Replacement",
      "replacement",
      "Replacement Order",
      "Is Replacement",
    ]);

    const customerTable = customerLinkField?.options
      ?.linkedTableId
      ? schema.find(
          (table) =>
            table.id ===
            customerLinkField.options?.linkedTableId
        )
      : undefined;

    const customerFields = customerTable?.fields || [];

    const customerNameField = findField(customerFields, [
      "Customer Name",
      "Name",
      "Consignee",
      "Full Name",
    ]);

    const customerPhoneField = findField(customerFields, [
      "Contact No.",
      "Contact No",
      "Phone",
      "Mobile",
      "Telephone1",
    ]);

    const customerTelephoneField = findField(
      customerFields,
      [
        "Contact No. 2",
        "Phone 2",
        "Mobile 2",
        "Telephone2",
      ]
    );

    const customerAddressField = findField(
      customerFields,
      [
        "Address",
        "Consignee Address 1",
        "Shipping Address",
        "Customer Address",
      ]
    );

    const customerCityField = findField(customerFields, [
      "City",
      "Emirate",
      "Destination",
    ]);

    const customerAreaField = findField(customerFields, [
      "Area",
      "Location",
      "Consignee Area",
    ]);

    const customerBuildingField = findField(
      customerFields,
      [
        "Building",
        "Building Name",
        "Flat / Building",
      ]
    );

    const customerStreetField = findField(
      customerFields,
      ["Street", "Street Name"]
    );

    const normalizedOrders = invoiceRecords.map(
      (record) => {
        const invoiceValues =
          (record.fields || {}) as Record<
            string,
            unknown
          >;

        const customerId = text(
          invoiceValues[customerLinkField?.name || ""]
        );

        const customerValues =
          customers.get(customerId) || {};

        const customer =
          choose(
            invoiceValues,
            customerValues,
            invoiceCustomerField,
            customerNameField
          ) || "-";

        const mobile = choose(
          invoiceValues,
          customerValues,
          invoicePhoneField,
          customerPhoneField
        );

        const telephone = choose(
          invoiceValues,
          customerValues,
          invoiceTelephoneField,
          customerTelephoneField
        );

        const address = choose(
          invoiceValues,
          customerValues,
          invoiceAddressField,
          customerAddressField
        );

        const city = choose(
          invoiceValues,
          customerValues,
          invoiceCityField,
          customerCityField
        );

        const area = choose(
          invoiceValues,
          customerValues,
          invoiceAreaField,
          customerAreaField
        );

        const building = choose(
          invoiceValues,
          customerValues,
          invoiceBuildingField,
          customerBuildingField
        );

        const street = choose(
          invoiceValues,
          customerValues,
          invoiceStreetField,
          customerStreetField
        );

        const total = amount(
          invoiceValues[invoiceTotalField]
        );

        const advance = amount(
          invoiceValues[invoiceAdvanceField]
        );

        const cod = Math.max(
          Number((total - advance).toFixed(2)),
          0
        );

        const isRts = invoiceReplacementField
          ? booleanFlag(invoiceValues[invoiceReplacementField])
          : false;

        const sender =
          text(invoiceValues[invoiceStoreField]) ||
          "Mysmar";

        return {
          orderNo:
            text(invoiceValues[orderNoField]) ||
            record.id,
          customer,
          mobile,
          telephone,
          address,
          city,
          area,
          building,
          street,
          destinationCode: destinationCode(city),
          sender,
          service: isRts
            ? "ReturnService-RTS"
            : cod > 0
              ? "COD"
              : "PrePaid",
          cod,
          note: text(invoiceValues[invoiceNoteField]),
          requireHandling: "No",
        };
      }
    );

    const { buffer, extension } = makeWorkbook(
      courier,
      normalizedOrders
    );

    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${courier}_Courier_${date}.${extension}`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          extension === "xls"
            ? "application/vnd.ms-excel"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Order-Count": String(
          normalizedOrders.length
        ),
      },
    });
  } catch (error) {
    return handleApiError(
      error,
      "Courier download failed"
    );
  }
}
