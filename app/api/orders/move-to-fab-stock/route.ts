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
  type: string;
  options?: { linkedTableId?: string };
};

type SchemaTable = {
  id: string;
  name: string;
  fields: SchemaField[];
};

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type TransferItem = {
  sku: string;
  quantity: number;
  sourceProductRecordId?: string;
};

const FAB_STOCK_BASE_ID = "appEKsWCVMfGBFQ3L";

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function text(value: unknown) {
  const resolved = first(value);

  if (resolved === null || resolved === undefined) return "";

  if (typeof resolved === "object") {
    const objectValue = resolved as Record<string, unknown>;
    return normalize(
      objectValue.name ?? objectValue.value ?? objectValue.text ?? "",
    );
  }

  return normalize(resolved);
}

function numeric(value: unknown) {
  const parsed = Number(first(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function truthy(value: unknown) {
  if (value === true || value === 1) return true;

  const normalized = normalize(first(value)).toLowerCase();
  return ["true", "yes", "1", "moved", "transferred", "completed"].includes(
    normalized,
  );
}

function findField(fields: SchemaField[], candidates: string[]) {
  const lookup = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field.name]),
  );

  for (const candidate of candidates) {
    const found = lookup.get(candidate.trim().toLowerCase());
    if (found) return found;
  }

  return "";
}

function findTable(tables: SchemaTable[], candidates: string[]) {
  const lookup = new Map(
    tables.map((table) => [table.name.trim().toLowerCase(), table]),
  );

  for (const candidate of candidates) {
    const found = lookup.get(candidate.trim().toLowerCase());
    if (found) return found;
  }

  return undefined;
}

function escapeFormula(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isWritableField(field: SchemaField) {
  return ![
    "formula",
    "rollup",
    "count",
    "lookup",
    "multipleLookupValues",
    "createdTime",
    "lastModifiedTime",
    "autoNumber",
    "button",
  ].includes(field.type);
}

function normalizeFieldKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function attachmentValue(value: unknown) {
  if (!Array.isArray(value)) return value;

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const attachment = item as Record<string, unknown>;
      const url = normalize(attachment.url);
      if (!url) return null;

      const filename = normalize(attachment.filename);
      return filename ? { url, filename } : { url };
    })
    .filter(Boolean);
}

function compatibleValue(field: SchemaField, value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;

  if (field.type === "multipleAttachments") return attachmentValue(value);
  if (field.type === "multipleRecordLinks") return undefined;

  return value;
}

function isoDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function resolveTargetToken(sourceToken: string) {
  return (
    process.env.FAB_STOCK_AIRTABLE_TOKEN ||
    process.env.AIRTABLE_FAB_STOCK_TOKEN ||
    process.env.AIRTABLE_TOKEN ||
    sourceToken
  ).trim();
}

async function getSchema(
  baseId: string,
  token: string,
): Promise<SchemaTable[]> {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to load Airtable schema");
  }

  return data.tables || [];
}

async function fetchRecord(
  baseId: string,
  token: string,
  tableName: string,
  recordId: string,
): Promise<AirtableRecord> {
  const response = await fetch(
    `${airtableUrl(baseId, tableName)}/${encodeURIComponent(recordId)}`,
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Unable to read ${tableName} record`,
    );
  }

  return data;
}

async function fetchAllRecords(
  baseId: string,
  token: string,
  tableName: string,
  formula = "",
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (formula) params.set("filterByFormula", formula);
    if (offset) params.set("offset", offset);

    const response = await fetch(airtableUrl(baseId, tableName, params), {
      headers: airtableHeaders(token),
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Unable to read records from ${tableName}`,
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

async function createRecords(
  baseId: string,
  token: string,
  tableName: string,
  records: Array<{ fields: Record<string, unknown> }>,
) {
  for (let index = 0; index < records.length; index += 10) {
    const batch = records.slice(index, index + 10);

    const response = await fetch(airtableUrl(baseId, tableName), {
      method: "POST",
      headers: airtableHeaders(token),
      cache: "no-store",
      body: JSON.stringify({ records: batch, typecast: true }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Unable to create records in ${tableName}`,
      );
    }
  }
}

async function createSingleRecord(
  baseId: string,
  token: string,
  tableName: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const response = await fetch(airtableUrl(baseId, tableName), {
    method: "POST",
    headers: airtableHeaders(token),
    cache: "no-store",
    body: JSON.stringify({ fields, typecast: true }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Unable to create record in ${tableName}`,
    );
  }

  return data;
}

async function updateRecord(
  baseId: string,
  token: string,
  tableName: string,
  recordId: string,
  fields: Record<string, unknown>,
) {
  const response = await fetch(
    `${airtableUrl(baseId, tableName)}/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      headers: airtableHeaders(token),
      cache: "no-store",
      body: JSON.stringify({ fields, typecast: true }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `Unable to update ${tableName}`);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session || (session.role !== "Admin" && !session.superAdmin)) {
      return NextResponse.json(
        {
          success: false,
          message: "Only Admin can move orders to FAB Stock",
        },
        { status: 403 },
      );
    }

    const source = await getCurrentAirtableBase();
    const sourceBaseName = normalize(source.baseName).toLowerCase();
    const isFabNonStock =
      (sourceBaseName.includes("fab") || sourceBaseName.includes("doha")) &&
      (sourceBaseName.includes("non stock") ||
        sourceBaseName.includes("non-stock") ||
        sourceBaseName.includes("without stock"));

    if (!isFabNonStock) {
      return NextResponse.json(
        {
          success: false,
          message: "This action is only available in FAB Doha Non Stock base",
        },
        { status: 400 },
      );
    }

    const body = await request.json();
    const orderId = normalize(body.orderId);
    const orderNo = normalize(body.orderNo);
    const requestedSourceTable = normalize(body.sourceTable);

    if (!orderId || !orderNo) {
      return NextResponse.json(
        {
          success: false,
          message: "Order ID and Order No are required",
        },
        { status: 400 },
      );
    }

    const targetBaseId = (
      process.env.FAB_STOCK_AIRTABLE_BASE_ID || FAB_STOCK_BASE_ID
    ).trim();
    const targetToken = resolveTargetToken(source.token);

    const [sourceSchema, targetSchema] = await Promise.all([
      getSchema(source.baseId, source.token),
      getSchema(targetBaseId, targetToken),
    ]);

    const invoiceTable =
      (requestedSourceTable
        ? sourceSchema.find(
            (table) =>
              table.name.trim().toLowerCase() ===
              requestedSourceTable.toLowerCase(),
          )
        : undefined) ||
      sourceSchema.find((table) => table.name === source.tables?.invoice) ||
      findTable(sourceSchema, ["FAB Invoice", "Invoice"]);

    if (!invoiceTable) {
      throw new Error("FAB Non Stock invoice table not found");
    }

    const orderEntryTable =
      findTable(sourceSchema, ["FAB Order Entry", "Order Entry"]) ||
      sourceSchema.find((table) =>
        table.name.toLowerCase().includes("order entry"),
      );

    if (!orderEntryTable) {
      throw new Error("FAB Non Stock order-entry table not found");
    }

    const productTable = findTable(targetSchema, ["Product", "Products"]);
    const stockReceivedTable = findTable(targetSchema, ["Stock Received"]);

    if (!productTable) {
      throw new Error("Product table not found in FAB Stock base");
    }

    if (!stockReceivedTable) {
      throw new Error("Stock Received table not found in FAB Stock base");
    }

    const invoiceRecord = await fetchRecord(
      source.baseId,
      source.token,
      invoiceTable.name,
      orderId,
    );

    const invoiceOrderNoField = findField(invoiceTable.fields, [
      "Order No.",
      "Order No",
      "Order Number",
      "Invoice No.",
      "Invoice No",
    ]);

    if (invoiceOrderNoField) {
      const savedOrderNo = text(invoiceRecord.fields?.[invoiceOrderNoField]);

      if (
        savedOrderNo &&
        savedOrderNo.toLowerCase() !== orderNo.toLowerCase()
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "Order ID and Order No do not match",
          },
          { status: 400 },
        );
      }
    }

    const movedField = findField(invoiceTable.fields, [
      "Moved To FAB Stock",
      "Moved to FAB Stock",
      "Moved To Stock",
      "Moved to Stock",
      "Added To FAB Stock",
      "Transferred To FAB Stock",
      "Transferred to FAB Stock",
    ]);
    const movedDateField = findField(invoiceTable.fields, [
      "Moved To FAB Stock Date",
      "Moved to FAB Stock Date",
      "Moved Date",
      "Moved To Stock Date",
      "Stock Transfer Date",
      "Transfer Date",
    ]);

    if (movedField && truthy(invoiceRecord.fields?.[movedField])) {
      return NextResponse.json(
        {
          success: false,
          message: `${orderNo} has already been moved to FAB Stock`,
        },
        { status: 409 },
      );
    }

    const orderLinkField =
      orderEntryTable.fields.find(
        (field) =>
          field.type === "multipleRecordLinks" &&
          field.options?.linkedTableId === invoiceTable.id,
      )?.name ||
      findField(orderEntryTable.fields, [
        "Order No.",
        "Order No",
        "Invoice",
        "Order",
      ]);

    const sourceSkuSchemaField =
      orderEntryTable.fields.find(
        (field) =>
          field.type === "multipleRecordLinks" &&
          ["sku", "product", "products", "product sku"].includes(
            field.name.trim().toLowerCase(),
          ),
      ) ||
      orderEntryTable.fields.find((field) =>
        ["sku", "item code", "product sku", "supplier sku"].includes(
          field.name.trim().toLowerCase(),
        ),
      );
    const sourceSkuField = sourceSkuSchemaField?.name || "";
    const sourceQtyField = findField(orderEntryTable.fields, [
      "quantity",
      "Quantity",
      "Qty",
      "Qt",
    ]);

    if (!orderLinkField || !sourceSkuField || !sourceQtyField) {
      throw new Error(
        "Order link, SKU or quantity field not found in FAB Order Entry",
      );
    }

    const escapedOrderNo = escapeFormula(orderNo);
    const itemFormula = `LOWER(ARRAYJOIN({${orderLinkField}}&''))=LOWER('${escapedOrderNo}')`;
    let itemRecords = await fetchAllRecords(
      source.baseId,
      source.token,
      orderEntryTable.name,
      itemFormula,
    );

    if (itemRecords.length === 0) {
      itemRecords = await fetchAllRecords(
        source.baseId,
        source.token,
        orderEntryTable.name,
        `FIND(LOWER('${escapedOrderNo}'),LOWER(ARRAYJOIN({${orderLinkField}}&'')))>0`,
      );
    }

    if (itemRecords.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: `No items found for ${orderNo}`,
        },
        { status: 404 },
      );
    }

    const groupedItems = new Map<string, TransferItem>();
    const sourceLinkedProductTable = sourceSkuSchemaField?.options
      ?.linkedTableId
      ? sourceSchema.find(
          (table) => table.id === sourceSkuSchemaField.options?.linkedTableId,
        )
      : undefined;
    const sourceLinkedProductSkuField = sourceLinkedProductTable
      ? findField(sourceLinkedProductTable.fields, [
          "SKU",
          "Sku",
          "Product SKU",
          "Item Code",
        ])
      : "";
    const resolvedSourceSkuCache = new Map<string, string>();
    const sourceProductRecordCache = new Map<string, AirtableRecord>();

    for (const record of itemRecords) {
      const rawSkuValue = record.fields?.[sourceSkuField];
      const quantity = numeric(record.fields?.[sourceQtyField]);
      let sku = "";

      if (
        sourceSkuSchemaField?.type === "multipleRecordLinks" &&
        sourceLinkedProductTable &&
        sourceLinkedProductSkuField
      ) {
        const linkedRecordIds = Array.isArray(rawSkuValue)
          ? rawSkuValue.map(normalize).filter(Boolean)
          : [normalize(rawSkuValue)].filter(Boolean);

        if (linkedRecordIds.length > 0) {
          const linkedRecordId = linkedRecordIds[0];
          sku = resolvedSourceSkuCache.get(linkedRecordId) || "";

          if (sku && !sourceProductRecordCache.has(linkedRecordId)) {
            const linkedProductRecord = await fetchRecord(
              source.baseId,
              source.token,
              sourceLinkedProductTable.name,
              linkedRecordId,
            );
            sourceProductRecordCache.set(linkedRecordId, linkedProductRecord);
          }

          if (!sku) {
            const linkedProductRecord = await fetchRecord(
              source.baseId,
              source.token,
              sourceLinkedProductTable.name,
              linkedRecordId,
            );
            sourceProductRecordCache.set(linkedRecordId, linkedProductRecord);
            sku = text(
              linkedProductRecord.fields?.[sourceLinkedProductSkuField],
            );

            if (sku) resolvedSourceSkuCache.set(linkedRecordId, sku);
          }
        }
      } else {
        sku = text(rawSkuValue);
      }

      if (!sku || quantity <= 0) continue;

      const key = sku.toLowerCase();
      const existing = groupedItems.get(key);

      const linkedRecordId =
        sourceSkuSchemaField?.type === "multipleRecordLinks"
          ? normalize(first(rawSkuValue))
          : "";

      groupedItems.set(key, {
        sku,
        quantity: (existing?.quantity || 0) + quantity,
        sourceProductRecordId:
          existing?.sourceProductRecordId || linkedRecordId || undefined,
      });
    }

    if (groupedItems.size === 0) {
      throw new Error("No valid SKU and quantity found in this order");
    }

    const productSkuField = findField(productTable.fields, [
      "SKU",
      "Sku",
      "Product SKU",
      "Item Code",
    ]);
    const stockProductLinkField =
      stockReceivedTable.fields.find(
        (field) =>
          field.type === "multipleRecordLinks" &&
          field.options?.linkedTableId === productTable.id,
      )?.name ||
      findField(stockReceivedTable.fields, [
        "SKU-",
        "Product",
        "Products",
        "SKU",
        "Item",
      ]);
    const stockQuantityField = findField(stockReceivedTable.fields, [
      "Stock +",
      "Quantity",
      "Qty",
      "Stock Received",
      "Received Quantity",
      "Received Qty",
    ]);
    const stockDateField = findField(stockReceivedTable.fields, [
      "Date",
      "Received Date",
      "Stock Received Date",
      "Entry Date",
    ]);
    const stockOrderNoField = findField(stockReceivedTable.fields, [
      "Order Number",
      "Order No.",
      "Order No",
      "Source Order No.",
      "Source Order No",
      "Transferred From Order",
      "Reference",
    ]);
    const stockNotesField = findField(stockReceivedTable.fields, [
      "Notes",
      "Note",
      "Remarks",
      "Description",
    ]);

    if (!productSkuField) {
      throw new Error("SKU field not found in FAB Stock Product table");
    }

    if (!stockProductLinkField || !stockQuantityField) {
      throw new Error(
        "Product link or Stock + field not found in Stock Received",
      );
    }

    if (stockOrderNoField) {
      const previousTransfers = await fetchAllRecords(
        targetBaseId,
        targetToken,
        stockReceivedTable.name,
        `LOWER({${stockOrderNoField}}&'')=LOWER('${escapedOrderNo}')`,
      );

      if (previousTransfers.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: `${orderNo} has already been moved to FAB Stock`,
          },
          { status: 409 },
        );
      }
    }

    const productRecords = new Map<string, AirtableRecord>();
    const createdProducts: string[] = [];

    const targetProductFieldByKey = new Map(
      productTable.fields
        .filter(isWritableField)
        .map((field) => [normalizeFieldKey(field.name), field]),
    );

    for (const item of groupedItems.values()) {
      const matches = await fetchAllRecords(
        targetBaseId,
        targetToken,
        productTable.name,
        `LOWER({${productSkuField}}&'')=LOWER('${escapeFormula(item.sku)}')`,
      );

      if (matches.length > 0) {
        productRecords.set(item.sku.toLowerCase(), matches[0]);
        continue;
      }

      if (!sourceLinkedProductTable || !item.sourceProductRecordId) {
        throw new Error(
          `Source Product record not available for missing FAB Stock product: ${item.sku}`,
        );
      }

      let sourceProduct = sourceProductRecordCache.get(
        item.sourceProductRecordId,
      );

      if (!sourceProduct) {
        sourceProduct = await fetchRecord(
          source.baseId,
          source.token,
          sourceLinkedProductTable.name,
          item.sourceProductRecordId,
        );
        sourceProductRecordCache.set(item.sourceProductRecordId, sourceProduct);
      }

      const newProductFields: Record<string, unknown> = {
        [productSkuField]: item.sku,
      };

      for (const sourceField of sourceLinkedProductTable.fields) {
        if (!isWritableField(sourceField)) continue;

        const targetField = targetProductFieldByKey.get(
          normalizeFieldKey(sourceField.name),
        );
        if (!targetField || targetField.name === productSkuField) continue;

        const value = compatibleValue(
          targetField,
          sourceProduct.fields?.[sourceField.name],
        );

        if (value !== undefined) {
          newProductFields[targetField.name] = value;
        }
      }

      const copyAliases: Array<{ target: string[]; source: string[] }> = [
        {
          target: ["Image", "Images", "Product Image", "Photo"],
          source: ["Image", "Images", "Product Image", "Photo"],
        },
        {
          target: ["Doha Price", "Price", "Selling Price"],
          source: ["Doha Price", "Price", "Selling Price", "price"],
        },
        {
          target: ["Name", "Product Name", "Item Name"],
          source: ["Name", "Product Name", "Item Name"],
        },
        {
          target: ["Status"],
          source: ["Status"],
        },
        {
          target: ["Color", "Colour"],
          source: ["Color", "Colour"],
        },
        {
          target: ["Size"],
          source: ["Size"],
        },
      ];

      for (const alias of copyAliases) {
        const targetName = findField(productTable.fields, alias.target);
        const sourceName = findField(
          sourceLinkedProductTable.fields,
          alias.source,
        );

        if (
          !targetName ||
          !sourceName ||
          newProductFields[targetName] !== undefined
        ) {
          continue;
        }

        const targetField = productTable.fields.find(
          (field) => field.name === targetName,
        );
        if (!targetField || !isWritableField(targetField)) continue;

        const value = compatibleValue(
          targetField,
          sourceProduct.fields?.[sourceName],
        );

        if (value !== undefined) newProductFields[targetName] = value;
      }

      const createdProduct = await createSingleRecord(
        targetBaseId,
        targetToken,
        productTable.name,
        newProductFields,
      );

      productRecords.set(item.sku.toLowerCase(), createdProduct);
      createdProducts.push(item.sku);
    }

    const transferDate = isoDateOnly();
    const stockReceivedRecords = Array.from(groupedItems.values()).map(
      (item) => {
        const product = productRecords.get(item.sku.toLowerCase());

        if (!product) {
          throw new Error(`Product lookup failed for ${item.sku}`);
        }

        const fields: Record<string, unknown> = {
          [stockProductLinkField]: [product.id],
          [stockQuantityField]: item.quantity,
        };

        if (stockOrderNoField) fields[stockOrderNoField] = orderNo;

        if (stockDateField) fields[stockDateField] = transferDate;
        if (stockNotesField) {
          fields[stockNotesField] =
            `Transferred from FAB Doha Non Stock order ${orderNo}`;
        }

        return { fields };
      },
    );

    await createRecords(
      targetBaseId,
      targetToken,
      stockReceivedTable.name,
      stockReceivedRecords,
    );

    const invoiceUpdateFields: Record<string, unknown> = {};

    if (movedField) invoiceUpdateFields[movedField] = true;
    if (movedDateField) invoiceUpdateFields[movedDateField] = transferDate;

    if (Object.keys(invoiceUpdateFields).length > 0) {
      await updateRecord(
        source.baseId,
        source.token,
        invoiceTable.name,
        orderId,
        invoiceUpdateFields,
      );
    }

    const totalQuantity = Array.from(groupedItems.values()).reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    return NextResponse.json({
      success: true,
      message: `${orderNo} moved to FAB Stock successfully`,
      orderNo,
      skuCount: groupedItems.size,
      totalQuantity,
      stockReceivedCreated: stockReceivedRecords.length,
      productsCreated: createdProducts.length,
      createdProductSkus: createdProducts,
    });
  } catch (error) {
    return handleApiError(error, "Move to FAB Stock failed");
  }
}
