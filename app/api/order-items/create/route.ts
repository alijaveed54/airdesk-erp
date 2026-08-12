import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import {
  syncInvoiceInstockStatuses,
} from "@/lib/order-instock-sync";

type Field = {
  id: string;
  name: string;
  type: string;
  options?: {
    linkedTableId?: string;
  };
};

type Table = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: Field[];
};

const READ_ONLY = new Set([
  "formula",
  "rollup",
  "multipleLookupValues",
  "count",
  "createdTime",
  "lastModifiedTime",
  "createdBy",
  "lastModifiedBy",
  "autoNumber",
  "button",
]);

function pickWritableField(
  fields: Field[],
  candidates: string[]
) {
  const map = new Map(
    fields.map((field) => [
      field.name.trim().toLowerCase(),
      field,
    ])
  );

  for (const candidate of candidates) {
    const field = map.get(candidate.trim().toLowerCase());

    if (field && !READ_ONLY.has(field.type)) {
      return field;
    }
  }

  return undefined;
}

function escapeFormulaValue(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

async function recordExists({
  baseId,
  token,
  tableName,
  recordId,
}: {
  baseId: string;
  token: string;
  tableName: string;
  recordId: string;
}) {
  if (!recordId.startsWith("rec")) return false;

  const response = await fetch(
    `${airtableUrl(baseId, tableName)}/${recordId}`,
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );

  return response.ok;
}

async function resolveProductRecordId({
  baseId,
  token,
  productTable,
  productId,
  sku,
}: {
  baseId: string;
  token: string;
  productTable: Table;
  productId: string;
  sku: string;
}) {
  if (
    productId &&
    (await recordExists({
      baseId,
      token,
      tableName: productTable.name,
      recordId: productId,
    }))
  ) {
    return productId;
  }

  const primaryField =
    productTable.fields.find(
      (field) => field.id === productTable.primaryFieldId
    )?.name ||
    productTable.fields[0]?.name ||
    "";

  if (!primaryField || !sku) return "";

  const params = new URLSearchParams({
    pageSize: "1",
    filterByFormula: `LOWER({${primaryField}} & '')=LOWER('${escapeFormulaValue(
      sku
    )}')`,
  });

  const response = await fetch(
    airtableUrl(baseId, productTable.name, params),
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        `Product lookup failed for ${sku}`
    );
  }

  return String(data.records?.[0]?.id || "");
}

export async function POST(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message: "No permission",
        },
        { status: 403 }
      );
    }

    const body = await req.json();
    const invoiceId = String(body.invoiceId || "").trim();
    const orderNo = String(body.orderNo || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!invoiceId) {
      return NextResponse.json(
        {
          success: false,
          message: "Invoice record ID is required",
        },
        { status: 400 }
      );
    }

    if (items.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Items are required",
        },
        { status: 400 }
      );
    }

    const metaResponse = await fetch(
      `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(
        airtable.baseId
      )}/tables`,
      {
        headers: {
          Authorization: `Bearer ${airtable.token}`,
        },
        cache: "no-store",
      }
    );

    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      throw new Error(
        metaData?.error?.message ||
          "Unable to load Airtable schema"
      );
    }

    const tables = (metaData.tables || []) as Table[];

    const normalizedBaseName = String(
      airtable.baseName || ""
    )
      .trim()
      .toLowerCase();

    const isI5qDqBase =
      normalizedBaseName.includes("i5q") ||
      normalizedBaseName.includes("dq") ||
      normalizedBaseName.includes("04-10-2026") ||
      (
        tables.some((table) => table.name === "DQ Invoice") &&
        tables.some((table) => table.name === "i5Q Invoice")
      );

    const invoiceTableName = isI5qDqBase
      ? "DQ Invoice"
      : airtable.tables.invoice || "BS Invoice";

    const orderEntryTableName = isI5qDqBase
      ? "DQ Order Entry"
      : airtable.tables.orderEntry || "BS Order Entry";

    const invoiceTable = tables.find(
      (table) => table.name === invoiceTableName
    );

    const orderEntryTable = tables.find(
      (table) => table.name === orderEntryTableName
    );

    if (!invoiceTable) {
      throw new Error(
        `Invoice table not found: ${invoiceTableName}`
      );
    }

    if (!orderEntryTable) {
      throw new Error(
        `Order Entry table not found: ${orderEntryTableName}`
      );
    }

    const invoiceLink = orderEntryTable.fields.find(
      (field) =>
        field.type === "multipleRecordLinks" &&
        field.options?.linkedTableId === invoiceTable.id
    );

    const skuLink =
      orderEntryTable.fields.find(
        (field) =>
          field.type === "multipleRecordLinks" &&
          field.options?.linkedTableId !== invoiceTable.id &&
          ["sku", "product", "item code"].includes(
            field.name.trim().toLowerCase()
          )
      ) ||
      orderEntryTable.fields.find(
        (field) =>
          field.type === "multipleRecordLinks" &&
          field.options?.linkedTableId !== invoiceTable.id
      );

    const quantityField = pickWritableField(
      orderEntryTable.fields,
      ["quantity", "Quantity", "Qty", "QTY"]
    );

    const supplierField = pickWritableField(
      orderEntryTable.fields,
      ["Supplier", "Purchase Supplier"]
    );

    const warehouseField = pickWritableField(
      orderEntryTable.fields,
      [
        "received_in_wh_1",
        "Received in WH 1",
        "Received In WH 1",
        "Received WH 1",
        "Warehouse Received",
      ]
    );

    const receivedInUaeField = pickWritableField(
      orderEntryTable.fields,
      [
        "Received In UAE",
        "Received in UAE",
        "received_in_uae",
      ]
    );

    const sizeField = pickWritableField(
      orderEntryTable.fields,
      ["Size", "size"]
    );

    const singlePriceField = pickWritableField(
      orderEntryTable.fields,
      ["single price", "Single Price", "single_price"]
    );

    const packPriceField = pickWritableField(
      orderEntryTable.fields,
      ["Pack Price", "pack price", "pack_price"]
    );

    if (!invoiceLink || !skuLink || !quantityField) {
      return NextResponse.json(
        {
          success: false,
          message:
            `Required linked fields not found in ${orderEntryTableName}`,
        },
        { status: 400 }
      );
    }

    const productTable = tables.find(
      (table) =>
        table.id === skuLink.options?.linkedTableId
    );

    if (!productTable) {
      return NextResponse.json(
        {
          success: false,
          message:
            `Product table linked to ${skuLink.name} was not found`,
        },
        { status: 400 }
      );
    }

    const records = [];

    for (const item of items) {
      const skuText = String(
        item.sku ||
          item.itemCode ||
          item.productName ||
          ""
      ).trim();

      const productRecordId =
        await resolveProductRecordId({
          baseId: airtable.baseId,
          token: airtable.token,
          productTable,
          productId: String(item.productId || ""),
          sku: skuText,
        });

      if (!productRecordId) {
        return NextResponse.json(
          {
            success: false,
            message:
              `Product record not found in ${productTable.name}: ${skuText || item.productId}`,
          },
          { status: 404 }
        );
      }

      const fields: Record<string, any> = {
        [invoiceLink.name]: [invoiceId],
        [skuLink.name]: [productRecordId],
        [quantityField.name]: Number(
          item.qty ?? item.quantity ?? 1
        ),
      };

      if (
        supplierField &&
        item.purchaseSupplier &&
        !item.warehouse
      ) {
        fields[supplierField.name] =
          item.purchaseSupplier;
      }

      if (item.warehouse) {
        if (warehouseField) {
          fields[warehouseField.name] = "Yes";
        }

        if (receivedInUaeField) {
          fields[receivedInUaeField.name] = "Yes";
        }
      }

      if (
        sizeField &&
        item.size !== undefined
      ) {
        fields[sizeField.name] =
          String(item.size || "").trim();
      }

      if (singlePriceField) {
        const value =
          item.singlePrice ?? item.price;

        if (value !== undefined) {
          fields[singlePriceField.name] =
            Number(value) || 0;
        }
      }

      if (
        packPriceField &&
        item.packPrice !== undefined
      ) {
        fields[packPriceField.name] =
          Number(item.packPrice) || 0;
      }

      records.push({ fields });
    }

    console.log("========== ORDER ITEMS CREATE ==========");
    console.log("Base:", airtable.baseName);
    console.log("Invoice Table:", invoiceTableName);
    console.log("Order Entry Table:", orderEntryTableName);
    console.log("Product Table:", productTable.name);
    console.log("Invoice ID:", invoiceId);
    console.log("Records:", records);

    const response = await fetch(
      airtableUrl(
        airtable.baseId,
        orderEntryTableName
      ),
      {
        method: "POST",
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
        body: JSON.stringify({
          records,
          typecast: false,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log(
        "Order Items Create Error:",
        data
      );

      return NextResponse.json(
        {
          success: false,
          message:
            data?.error?.message ||
            data?.error?.error?.message ||
            "Order items create failed",
          error: data,
          invoiceTable: invoiceTableName,
          orderEntryTable: orderEntryTableName,
          productTable: productTable.name,
        },
        { status: response.status }
      );
    }

    let instockSync: unknown = null;

    try {
      instockSync = await syncInvoiceInstockStatuses({
        baseId: airtable.baseId,
        token: airtable.token,
        orderEntryTableName,
        invoiceTableName,
        invoiceIds: [invoiceId],
      });
    } catch (syncError) {
      console.error("Invoice Instock sync after item create failed:", syncError);
      instockSync = {
        success: false,
        message:
          syncError instanceof Error
            ? syncError.message
            : "Invoice Instock sync failed",
      };
    }

    return NextResponse.json({
      success: true,
      records: data.records || [],
      invoiceTable: invoiceTableName,
      orderEntryTable: orderEntryTableName,
      productTable: productTable.name,
      instockSync,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown Error",
      },
      { status: 500 }
    );
  }
}
