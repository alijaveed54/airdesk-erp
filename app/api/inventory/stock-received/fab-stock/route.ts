import { NextRequest, NextResponse } from "next/server";
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

const READ_ONLY_FIELD_TYPES = new Set([
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

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeFormulaValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function findWritableField(
  fields: SchemaField[],
  candidates: string[]
) {
  const fieldMap = new Map(
    fields.map((field) => [normalize(field.name), field])
  );

  for (const candidate of candidates) {
    const field = fieldMap.get(normalize(candidate));

    if (
      field &&
      !READ_ONLY_FIELD_TYPES.has(field.type)
    ) {
      return field;
    }
  }

  return undefined;
}

async function loadSchema(baseId: string, token: string) {
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

function resolveStockReceivedSetup(tables: SchemaTable[]) {
  const stockReceivedTable = tables.find(
    (table) => normalize(table.name) === "stock received"
  );

  if (!stockReceivedTable) {
    throw new Error('Table not found: "Stock Received"');
  }

  const linkedFieldCandidates = stockReceivedTable.fields.filter(
    (field) =>
      field.type === "multipleRecordLinks" &&
      Boolean(field.options?.linkedTableId)
  );

  const resolvedLink = linkedFieldCandidates
    .map((field) => {
      const linkedTable = tables.find(
        (table) => table.id === field.options?.linkedTableId
      );

      if (!linkedTable) return null;

      const hasSkuField = linkedTable.fields.some((linkedField) =>
        ["sku", "item code", "product sku", "product code"].includes(
          normalize(linkedField.name)
        )
      );

      const hasImageField = linkedTable.fields.some(
        (linkedField) =>
          linkedField.type === "multipleAttachments" ||
          ["image", "images", "product image", "photo", "photos"].includes(
            normalize(linkedField.name)
          )
      );

      return {
        field,
        linkedTable,
        score:
          (hasSkuField ? 10 : 0) +
          (hasImageField ? 5 : 0) +
          (["stock", "sku-", "sku", "product"].includes(
            normalize(field.name)
          )
            ? 3
            : 0),
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score)[0] as
    | {
        field: SchemaField;
        linkedTable: SchemaTable;
        score: number;
      }
    | undefined;

  if (!resolvedLink) {
    throw new Error(
      `Linked stock/SKU field not found in ${stockReceivedTable.name}`
    );
  }

  const linkField = resolvedLink.field;
  const productTable = resolvedLink.linkedTable;

  const receiveField = findWritableField(
    stockReceivedTable.fields,
    [
      "Stock Received",
      "Stock +",
      "Received Qty",
      "Quantity",
      "Qty",
    ]
  );

  if (!receiveField) {
    throw new Error(
      `Stock received quantity field not found in ${stockReceivedTable.name}`
    );
  }

  const stockOutField = findWritableField(
    stockReceivedTable.fields,
    ["Stock -", "Stock Out", "Deduct Qty"]
  );

  const categoryField = findWritableField(
    stockReceivedTable.fields,
    ["Category"]
  );

  const attachmentsField = findWritableField(
    stockReceivedTable.fields,
    ["Attachments", "Attachment"]
  );

  const productPrimaryField =
    productTable.fields.find(
      (field) => field.id === productTable.primaryFieldId
    ) ||
    productTable.fields[0];

  if (!productPrimaryField) {
    throw new Error(
      `Primary field not found in ${productTable.name}`
    );
  }

  return {
    stockReceivedTable,
    productTable,
    productPrimaryField,
    linkField,
    receiveField,
    stockOutField,
    categoryField,
    attachmentsField,
  };
}

async function searchProducts({
  baseId,
  token,
  productTable,
  primaryFieldName,
  search,
}: {
  baseId: string;
  token: string;
  productTable: SchemaTable;
  primaryFieldName: string;
  search: string;
}) {
  const imageField =
    productTable.fields.find(
      (field) =>
        ["image", "images", "product image", "photo", "photos"].includes(
          normalize(field.name)
        )
    ) ||
    productTable.fields.find(
      (field) => field.type === "multipleAttachments"
    );

  const params = new URLSearchParams();
  params.set("pageSize", "30");
  params.append("fields[]", primaryFieldName);

  if (imageField) {
    params.append("fields[]", imageField.name);
  }

  if (search) {
    params.set(
      "filterByFormula",
      `FIND(LOWER('${escapeFormulaValue(
        search
      )}'),LOWER({${primaryFieldName}}&''))>0`
    );
  }

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
        data?.error?.error?.message ||
        "Product search failed"
    );
  }

  return (data.records || []).map((record: any) => {
    const attachments = imageField
      ? record.fields?.[imageField.name]
      : [];

    const firstAttachment = Array.isArray(attachments)
      ? attachments[0]
      : null;

    return {
      id: record.id,
      sku: String(
        record.fields?.[primaryFieldName] || ""
      ).trim(),
      imageUrl:
        firstAttachment?.thumbnails?.large?.url ||
        firstAttachment?.thumbnails?.full?.url ||
        firstAttachment?.url ||
        "",
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to view stock received",
        },
        { status: 403 }
      );
    }

    const schema = await loadSchema(
      airtable.baseId,
      airtable.token
    );

    const setup = resolveStockReceivedSetup(schema);
    const search = String(
      new URL(req.url).searchParams.get("search") || ""
    ).trim();

    const products = await searchProducts({
      baseId: airtable.baseId,
      token: airtable.token,
      productTable: setup.productTable,
      primaryFieldName: setup.productPrimaryField.name,
      search,
    });

    return NextResponse.json({
      success: true,
      baseName: airtable.baseName,
      tableName: setup.stockReceivedTable.name,
      productTableName: setup.productTable.name,
      fields: {
        productLink: setup.linkField.name,
        received: setup.receiveField.name,
        stockOut: setup.stockOutField?.name || null,
        category: setup.categoryField?.name || null,
        attachments: setup.attachmentsField?.name || null,
      },
      newProduct: {
        enabled: true,
        priceRequired:
          String(airtable.baseName || "")
            .trim()
            .toLowerCase()
            .includes("fab") &&
          String(airtable.baseName || "")
            .trim()
            .toLowerCase()
            .includes("stock"),
        productTableName: setup.productTable.name,
      },
      products,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Stock received setup failed",
      },
      { status: 500 }
    );
  }
}


function findAnyWritableField(
  fields: SchemaField[],
  candidates: string[]
) {
  return findWritableField(fields, candidates);
}

async function findExistingProductBySku({
  baseId,
  token,
  tableName,
  skuFieldName,
  sku,
}: {
  baseId: string;
  token: string;
  tableName: string;
  skuFieldName: string;
  sku: string;
}) {
  const params = new URLSearchParams();
  params.set("pageSize", "1");
  params.set(
    "filterByFormula",
    `LOWER({${skuFieldName}}&'')=LOWER('${escapeFormulaValue(sku)}')`
  );

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
        "SKU duplicate check failed"
    );
  }

  return data.records?.[0] || null;
}

async function createNewProductAndReceiveStock({
  airtable,
  setup,
  body,
}: {
  airtable: Awaited<ReturnType<typeof getCurrentAirtableBase>>;
  setup: ReturnType<typeof resolveStockReceivedSetup>;
  body: any;
}) {
  const sku = String(body.sku || "").trim();
  const quantity = Number(body.quantity || 0);
  const imageUrl = String(body.imageUrl || "").trim();
  const size = String(body.size || "").trim();
  const price = Number(body.price || 0);

  if (!sku) {
    throw new Error("New SKU is required");
  }

  if (quantity <= 0) {
    throw new Error("Opening stock quantity must be greater than zero");
  }

  const skuField =
    findAnyWritableField(setup.productTable.fields, [
      "SKU",
      "Product SKU",
      "Item Code",
      "Product Code",
    ]) ||
    setup.productTable.fields.find(
      (field) =>
        field.id === setup.productTable.primaryFieldId &&
        !READ_ONLY_FIELD_TYPES.has(field.type)
    );

  if (!skuField) {
    throw new Error(
      `Writable SKU field not found in ${setup.productTable.name}`
    );
  }

  const duplicate = await findExistingProductBySku({
    baseId: airtable.baseId,
    token: airtable.token,
    tableName: setup.productTable.name,
    skuFieldName: skuField.name,
    sku,
  });

  if (duplicate) {
    throw new Error(
      `SKU already exists in ${setup.productTable.name}: ${sku}`
    );
  }

  const imageField = findAnyWritableField(
    setup.productTable.fields,
    ["Image", "Images", "Product Image", "Photo"]
  );

  const sizeField = findAnyWritableField(
    setup.productTable.fields,
    ["Size", "Product Size"]
  );

  const priceField = findAnyWritableField(
    setup.productTable.fields,
    [
      "Doha Price",
      "Price",
      "Selling Price",
      "Sale Price",
      "Qatar Price",
    ]
  );

  const normalizedBaseName = String(
    airtable.baseName || ""
  )
    .trim()
    .toLowerCase();

  const isFabStock =
    normalizedBaseName.includes("fab") &&
    normalizedBaseName.includes("stock") &&
    !normalizedBaseName.includes("non stock") &&
    !normalizedBaseName.includes("non-stock");

  if (isFabStock && (!priceField || price <= 0)) {
    throw new Error(
      "Doha Price is required for FAB Doha Stock new SKU"
    );
  }

  const productFields: Record<string, unknown> = {
    [skuField.name]: sku,
  };

  if (imageField && imageUrl) {
    productFields[imageField.name] = [{ url: imageUrl }];
  }

  if (sizeField && size) {
    productFields[sizeField.name] = size;
  }

  if (priceField && isFabStock) {
    productFields[priceField.name] = price;
  }

  const productResponse = await fetch(
    airtableUrl(
      airtable.baseId,
      setup.productTable.name
    ),
    {
      method: "POST",
      headers: airtableHeaders(airtable.token),
      cache: "no-store",
      body: JSON.stringify({
        records: [{ fields: productFields }],
        typecast: true,
      }),
    }
  );

  const productData = await productResponse.json();

  if (!productResponse.ok) {
    throw new Error(
      productData?.error?.message ||
        productData?.error?.error?.message ||
        "New SKU creation failed"
    );
  }

  const productRecord = productData.records?.[0];

  if (!productRecord?.id) {
    throw new Error("New product record ID was not returned");
  }

  const stockFields: Record<string, unknown> = {
    [setup.linkField.name]: [productRecord.id],
    [setup.receiveField.name]: quantity,
  };

  if (
    setup.categoryField &&
    String(body.category || "").trim()
  ) {
    stockFields[setup.categoryField.name] =
      String(body.category).trim();
  }

  const stockResponse = await fetch(
    airtableUrl(
      airtable.baseId,
      setup.stockReceivedTable.name
    ),
    {
      method: "POST",
      headers: airtableHeaders(airtable.token),
      cache: "no-store",
      body: JSON.stringify({
        records: [{ fields: stockFields }],
        typecast: true,
      }),
    }
  );

  const stockData = await stockResponse.json();

  if (!stockResponse.ok) {
    throw new Error(
      stockData?.error?.message ||
        stockData?.error?.error?.message ||
        "Opening stock receive failed"
    );
  }

  return {
    product: productRecord,
    stockReceived: stockData.records?.[0],
    sku,
    quantity,
  };
}

export async function POST(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to receive stock",
        },
        { status: 403 }
      );
    }

    const body = await req.json();

    const schema = await loadSchema(
      airtable.baseId,
      airtable.token
    );

    const setup = resolveStockReceivedSetup(schema);

    if (body.action === "create-product") {
      const result = await createNewProductAndReceiveStock({
        airtable,
        setup,
        body,
      });

      return NextResponse.json({
        success: true,
        message: `${result.sku} created with opening stock ${result.quantity}`,
        result,
      });
    }

    const items = Array.isArray(body.items)
      ? body.items
      : [];

    if (items.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "At least one stock item is required",
        },
        { status: 400 }
      );
    }

    const invalidItem = items.find(
      (item: any) =>
        !String(item.productId || "").startsWith("rec") ||
        Number(item.quantity || 0) <= 0
    );

    if (invalidItem) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Every row requires a valid product and quantity greater than zero",
        },
        { status: 400 }
      );
    }

    const records = items.map((item: any) => {
      const fields: Record<string, unknown> = {
        [setup.linkField.name]: [
          String(item.productId),
        ],
        [setup.receiveField.name]: Number(
          item.quantity
        ),
      };

      if (
        setup.categoryField &&
        String(item.category || "").trim()
      ) {
        fields[setup.categoryField.name] =
          String(item.category).trim();
      }

      return { fields };
    });

    const createdRecords: any[] = [];

    for (
      let index = 0;
      index < records.length;
      index += 10
    ) {
      const batch = records.slice(index, index + 10);

      const response = await fetch(
        airtableUrl(
          airtable.baseId,
          setup.stockReceivedTable.name
        ),
        {
          method: "POST",
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
          body: JSON.stringify({
            records: batch,
            typecast: true,
          }),
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
              "Stock receive failed",
            error: data,
          },
          { status: response.status }
        );
      }

      createdRecords.push(...(data.records || []));
    }

    return NextResponse.json({
      success: true,
      message: `${createdRecords.length} stock item(s) received successfully`,
      baseName: airtable.baseName,
      tableName: setup.stockReceivedTable.name,
      records: createdRecords,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Stock receive failed",
      },
      { status: 500 }
    );
  }
}
