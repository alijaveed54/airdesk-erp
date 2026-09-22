// ================================
// PART 1/4
// Bulk Shift Refactor
// ================================

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
  options?: {
    linkedTableId?: string;
  };
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

type TransferOrderInput = {
  orderId: string;
  orderNo: string;
  sourceTable?: string;
};


const FAB_STOCK_BASE_ID = "appEKsWCVMfGBFQ3L";


// ================================
// Helpers
// ================================

function normalize(value: unknown) {
  return String(value ?? "").trim();
}


function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}


function text(value: unknown) {

  const resolved = first(value);

  if (resolved === null || resolved === undefined) {
    return "";
  }

  if (typeof resolved === "object") {

    const objectValue = resolved as Record<string, unknown>;

    return normalize(
      objectValue.name ??
      objectValue.value ??
      objectValue.text ??
      ""
    );
  }

  return normalize(resolved);
}


function numeric(value: unknown) {

  const parsed = Number(first(value));

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}


function truthy(value: unknown) {

  if (value === true || value === 1) {
    return true;
  }

  const normalized =
    normalize(first(value)).toLowerCase();


  return [
    "true",
    "yes",
    "1",
    "moved",
    "transferred",
    "completed",
  ].includes(normalized);
}


function findField(
  fields: SchemaField[],
  candidates: string[]
) {

  const lookup = new Map(
    fields.map((field) => [
      field.name.trim().toLowerCase(),
      field.name,
    ])
  );


  for (const candidate of candidates) {

    const found =
      lookup.get(
        candidate.trim().toLowerCase()
      );

    if (found) {
      return found;
    }
  }


  return "";
}


function findTable(
  tables: SchemaTable[],
  candidates: string[]
) {

  const lookup = new Map(
    tables.map((table) => [
      table.name.trim().toLowerCase(),
      table,
    ])
  );


  for (const candidate of candidates) {

    const found =
      lookup.get(
        candidate.trim().toLowerCase()
      );

    if (found) {
      return found;
    }
  }


  return undefined;
}


function escapeFormula(value: string) {

  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}


function isoDateOnly() {

  return new Date()
    .toISOString()
    .slice(0, 10);
}


function resolveTargetToken(sourceToken: string) {

  return (
    process.env.FAB_STOCK_AIRTABLE_TOKEN ||
    process.env.AIRTABLE_FAB_STOCK_TOKEN ||
    process.env.AIRTABLE_TOKEN ||
    sourceToken
  ).trim();
}


// ================================
// Airtable Helpers
// ================================

async function getSchema(
  baseId: string,
  token: string
): Promise<SchemaTable[]> {


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

    throw new Error(
      data?.error?.message ||
      "Unable to load Airtable schema"
    );
  }


  return data.tables || [];
}


async function fetchRecord(
  baseId: string,
  token: string,
  tableName: string,
  recordId: string
): Promise<AirtableRecord> {


  const response = await fetch(
    `${airtableUrl(baseId, tableName)}/${encodeURIComponent(recordId)}`,
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );


  const data = await response.json();


  if (!response.ok) {

    throw new Error(
      data?.error?.message ||
      `Unable to read ${tableName} record`
    );
  }


  return data;
}
// ================================
// PART 2/4
// Airtable CRUD + Transfer Function Start
// ================================


async function fetchAllRecords(
  baseId: string,
  token: string,
  tableName: string,
  formula = ""
): Promise<AirtableRecord[]> {

  const records: AirtableRecord[] = [];

  let offset = "";


  do {

    const params = new URLSearchParams({
      pageSize: "100",
    });


    if (formula) {
      params.set(
        "filterByFormula",
        formula
      );
    }


    if (offset) {
      params.set(
        "offset",
        offset
      );
    }


    const response = await fetch(
      airtableUrl(
        baseId,
        tableName,
        params
      ),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );


    const data = await response.json();


    if (!response.ok) {

      throw new Error(
        data?.error?.message ||
        `Unable to read records from ${tableName}`
      );
    }


    records.push(
      ...(data.records || [])
    );


    offset = data.offset || "";


  } while (offset);


  return records;
}



async function createRecords(
  baseId: string,
  token: string,
  tableName: string,
  records: Array<{
    fields: Record<string, unknown>;
  }>
) {


  for (
    let index = 0;
    index < records.length;
    index += 10
  ) {


    const batch =
      records.slice(
        index,
        index + 10
      );


    const response = await fetch(
      airtableUrl(
        baseId,
        tableName
      ),
      {
        method: "POST",
        headers: airtableHeaders(token),
        cache: "no-store",
        body: JSON.stringify({
          records: batch,
          typecast: true,
        }),
      }
    );


    const data = await response.json();


    if (!response.ok) {

      throw new Error(
        data?.error?.message ||
        `Unable to create records in ${tableName}`
      );
    }
  }
}



async function createSingleRecord(
  baseId: string,
  token: string,
  tableName: string,
  fields: Record<string, unknown>
): Promise<AirtableRecord> {


  const response = await fetch(
    airtableUrl(
      baseId,
      tableName
    ),
    {
      method: "POST",
      headers: airtableHeaders(token),
      cache: "no-store",
      body: JSON.stringify({
        fields,
        typecast: true,
      }),
    }
  );


  const data = await response.json();


  if (!response.ok) {

    throw new Error(
      data?.error?.message ||
      `Unable to create record in ${tableName}`
    );
  }


  return data;
}



async function updateRecord(
  baseId: string,
  token: string,
  tableName: string,
  recordId: string,
  fields: Record<string, unknown>
) {


  const response = await fetch(
    `${airtableUrl(baseId, tableName)}/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      headers: airtableHeaders(token),
      cache: "no-store",
      body: JSON.stringify({
        fields,
        typecast: true,
      }),
    }
  );


  const data = await response.json();


  if (!response.ok) {

    throw new Error(
      data?.error?.message ||
      `Unable to update ${tableName}`
    );
  }
}
// ================================
// PART 3/4
// Transfer Order To FAB Stock
// ================================


async function transferOrderToFabStock(
  input: TransferOrderInput
) {

  const {
    orderId,
    orderNo,
    sourceTable,
    source,
  } = input as TransferOrderInput & {
    source?: Awaited<ReturnType<typeof getCurrentAirtableBase>>;
  };


  if (!source) {
    throw new Error("Source base missing");
  }


  const targetBaseId = (
    process.env.FAB_STOCK_AIRTABLE_BASE_ID ||
    FAB_STOCK_BASE_ID
  ).trim();


  const targetToken =
    resolveTargetToken(source.token);



  const [
    sourceSchema,
    targetSchema,
  ] = await Promise.all([

    getSchema(
      source.baseId,
      source.token
    ),

    getSchema(
      targetBaseId,
      targetToken
    ),

  ]);



  const invoiceTable =
    (
      sourceTable
        ? sourceSchema.find(
            (table) =>
              table.name
                .trim()
                .toLowerCase() ===
              sourceTable
                .trim()
                .toLowerCase()
          )
        : undefined
    )
    ||
    sourceSchema.find(
      (table) =>
        table.name === source.tables.invoice
    )
    ||
    findTable(
      sourceSchema,
      [
        "FAB Invoice",
        "Invoice",
      ]
    );



  if (!invoiceTable) {

    throw new Error(
      "FAB Invoice table not found"
    );
  }



  const orderEntryTable =
    findTable(
      sourceSchema,
      [
        "FAB Order Entry",
        "Order Entry",
      ]
    )
    ||
    sourceSchema.find(
      (table) =>
        table.name
          .toLowerCase()
          .includes(
            "order entry"
          )
    );



  if (!orderEntryTable) {

    throw new Error(
      "FAB Order Entry table not found"
    );
  }



  const productTable =
    findTable(
      targetSchema,
      [
        "Product",
        "Products",
      ]
    );



  const stockReceivedTable =
    findTable(
      targetSchema,
      [
        "Stock Received",
      ]
    );



  if (!productTable) {

    throw new Error(
      "FAB Stock Product table not found"
    );
  }



  if (!stockReceivedTable) {

    throw new Error(
      "Stock Received table not found"
    );
  }



  const invoiceRecord =
    await fetchRecord(
      source.baseId,
      source.token,
      invoiceTable.name,
      orderId
    );



  const invoiceOrderNoField =
    findField(
      invoiceTable.fields,
      [
        "Order No.",
        "Order No",
        "Order Number",
        "Invoice No.",
        "Invoice No",
      ]
    );



  if (invoiceOrderNoField) {

    const savedOrderNo =
      text(
        invoiceRecord.fields?.[
          invoiceOrderNoField
        ]
      );


    if (
      savedOrderNo &&
      savedOrderNo.toLowerCase() !==
      orderNo.toLowerCase()
    ) {

      throw new Error(
        "Order ID and Order No mismatch"
      );
    }
  }



  const movedField =
    findField(
      invoiceTable.fields,
      [
        "Moved To FAB Stock",
        "Moved to FAB Stock",
        "Added To FAB Stock",
        "Transferred To FAB Stock",
      ]
    );


// Check actual FAB Stock transfer before blocking retry

let alreadyTransferred = false;


const targetBaseIdCheck = (
  process.env.FAB_STOCK_AIRTABLE_BASE_ID ||
  FAB_STOCK_BASE_ID
).trim();


const targetTokenCheck =
  resolveTargetToken(
    source.token
  );



const stockReceivedTableCheck =
  findTable(
    targetSchema,
    [
      "Stock Received"
    ]
  );



if (
  stockReceivedTableCheck
) {


  const orderFieldCheck =
    findField(
      stockReceivedTableCheck.fields,
      [
        "Order Number",
        "Order No.",
        "Order No",
        "Reference",
        "Source Order No"
      ]
    );



  if (
    orderFieldCheck
  ) {


    const previousTransfers =
      await fetchAllRecords(
        targetBaseIdCheck,
        targetTokenCheck,
        stockReceivedTableCheck.name,
        `LOWER({${orderFieldCheck}}&'')=LOWER('${escapeFormula(orderNo)}')`
      );



    if (
      previousTransfers.length > 0
    ) {

      alreadyTransferred = true;

    }

  }

}



if (
  alreadyTransferred
) {

  throw new Error(
    `${orderNo} already transferred to FAB Stock`
  );

}
  if (
    movedField &&
    truthy(
      invoiceRecord.fields?.[
        movedField
      ]
    )
  ) {

    throw new Error(
      `${orderNo} already moved to FAB Stock`
    );
  }



  const orderLinkField =
    orderEntryTable.fields.find(
      (field) =>
        field.type ===
        "multipleRecordLinks" &&
        field.options
          ?.linkedTableId ===
        invoiceTable.id
    )?.name
    ||
    findField(
      orderEntryTable.fields,
      [
        "Order No.",
        "Order No",
        "Invoice",
        "Order",
      ]
    );



  const sourceSkuField =
    findField(
      orderEntryTable.fields,
      [
        "SKU",
        "Item Code",
        "Product SKU",
        "Supplier SKU",
      ]
    );



  const sourceQtyField =
    findField(
      orderEntryTable.fields,
      [
        "quantity",
        "Quantity",
        "Qty",
        "Qt",
      ]
    );



  if (
    !orderLinkField ||
    !sourceSkuField ||
    !sourceQtyField
  ) {

    throw new Error(
      "FAB Order Entry fields missing"
    );
  }



  const escapedOrderNo =
    escapeFormula(
      orderNo
    );



  let itemRecords =
    await fetchAllRecords(
      source.baseId,
      source.token,
      orderEntryTable.name,
      `FIND(LOWER('${escapedOrderNo}'),LOWER(ARRAYJOIN({${orderLinkField}}&'')))>0`
    );



  if (
    itemRecords.length === 0
  ) {

    throw new Error(
      `No items found for ${orderNo}`
    );
  }



  const groupedItems =
    new Map<string, TransferItem>();



  for (
    const record of itemRecords
  ) {


    const quantity =
  numeric(
    record.fields?.[
      sourceQtyField
    ]
  );


let sku = "";

let sourceProductRecordId = "";


const linkedSkuValue =
  record.fields?.[
    sourceSkuField
  ];



if (
  Array.isArray(linkedSkuValue) &&
  linkedSkuValue.length > 0
) {

  sourceProductRecordId =
    String(
      linkedSkuValue[0]
    );


  const skuFieldSchema =
    orderEntryTable.fields.find(
      (field) =>
        field.name === sourceSkuField
    );


  const linkedProductTable =
    sourceSchema.find(
      (table) =>
        table.id ===
        skuFieldSchema?.options
          ?.linkedTableId
    );


  if (linkedProductTable) {

    const sourceProduct =
      await fetchRecord(
        source.baseId,
        source.token,
        linkedProductTable.name,
        sourceProductRecordId
      );


    sku =
      text(
        sourceProduct.fields?.SKU ||
        sourceProduct.fields?.Sku ||
        sourceProduct.fields?.["Item Code"]
      );

  }

} else {

  sku =
    text(linkedSkuValue);

}



    if (
      !sku ||
      quantity <= 0
    ) {
      continue;
    }



    const key =
      sku.toLowerCase();



    const existing =
      groupedItems.get(key);



    groupedItems.set(
  key,
  {
    sku,
    quantity:
      (existing?.quantity || 0)
      + quantity,

    sourceProductRecordId:
      sourceProductRecordId ||
      existing?.sourceProductRecordId,
  }
);
  }



  if (
    groupedItems.size === 0
  ) {

    throw new Error(
      "No valid SKU found"
    );
  }
  
// ================================
// PART 4-A
// Product + Stock Transfer
// ================================


  const productSkuField =
    findField(
      productTable.fields,
      [
        "SKU",
        "Sku",
        "Product SKU",
        "Item Code",
      ]
    );


  const stockProductLinkField =
    stockReceivedTable.fields.find(
      (field) =>
        field.type ===
        "multipleRecordLinks" &&
        field.options?.linkedTableId ===
        productTable.id
    )?.name
    ||
    findField(
      stockReceivedTable.fields,
      [
        "SKU-",
        "Product",
        "Products",
        "SKU",
        "Item",
      ]
    );


  const stockQuantityField =
    findField(
      stockReceivedTable.fields,
      [
        "Stock +",
        "Quantity",
        "Qty",
        "Stock Received",
        "Received Quantity",
      ]
    );


  const stockOrderNoField =
    findField(
      stockReceivedTable.fields,
      [
        "Order Number",
        "Order No.",
        "Order No",
        "Reference",
      ]
    );


  const stockDateField =
    findField(
      stockReceivedTable.fields,
      [
        "Date",
        "Received Date",
        "Entry Date",
      ]
    );


  if (
    !productSkuField ||
    !stockProductLinkField ||
    !stockQuantityField
  ) {

    throw new Error(
      "FAB Stock fields missing"
    );
  }



  const productRecords =
    new Map<string, AirtableRecord>();


  const createdProducts: string[] = [];



  for (
  const item of groupedItems.values()
) {


  const matches =
    await fetchAllRecords(
      targetBaseId,
      targetToken,
      productTable.name,
      `LOWER({${productSkuField}}&'')=LOWER('${escapeFormula(item.sku)}')`
    );


  if (
    matches.length > 0
  ) {

    productRecords.set(
      item.sku.toLowerCase(),
      matches[0]
    );

    continue;
  }



  let productFields: Record<string, unknown> = {
    [productSkuField]:
      item.sku,
  };



  // Copy source product data from linked record

  if (
    item.sourceProductRecordId
  ) {


    const skuFieldSchema =
      orderEntryTable.fields.find(
        (field) =>
          field.name === sourceSkuField
      );


    const sourceProductTable =
      sourceSchema.find(
        (table) =>
          table.id ===
          skuFieldSchema?.options
            ?.linkedTableId
      );



    if (
      sourceProductTable
    ) {


      const sourceProduct =
        await fetchRecord(
          source.baseId,
          source.token,
          sourceProductTable.name,
          item.sourceProductRecordId
        );



      const copyFields = [
        "SKU",
        "Sku",
        "Item Code",
        "Name",
        "Product Name",
        "Item Name",
        "Image",
        "Images",
        "Product Image",
        "Photo",
        "Color",
        "Colour",
        "Size",
        "Price",
        "Doha Price",
      ];



      for (
        const field of copyFields
      ) {


        if (
          sourceProduct.fields[field] !== undefined
        ) {

          productFields[field] =
            sourceProduct.fields[field];

        }

      }

    }

  }



  const created =
    await createSingleRecord(
      targetBaseId,
      targetToken,
      productTable.name,
      productFields
    );



  productRecords.set(
    item.sku.toLowerCase(),
    created
  );


  createdProducts.push(
    item.sku
  );

}



  const transferDate =
    isoDateOnly();



  const stockReceivedRecords =
    Array.from(
      groupedItems.values()
    ).map(
      (item) => {


        const product =
          productRecords.get(
            item.sku.toLowerCase()
          );



        if (!product) {

          throw new Error(
            `Product missing ${item.sku}`
          );
        }



        const fields: Record<string, unknown> = {
          [stockProductLinkField]:
            [
              product.id
            ],

          [stockQuantityField]:
            item.quantity,
        };



        if (
          stockOrderNoField
        ) {

          fields[stockOrderNoField] =
            orderNo;
        }


        if (
          stockDateField
        ) {

          fields[stockDateField] =
            transferDate;
        }



        return {
          fields,
        };
      }
    );



  await createRecords(
    targetBaseId,
    targetToken,
    stockReceivedTable.name,
    stockReceivedRecords
  );



  return {
    success: true,
    orderNo,
    totalQuantity:
      Array.from(
        groupedItems.values()
      ).reduce(
        (sum,item)=>
          sum + item.quantity,
        0
      ),
    createdProducts,
  };

}

// ================================
// PART 4-B
// Final POST Handler
// Single + Bulk Shift
// ================================


export async function POST(
  request: Request
) {

  try {


    const session =
      await getSession();



    if (
      !session ||
      (
        session.role !== "Admin" &&
        !session.superAdmin
      )
    ) {

      return NextResponse.json(
        {
          success: false,
          message:
            "Only Admin can move orders to FAB Stock",
        },
        {
          status: 403,
        }
      );
    }



    const source =
      await getCurrentAirtableBase();



    const sourceBaseName =
      normalize(
        source.baseName
      ).toLowerCase();



    const isFabNonStock =
      (
        sourceBaseName.includes("fab") ||
        sourceBaseName.includes("doha")
      )
      &&
      (
        sourceBaseName.includes("non stock") ||
        sourceBaseName.includes("non-stock") ||
        sourceBaseName.includes("without stock")
      );



    if (!isFabNonStock) {

      return NextResponse.json(
        {
          success:false,
          message:
            "This action is only available in FAB Doha Non Stock base",
        },
        {
          status:400,
        }
      );
    }



    const body =
      await request.json();



    /*
      SINGLE ORDER

      {
        orderId,
        orderNo,
        sourceTable
      }


      BULK

      {
        orders:[
          {
            orderId,
            orderNo,
            sourceTable
          }
        ]
      }

    */



    const orders =
      Array.isArray(body.orders)
        ? body.orders
        : [
            {
              orderId:
                body.orderId,

              orderNo:
                body.orderNo,

              sourceTable:
                body.sourceTable,
            },
          ];



    if (
      orders.length === 0
    ) {

      return NextResponse.json(
        {
          success:false,
          message:
            "No orders selected",
        },
        {
          status:400,
        }
      );
    }



    const results:any[] = [];



    for (
      const order of orders
    ) {


      try {


        const result =
          await transferOrderToFabStock(
            {
              orderId:
                normalize(
                  order.orderId
                ),

              orderNo:
                normalize(
                  order.orderNo
                ),

              sourceTable:
                normalize(
                  order.sourceTable
                ),

              source,
            } as any
          );



        results.push(
          {
            success:true,
            ...result,
          }
        );


      } catch(error) {


        results.push(
          {
            success:false,
            orderNo:
              order.orderNo,

            message:
              error instanceof Error
                ? error.message
                : "Transfer failed",
          }
        );
      }
    }



    const failed =
      results.filter(
        item =>
          !item.success
      );



    return NextResponse.json(
      {
        success:
          failed.length === 0,

        message:
          failed.length === 0
            ? `${results.length} order(s) moved to FAB Stock successfully`
            : "Some orders failed during transfer",

        results,
      }
    );



  } catch(error) {


    console.error(
      "MOVE TO FAB STOCK ERROR:",
      error
    );


    return NextResponse.json(
      {
        success:false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      {
        status:500,
      }
    );

  }
}