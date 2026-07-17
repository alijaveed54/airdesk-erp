import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
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

type ExportOrder = {
  orderNo: string;
  address: string;
  mobile: string;
  amount: number;
  driver: string;
  status: string;
  source: "I5Q" | "DQ" | "FAB";
};

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function textValue(value: unknown): string {
  const valueToRead = firstValue(value);

  if (valueToRead === null || valueToRead === undefined) return "";

  if (typeof valueToRead === "object") {
    const objectValue = valueToRead as Record<string, unknown>;

    return String(
      objectValue.name ??
        objectValue.value ??
        objectValue.text ??
        ""
    );
  }

  return String(valueToRead);
}

function numberValue(value: unknown): number {
  const parsed = Number(firstValue(value));
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
    const fieldName = lookup.get(candidate.trim().toLowerCase());
    if (fieldName) return fieldName;
  }

  return "";
}

function safeSheetName(value: string) {
  return (
    value
      .replace(/[\\/*?:[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || "Driver"
  );
}

function isEligibleStatus(status: string) {
  const normalized = status.trim().toLowerCase();

  // User rule: Blank, Order Received, or Pending Payment.
  return (
    normalized === "" ||
    normalized === "order received" ||
    normalized === "pending payment"
  );
}

async function getSchema(baseId: string, token: string) {
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

  return (data.tables || []) as SchemaTable[];
}

async function fetchAllRecords({
  baseId,
  token,
  tableName,
}: {
  baseId: string;
  token: string;
  tableName: string;
}) {
  let offset = "";
  const records: any[] = [];

  do {
    const params = new URLSearchParams({ pageSize: "100" });

    if (offset) {
      params.set("offset", offset);
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
  } while (offset);

  return records;
}

async function loadLinkedCustomers({
  baseId,
  token,
  schema,
  invoiceTable,
  invoiceRecords,
  customerLinkField,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  invoiceTable: SchemaTable;
  invoiceRecords: any[];
  customerLinkField: SchemaField | undefined;
}) {
  const result = new Map<
    string,
    { mobile: string; address: string }
  >();

  if (!customerLinkField?.options?.linkedTableId) {
    return result;
  }

  const customerTable = schema.find(
    (table) =>
      table.id === customerLinkField.options?.linkedTableId
  );

  if (!customerTable) {
    return result;
  }

  const mobileField = findField(customerTable.fields, [
    "Contact No.",
    "Contact No",
    "Contact",
    "Mobile Number",
    "Mobile",
    "Phone",
    "Telephone1",
  ]);

  const addressField = findField(customerTable.fields, [
    "Address",
    "Customer Address",
    "Consignee Address 1",
    "Billing Address Line 1",
  ]);

  const linkedIds = Array.from(
    new Set(
      invoiceRecords
        .flatMap((record) => {
          const raw =
            record.fields?.[customerLinkField.name];

          return Array.isArray(raw)
            ? raw
            : raw
              ? [raw]
              : [];
        })
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.startsWith("rec")
        )
    )
  );

  for (let start = 0; start < linkedIds.length; start += 40) {
    const batch = linkedIds.slice(start, start + 40);

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
      airtableUrl(baseId, customerTable.name, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to load customers from ${customerTable.name}`
      );
    }

    for (const record of data.records || []) {
      result.set(record.id, {
        mobile: textValue(record.fields?.[mobileField]),
        address: textValue(record.fields?.[addressField]),
      });
    }
  }

  return result;
}

async function normalizeInvoiceTable({
  baseId,
  token,
  schema,
  invoiceTableName,
  source,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  invoiceTableName: string;
  source: ExportOrder["source"];
}) {
  const invoiceTable = schema.find(
    (table) => table.name === invoiceTableName
  );

  if (!invoiceTable) {
    return [] as ExportOrder[];
  }

  const fields = invoiceTable.fields || [];

  const orderNoField =
    findField(fields, [
      "Order No.",
      "Order No",
      "order_no.",
      "Order Number",
    ]) ||
    fields.find(
      (field) => field.id === invoiceTable.primaryFieldId
    )?.name ||
    "";

  const driverField = findField(fields, [
    "Driver Name",
    "Driver",
  ]);

  const statusField = findField(fields, [
    "order_status",
    "Order_status",
    "Order_Status",
    "Order Status",
  ]);

  const amountField = findField(fields, [
    "COD Amount",
    "Total Order Value",
    "total_order_value",
    "Order_Total",
    "item value + shipping",
    "Total (item Cost + Shipping)",
    "Grand Total",
  ]);

  const mobileField = findField(fields, [
    "Contact No.",
    "Contact No",
    "Contact",
    "Mobile Number",
    "Telephone1",
    "Phone",
    "Mobile",
  ]);

  const addressField = findField(fields, [
    "Address",
    "Address BAK",
    "Consignee Address 1",
    "Billing Address Line 1",
    "Customer Address",
  ]);

  const customerLinkField = fields.find((field) => {
    if (
      field.type !== "multipleRecordLinks" ||
      !field.options?.linkedTableId
    ) {
      return false;
    }

    const linkedTable = schema.find(
      (table) => table.id === field.options?.linkedTableId
    );

    return Boolean(
      linkedTable?.name.toLowerCase().includes("customer")
    );
  });

  if (!orderNoField || !driverField || !statusField) {
    return [] as ExportOrder[];
  }

  const records = await fetchAllRecords({
    baseId,
    token,
    tableName: invoiceTableName,
  });

  const linkedCustomers = await loadLinkedCustomers({
    baseId,
    token,
    schema,
    invoiceTable,
    invoiceRecords: records,
    customerLinkField,
  });

  return records
    .map((record): ExportOrder | null => {
      const recordFields = record.fields || {};
      const driver = textValue(recordFields[driverField]).trim();
      const status = textValue(recordFields[statusField]).trim();

      if (!driver || !isEligibleStatus(status)) {
        return null;
      }

      const customerId = textValue(
        recordFields[customerLinkField?.name || ""]
      );

      const linkedCustomer = linkedCustomers.get(customerId);

      const orderNo = textValue(
        recordFields[orderNoField]
      ).trim();

      const derivedSource: ExportOrder["source"] =
        orderNo.toUpperCase().startsWith("DQ")
          ? "DQ"
          : orderNo.toUpperCase().startsWith("I5Q")
            ? "I5Q"
            : source;

      return {
        orderNo,
        address:
          linkedCustomer?.address ||
          textValue(recordFields[addressField]) ||
          "",
        mobile:
          linkedCustomer?.mobile ||
          textValue(recordFields[mobileField]) ||
          "",
        amount: numberValue(recordFields[amountField]),
        driver,
        status,
        source: derivedSource,
      };
    })
    .filter((record): record is ExportOrder => Boolean(record));
}

function addSection({
  sheet,
  driver,
  dateText,
  source,
  orders,
  startRow,
}: {
  sheet: ExcelJS.Worksheet;
  driver: string;
  dateText: string;
  source: ExportOrder["source"];
  orders: ExportOrder[];
  startRow: number;
}) {
  const titleRow = startRow;

  sheet.getCell(titleRow, 2).value = "Order No";
  sheet.getCell(titleRow, 3).value =
    `${driver} ${source}-${dateText}`;
  sheet.getCell(titleRow, 4).value = "Mob No";
  sheet.getCell(titleRow, 5).value = "Amt";

  for (let column = 1; column <= 5; column += 1) {
    const cell = sheet.getCell(titleRow, column);
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  }

  let row = titleRow + 1;

  orders.forEach((order, index) => {
    sheet.getCell(row, 1).value = index + 1;
    sheet.getCell(row, 2).value = order.orderNo;
    sheet.getCell(row, 3).value = order.address;
    sheet.getCell(row, 4).value = order.mobile;
    sheet.getCell(row, 5).value = order.amount;
    sheet.getCell(row, 5).numFmt = "0.00";

    for (let column = 1; column <= 5; column += 1) {
      sheet.getCell(row, column).border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }

    row += 1;
  });

  sheet.getCell(row, 4).value = "TOTAL";
  sheet.getCell(row, 4).font = { bold: true };
  sheet.getCell(row, 5).value = {
    formula:
      orders.length > 0
        ? `SUM(E${titleRow + 1}:E${row - 1})`
        : "0",
  };
  sheet.getCell(row, 5).font = { bold: true };
  sheet.getCell(row, 5).numFmt = "0.00";

  return row + 2;
}

export async function GET() {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to download driver sheet",
        },
        { status: 403 }
      );
    }

    const normalizedBaseName = String(
      airtable.baseName || ""
    ).toLowerCase();

    const isSupportedBase =
      normalizedBaseName.includes("fab") ||
      normalizedBaseName.includes("doha") ||
      normalizedBaseName.includes("i5q") ||
      normalizedBaseName.includes("dq");

    if (!isSupportedBase) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Driver sheet is available only for FAB Doha and i5Q/DQ bases",
        },
        { status: 400 }
      );
    }

    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );

    let allOrders: ExportOrder[] = [];

    const hasI5qDq =
      schema.some((table) => table.name === "DQ Invoice") &&
      schema.some((table) => table.name === "i5Q Invoice");

    if (hasI5qDq) {
      const dqOrders = await normalizeInvoiceTable({
        baseId: airtable.baseId,
        token: airtable.token,
        schema,
        invoiceTableName: "DQ Invoice",
        source: "DQ",
      });

      const i5qOrders = await normalizeInvoiceTable({
        baseId: airtable.baseId,
        token: airtable.token,
        schema,
        invoiceTableName: "i5Q Invoice",
        source: "I5Q",
      });

      allOrders = [...dqOrders, ...i5qOrders];
    } else {
      const invoiceTableName =
        airtable.tables?.invoice || "FAB Invoice";

      allOrders = await normalizeInvoiceTable({
        baseId: airtable.baseId,
        token: airtable.token,
        schema,
        invoiceTableName,
        source: "FAB",
      });
    }

    if (allOrders.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "No eligible orders found. Driver must not be empty and status must be Blank, Order Received, or Pending Payment.",
        },
        { status: 404 }
      );
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Mysmar ERP";
    workbook.created = new Date();

    const byDriver = new Map<string, ExportOrder[]>();

    for (const order of allOrders) {
      if (!byDriver.has(order.driver)) {
        byDriver.set(order.driver, []);
      }

      byDriver.get(order.driver)?.push(order);
    }

    const today = new Date();
    const dateText = today.toLocaleDateString("en-GB");
    const fileDate = today.toISOString().slice(0, 10);

    for (const [driver, driverOrders] of byDriver.entries()) {
      const sheet = workbook.addWorksheet(
        safeSheetName(driver),
        {
          pageSetup: {
            paperSize: 9,
            orientation: "portrait",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
          },
        }
      );

      sheet.columns = [
        { key: "no", width: 7 },
        { key: "orderNo", width: 18 },
        { key: "address", width: 48 },
        { key: "mobile", width: 18 },
        { key: "amount", width: 14 },
        { key: "blank1", width: 3 },
        { key: "blank2", width: 3 },
        { key: "blank3", width: 3 },
        { key: "blank4", width: 3 },
        { key: "blank5", width: 3 },
        { key: "summaryLabel", width: 14 },
        { key: "summaryCount", width: 10 },
        { key: "summaryAmount", width: 14 },
      ];

      sheet.views = [
        {
          state: "frozen",
          ySplit: 1,
        },
      ];

      let nextRow = 1;
      const sourceOrder: ExportOrder["source"][] = [
        "I5Q",
        "FAB",
        "DQ",
      ];

      for (const source of sourceOrder) {
        const sourceOrders = driverOrders
          .filter((order) => order.source === source)
          .sort((a, b) =>
            a.orderNo.localeCompare(b.orderNo, undefined, {
              numeric: true,
            })
          );

        if (sourceOrders.length === 0) continue;

        nextRow = addSection({
          sheet,
          driver,
          dateText,
          source,
          orders: sourceOrders,
          startRow: nextRow,
        });
      }

      const summaryStart = 2;

      sheet.getCell(summaryStart, 11).value = driver;
      sheet.getCell(summaryStart, 11).font = {
        bold: true,
        size: 13,
      };

      let summaryRow = summaryStart + 1;

      for (const source of sourceOrder) {
        const sourceOrders = driverOrders.filter(
          (order) => order.source === source
        );

        sheet.getCell(summaryRow, 11).value = source;
        sheet.getCell(summaryRow, 12).value =
          sourceOrders.length;
        sheet.getCell(summaryRow, 13).value =
          sourceOrders.reduce(
            (sum, order) => sum + order.amount,
            0
          );
        sheet.getCell(summaryRow, 13).numFmt = "0.00";
        summaryRow += 1;
      }

      sheet.getCell(summaryRow, 11).value = "TOTAL";
      sheet.getCell(summaryRow, 12).value = {
        formula: `SUM(L${summaryStart + 1}:L${summaryRow - 1})`,
      };
      sheet.getCell(summaryRow, 13).value = {
        formula: `SUM(M${summaryStart + 1}:M${summaryRow - 1})`,
      };

      for (
        let row = summaryStart;
        row <= summaryRow;
        row += 1
      ) {
        for (let column = 11; column <= 13; column += 1) {
          const cell = sheet.getCell(row, column);
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };

          if (row === summaryStart || row === summaryRow) {
            cell.font = { bold: true };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFE2E8F0" },
            };
          }
        }
      }

      sheet.getColumn(3).alignment = {
        wrapText: true,
        vertical: "top",
      };
      sheet.getColumn(4).numFmt = "@";
      sheet.getColumn(5).numFmt = "0.00";
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Driver_Sheets_${fileDate}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Driver sheet export failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Driver sheet export failed",
      },
      { status: 500 }
    );
  }
}
