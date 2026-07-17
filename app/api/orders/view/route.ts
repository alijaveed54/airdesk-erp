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
  options?: { linkedTableId?: string };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: SchemaField[];
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

function numberValue(value: any): number {
  const parsed = Number(firstValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFieldName(fields: SchemaField[], candidates: string[]) {
  const map = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field.name])
  );

  for (const candidate of candidates) {
    const found = map.get(candidate.trim().toLowerCase());
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
      headers: { Authorization: `Bearer ${token}` },
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

async function resolveLinkedPrimaryValue({
  baseId,
  token,
  table,
  recordId,
}: {
  baseId: string;
  token: string;
  table: SchemaTable;
  recordId: string;
}) {
  if (!recordId) return "";

  const primaryField =
    table.fields.find((field) => field.id === table.primaryFieldId)?.name ||
    table.fields[0]?.name;

  if (!primaryField) return "";

  const response = await fetch(
    `${airtableUrl(baseId, table.name)}/${recordId}`,
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );

  const data = await response.json();
  if (!response.ok) return "";

  return textValue(data?.fields?.[primaryField]);
}

export async function GET(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to view orders" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const orderNo = (searchParams.get("orderNo") || "").trim();

    if (!orderNo) {
      return NextResponse.json(
        { success: false, message: "Order number is required" },
        { status: 400 }
      );
    }

    const schema = await getSchema(airtable.baseId, airtable.token);

    const normalizedBaseName = String(airtable.baseName || "")
      .trim()
      .toLowerCase();

    const isI5qDqBase =
      normalizedBaseName.includes("i5q") ||
      normalizedBaseName.includes("dq") ||
      normalizedBaseName.includes("04-10-2026");

    const orderEntryTableName = isI5qDqBase
      ? "DQ Order Entry"
      : airtable.tables.orderEntry || "BS Order Entry";

    const invoiceTableName = isI5qDqBase
      ? "DQ Invoice"
      : airtable.tables.invoice || "BS Invoice";

    const orderEntryTable = schema.find(
      (table) => table.name === orderEntryTableName
    );
    const invoiceTable = schema.find(
      (table) => table.name === invoiceTableName
    );

    if (!orderEntryTable || !invoiceTable) {
      return NextResponse.json(
        {
          success: false,
          message: `Configured order tables not found: ${orderEntryTableName} / ${invoiceTableName}`,
        },
        { status: 404 }
      );
    }

    const entryFields = orderEntryTable.fields || [];
    const invoiceFieldsSchema = invoiceTable.fields || [];

    const invoiceLinkField = entryFields.find(
      (field) =>
        field.type === "multipleRecordLinks" &&
        field.options?.linkedTableId === invoiceTable.id
    );

    if (!invoiceLinkField) {
      return NextResponse.json(
        {
          success: false,
          message: `Invoice linked field not found in ${orderEntryTableName}`,
        },
        { status: 500 }
      );
    }

    const orderNoField = getFieldName(entryFields, [
      "Order Number",
      "Order No.",
      "Order No",
      "order_no",
      "order no",
      "Invoice No.",
      "Invoice No",
    ]);
    const skuField = getFieldName(entryFields, [
      "Item Code",
      "SKU",
      "sku",
      "Product",
      "Product SKU",
    ]);
    const quantityField = getFieldName(entryFields, [
      "quantity",
      "Quantity",
      "Qty",
      "QTY",
    ]);
    const imageField = getFieldName(entryFields, [
      "image",
      "Image",
      "Product Image",
    ]);
    const supplierField = getFieldName(entryFields, [
      "Supplier",
      "Purchase Supplier",
      "Supplier Code",
    ]);
    const receivedWhField = getFieldName(entryFields, [
      "received_in_wh_1",
      "Received in WH 1",
      "Received WH 1",
      "Warehouse Received",
      "instock",
    ]);
    const billNoField = getFieldName(entryFields, [
      "bill_no",
      "Bill No",
      "Bill No.",
      "Bill Number",
    ]);
    // Never use the generic "Name" field here.
    // In FAB Doha Non Stock, "Name" is a customer lookup field,
    // not a product-name field.
    const productNameField = getFieldName(entryFields, [
      "Product Name",
      "ProductName",
      "Product Title",
      "Item Name",
      "Title",
    ]);

    const sizeField = getFieldName(entryFields, [
      "Size",
      "size",
    ]);

    const singlePriceField = getFieldName(entryFields, [
      "single price",
      "Single Price",
      "single_price",
    ]);

    const packPriceField = getFieldName(entryFields, [
      "Pack Price",
      "pack price",
      "pack_price",
    ]);

    const totalPriceField = getFieldName(entryFields, [
      "total price",
      "Total Price",
      "total_price",
    ]);

    const invoicePrimaryField =
      invoiceFieldsSchema.find(
        (field) => field.id === invoiceTable.primaryFieldId
      )?.name ||
      getFieldName(invoiceFieldsSchema, [
        "Order No.",
        "Order No",
        "Invoice No.",
        "Invoice No",
      ]);

    if (!invoicePrimaryField) {
      return NextResponse.json(
        {
          success: false,
          message: `Order number field not found in ${invoiceTableName}`,
        },
        { status: 500 }
      );
    }

    const invoiceParams = new URLSearchParams({
      pageSize: "10",
      filterByFormula: `LOWER({${invoicePrimaryField}})=LOWER('${orderNo.replace(/'/g, "\\'")}')`,
    });

    const invoiceSearchResponse = await fetch(
      airtableUrl(airtable.baseId, invoiceTableName, invoiceParams),
      {
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
      }
    );

    const invoiceSearchData = await invoiceSearchResponse.json();

    if (!invoiceSearchResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            invoiceSearchData?.error?.message ||
            invoiceSearchData?.error?.error?.message ||
            "Invoice lookup failed",
          error: invoiceSearchData,
        },
        { status: invoiceSearchResponse.status }
      );
    }

    const invoiceData = invoiceSearchData.records?.[0];

    if (!invoiceData) {
      return NextResponse.json(
        { success: false, message: `Order not found: ${orderNo}` },
        { status: 404 }
      );
    }

    const invoiceId = String(invoiceData.id || "");

    let offset = "";
    const records: any[] = [];

    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (offset) params.set("offset", offset);

      const response = await fetch(
        airtableUrl(airtable.baseId, orderEntryTableName, params),
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
              "Order items fetch failed",
            error: data,
          },
          { status: response.status }
        );
      }

      for (const record of data.records || []) {
        const linkedInvoiceId = textValue(
          record.fields?.[invoiceLinkField.name]
        );

        if (linkedInvoiceId === invoiceId) {
          records.push(record);
        }
      }

      offset = data.offset || "";
    } while (offset);

    if (records.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: `No order items found for ${orderNo}`,
        },
        { status: 404 }
      );
    }

    const invoiceFields = invoiceData.fields || {};

    const customerLinkField =
      invoiceFieldsSchema.find((field) => {
        if (
          field.type !== "multipleRecordLinks" ||
          !field.options?.linkedTableId
        ) {
          return false;
        }

        const linkedTable = schema.find(
          (table) => table.id === field.options?.linkedTableId
        );

        if (!linkedTable) return false;

        const linkedName = linkedTable.name.trim().toLowerCase();

        return (
          linkedName === "customers" ||
          linkedName === "customer" ||
          linkedName.includes("customers") ||
          linkedName.includes("customer")
        );
      }) ||
      invoiceFieldsSchema.find((field) => {
        if (
          field.type !== "multipleRecordLinks" ||
          !field.options?.linkedTableId
        ) {
          return false;
        }

        const linkedTable = schema.find(
          (table) => table.id === field.options?.linkedTableId
        );

        if (!linkedTable) return false;

        const primaryFieldName =
          linkedTable.fields.find(
            (linkedField) =>
              linkedField.id === linkedTable.primaryFieldId
          )?.name ||
          linkedTable.fields[0]?.name ||
          "";

        const normalizedPrimary = primaryFieldName.trim().toLowerCase();

        return [
          "contact",
          "contact no.",
          "contact no",
          "mobile",
          "phone",
          "customer name",
          "name",
        ].includes(normalizedPrimary);
      });

    let customerRecord: any = null;
    let customerRecordId = "";

    if (customerLinkField) {
      const rawCustomerValue = invoiceFields[customerLinkField.name];

      const customerId = Array.isArray(rawCustomerValue)
        ? String(rawCustomerValue[0] || "")
        : String(rawCustomerValue || "");

      customerRecordId = customerId;

      if (
        customerId.startsWith("rec") &&
        customerLinkField.options?.linkedTableId
      ) {
        const customerTable = schema.find(
          (table) => table.id === customerLinkField.options?.linkedTableId
        );

        if (customerTable) {
          const customerResponse = await fetch(
            `${airtableUrl(airtable.baseId, customerTable.name)}/${customerId}`,
            {
              headers: airtableHeaders(airtable.token),
              cache: "no-store",
            }
          );

          const customerData = await customerResponse.json();

          if (customerResponse.ok) {
            customerRecord = customerData;
            customerRecordId = String(customerData?.id || customerId);
          }
        }
      }
    }

    const customerFields = customerRecord?.fields || {};

    const customer = {
      name:
        textValue(customerFields["Customer Name"]) ||
        textValue(customerFields.Name) ||
        textValue(invoiceFields["Customer Name"]) ||
        textValue(invoiceFields.Customer) ||
        "",
      phone:
        textValue(customerFields["Contact No."]) ||
        textValue(customerFields["Contact No"]) ||
        textValue(customerFields.Contact) ||
        textValue(invoiceFields["Customer Mobile"]) ||
        textValue(invoiceFields["Mobile Number"]) ||
        "",
      address:
        textValue(customerFields.Address) ||
        textValue(invoiceFields["Billing Address Line 1"]) ||
        textValue(invoiceFields.Address) ||
        "",
      city:
        textValue(customerFields["City Name"]) ||
        textValue(customerFields.City) ||
        textValue(invoiceFields["Billing Address City"]) ||
        "",
      country: textValue(invoiceFields["Billing Address Country"]) || "",
    };

    const order = {
      date:
        textValue(invoiceFields.Date) ||
        textValue(invoiceFields.date) ||
        textValue(invoiceFields["Created Date"]) ||
        textValue(invoiceFields["created Date"]) ||
        "",
      store:
        textValue(invoiceFields["Select Store"]) ||
        textValue(invoiceFields.Store) ||
        "",
      status:
        textValue(invoiceFields.order_status) ||
        textValue(invoiceFields.Order_status) ||
        textValue(invoiceFields["Order Status"]) ||
        "",
      totalAmount:
        numberValue(
          invoiceFields[
            "Total Amount(Including shipping and VAT Reducing Discount)"
          ]
        ) ||
        numberValue(invoiceFields.total_order_value) ||
        numberValue(invoiceFields["Grand Total"]) ||
        numberValue(invoiceFields["item value + shipping"]) ||
        numberValue(invoiceFields["Item Value + Shipping"]) ||
        numberValue(invoiceFields["Total Order Value"]) ||
        numberValue(invoiceFields["Order Total"]) ||
        numberValue(invoiceFields["Total"]) ||
        0,
    };

    const normalizedRecords = [];

    for (const record of records) {
      const rawSkuValue = record.fields?.[skuField];
      let itemCode = textValue(rawSkuValue);

      const skuSchemaField = entryFields.find(
        (field) => field.name === skuField
      );

      if (
        itemCode.startsWith("rec") &&
        skuSchemaField?.type === "multipleRecordLinks" &&
        skuSchemaField.options?.linkedTableId
      ) {
        const productTable = schema.find(
          (table) => table.id === skuSchemaField.options?.linkedTableId
        );

        if (productTable) {
          itemCode = await resolveLinkedPrimaryValue({
            baseId: airtable.baseId,
            token: airtable.token,
            table: productTable,
            recordId: itemCode,
          });
        }
      }

      normalizedRecords.push({
        id: record.id,
        fields: {
          ...record.fields,
          "Item Code": itemCode,
          "Product Name": productNameField
            ? textValue(record.fields?.[productNameField])
            : "",
          Supplier: textValue(record.fields?.[supplierField]),
          quantity: numberValue(record.fields?.[quantityField]),
          received_in_wh_1: textValue(record.fields?.[receivedWhField]),
          bill_no: textValue(record.fields?.[billNoField]),
          image: record.fields?.[imageField] || [],
          Size: textValue(record.fields?.[sizeField]),
          "single price": numberValue(record.fields?.[singlePriceField]),
          "Pack Price": numberValue(record.fields?.[packPriceField]),
          "total price": numberValue(record.fields?.[totalPriceField]),
        },
      });
    }

    return NextResponse.json({
      success: true,
      orderNo,
      invoiceId,
      customerRecordId,
      customer: {
        ...customer,
        recordId: customerRecordId,
      },
      invoice: invoiceData,
      invoiceFields,
      order,
      records: normalizedRecords,
    });
  } catch (error) {
    console.error("View order failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "View order failed",
      },
      { status: 500 }
    );
  }
}
