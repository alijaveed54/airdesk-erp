import { NextResponse } from "next/server";
import {
  airtableFetch,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import { createAuditLog } from "@/lib/audit";
import { getSession } from "@/lib/auth";

type AirtableSchemaField = {
  id?: string;
  name: string;
  type?: string;
  options?: {
    linkedTableId?: string;
  };
};

type AirtableSchemaTable = {
  id?: string;
  name: string;
  fields?: AirtableSchemaField[];
};

type OrderEntryFieldMap = {
  invoiceLink: string;
  sku: string;
  quantity: string;
  size?: string;
  singlePrice?: string;
  packPrice?: string;
  receivedWh?: string;
  receivedInUae?: string;
  instock?: string;
  billNo?: string;
  supplier?: string;
};

type InvoiceFieldMap = {
  customerLink: string;
  discount?: string;
  shipping?: string;
  vat?: string;
  totalAdjustment?: string;
  orderNote?: string;
  replacement?: string;
  returnItemsValue?: string;
  orderStatus?: string;
  store?: string;
  salesPerson?: string;
};

const schemaCache = new Map<string, AirtableSchemaTable[]>();
const orderEntryFieldMapCache = new Map<string, OrderEntryFieldMap>();
const invoiceFieldMapCache = new Map<string, InvoiceFieldMap>();

function findSchemaField(
  fields: AirtableSchemaField[],
  candidates: string[]
): string {
  const normalizedFields = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field.name])
  );

  for (const candidate of candidates) {
    const fieldName = normalizedFields.get(candidate.trim().toLowerCase());
    if (fieldName) return fieldName;
  }

  return "";
}

async function getBaseSchema(baseId: string, token: string) {
  const cached = schemaCache.get(baseId);
  if (cached) return cached;

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
      data?.error?.message || "Unable to load Airtable schema"
    );
  }

  const tables: AirtableSchemaTable[] = data.tables || [];
  schemaCache.set(baseId, tables);

  return tables;
}

async function getInvoiceFieldMap({
  baseId,
  token,
  invoiceTableName,
  customerTableName,
}: {
  baseId: string;
  token: string;
  invoiceTableName: string;
  customerTableName: string;
}) {
  const cacheKey = `${baseId}:${invoiceTableName}:${customerTableName}`;
  const cached = invoiceFieldMapCache.get(cacheKey);

  if (cached) return cached;

  const tables = await getBaseSchema(baseId, token);

  const invoiceTable = tables.find(
    (table) => table.name === invoiceTableName
  );
  const customerTable = tables.find(
    (table) => table.name === customerTableName
  );

  if (!invoiceTable) {
    throw new Error(`Invoice table not found: ${invoiceTableName}`);
  }

  if (!customerTable) {
    throw new Error(`Customer table not found: ${customerTableName}`);
  }

  const fields = invoiceTable.fields || [];

  const customerLinkedField = fields.find(
    (field) =>
      field.type === "multipleRecordLinks" &&
      field.options?.linkedTableId === customerTable.id
  );

  const map: InvoiceFieldMap = {
    customerLink:
      customerLinkedField?.name ||
      findSchemaField(fields, [
        "contact",
        "Contact",
        "Customer",
        "Customer Name",
        "Contact No.",
        "Contact No",
      ]),
    discount: findSchemaField(fields, [
      "discount",
      "Discount",
      "Discount Amount",
    ]),
    shipping: findSchemaField(fields, [
      "shipping",
      "Shipping",
      "Shipping Charges",
      "Delivery Charges",
    ]),
    vat: findSchemaField(fields, ["vat", "VAT"]),
    totalAdjustment: findSchemaField(fields, [
      "Total Adjustment",
      "total adjustment",
      "TotalAdjustment",
      "total_adjustment",
      "Adjustment",
      "Adjustment Amount",
    ]),
    orderNote: findSchemaField(fields, [
      "Order Note",
      "order_note",
      "Note",
      "Notes",
    ]),
    replacement: findSchemaField(fields, [
      "Replacement",
      "replacement",
    ]),
    returnItemsValue: findSchemaField(fields, [
      "Return Items Value",
      "Return Order Value",
      "return_items_value",
    ]),
    orderStatus: findSchemaField(fields, [
      "order_status",
      "Order Status",
      "Order_status",
      "Status",
    ]),
    store: findSchemaField(fields, [
      "Select Store",
      "Store",
      "store",
    ]),
    salesPerson: findSchemaField(fields, [
      "Sales person Name",
      "Sales Person Name",
      "Sales Person",
      "Salesperson",
    ]),
  };

  if (!map.customerLink) {
    throw new Error(
      `Customer linked field not found in invoice table: ${invoiceTableName}`
    );
  }

  invoiceFieldMapCache.set(cacheKey, map);

  return map;
}

async function getOrderEntryFieldMap({
  baseId,
  token,
  tableName,
  invoiceTableName,
}: {
  baseId: string;
  token: string;
  tableName: string;
  invoiceTableName: string;
}) {
  const cacheKey = `${baseId}:${tableName}:${invoiceTableName}`;
  const cached = orderEntryFieldMapCache.get(cacheKey);

  if (cached) return cached;

  const tables = await getBaseSchema(baseId, token);

  const table = tables.find((item) => item.name === tableName);
  const invoiceTable = tables.find(
    (item) => item.name === invoiceTableName
  );

  if (!table) {
    throw new Error(`Order Entry table not found: ${tableName}`);
  }

  if (!invoiceTable) {
    throw new Error(`Invoice table not found: ${invoiceTableName}`);
  }

  const fields: AirtableSchemaField[] = table.fields || [];

  const linkedInvoiceField = fields.find(
    (field) =>
      field.type === "multipleRecordLinks" &&
      field.options?.linkedTableId === invoiceTable.id
  );

  const fieldMap: OrderEntryFieldMap = {
    invoiceLink: linkedInvoiceField?.name || "",
    sku: findSchemaField(fields, [
      "sku",
      "SKU",
      "Product",
      "Product SKU",
      "Item",
      "Item Code",
    ]),
    quantity: findSchemaField(fields, [
      "quantity",
      "Quantity",
      "Qty",
      "QTY",
    ]),
    size: findSchemaField(fields, ["Size", "size"]),
    singlePrice: findSchemaField(fields, [
      "single price",
      "Single Price",
      "single_price",
      "Price",
    ]),
    packPrice: findSchemaField(fields, [
      "Pack Price",
      "pack price",
      "pack_price",
    ]),
    receivedWh: findSchemaField(fields, [
      "received_in_wh_1",
      "Received in WH 1",
      "Received In WH 1",
      "Received WH 1",
      "Warehouse Received",
    ]),
    receivedInUae: findSchemaField(fields, [
      "Received In UAE",
      "Received in UAE",
      "received_in_uae",
    ]),
    instock: findSchemaField(fields, [
      "instock",
      "In Stock",
      "Instock",
      "InStock",
    ]),
    billNo: findSchemaField(fields, [
      "bill_no",
      "Bill No",
      "Bill No.",
      "Bill Number",
    ]),
    supplier: findSchemaField(fields, [
      "Supplier",
      "supplier",
      "Purchase Supplier",
      "Supplier Code",
    ]),
  };

  if (!fieldMap.invoiceLink) {
    throw new Error(
      `Invoice linked-record field not found in Order Entry table: ${tableName}`
    );
  }

  if (!fieldMap.sku) {
    throw new Error(`SKU field not found in Order Entry table: ${tableName}`);
  }

  if (!fieldMap.quantity) {
    throw new Error(
      `Quantity field not found in Order Entry table: ${tableName}`
    );
  }

  orderEntryFieldMapCache.set(cacheKey, fieldMap);

  return fieldMap;
}

function getTodayBillNo() {
  const now = new Date();

  return `${String(now.getDate()).padStart(2, "0")}${String(
    now.getMonth() + 1
  ).padStart(2, "0")}${now.getFullYear()}`;
}

export async function POST(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();
    const session = await getSession();

    const loggedInUser =
      session?.fullName ||
      session?.username ||
      "";

    if (!airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to create orders",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    const {
      customerId,
      selectedStore,
      orderMode,
      discount,
      shipping,
      vat,
      totalAdjustment,
      orderNote,
      replacement,
      returnOrderValue,
      items,
    } = body;

    const normalizedBaseName = String(airtable.baseName || "")
      .trim()
      .toLowerCase();

    const isTatBase =
      normalizedBaseName.includes("tatlumput") ||
      normalizedBaseName === "tat" ||
      normalizedBaseName.startsWith("tat ");

    const isI5qDqBase =
      normalizedBaseName.includes("i5q") ||
      normalizedBaseName.includes("dq") ||
      normalizedBaseName.includes("04-10-2026");

    const normalizedOrderMode = "DQ";

    const invoiceTable = isI5qDqBase
      ? "DQ Invoice"
      : airtable.tables.invoice || "BS Invoice";

    const orderEntryTable = isI5qDqBase
      ? "DQ Order Entry"
      : airtable.tables.orderEntry || "BS Order Entry";

    const isBsOrderEntry =
      airtable.baseId === "app2hjpuQoeEL1Rn2" &&
      orderEntryTable === "BS Order Entry";

    const schemaTables = await getBaseSchema(
      airtable.baseId,
      airtable.token
    );

    const configuredCustomerTable = String(
      airtable.tables.customers || ""
    )
      .trim()
      .toLowerCase();

    const customerTable =
      schemaTables.find(
        (table) =>
          table.name.trim().toLowerCase() ===
          configuredCustomerTable
      )?.name ||
      schemaTables.find(
        (table) =>
          table.name.trim().toLowerCase() === "customers"
      )?.name ||
      schemaTables.find(
        (table) =>
          table.name.trim().toLowerCase() === "customer"
      )?.name ||
      "Customers";

    const requiresStore = !isTatBase && !isI5qDqBase;

    if (!customerId) {
      return NextResponse.json(
        { success: false, message: "Customer is required" },
        { status: 400 }
      );
    }

    if (requiresStore && !selectedStore) {
      return NextResponse.json(
        { success: false, message: "Store is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "At least one product is required",
        },
        { status: 400 }
      );
    }

    const invoiceFieldMap = await getInvoiceFieldMap({
      baseId: airtable.baseId,
      token: airtable.token,
      invoiceTableName: invoiceTable,
      customerTableName: customerTable,
    });

    const orderEntryFieldMap = await getOrderEntryFieldMap({
      baseId: airtable.baseId,
      token: airtable.token,
      tableName: orderEntryTable,
      invoiceTableName: invoiceTable,
    });

    const hasBsInstockItems =
      isBsOrderEntry && items.some((item: any) => Boolean(item?.warehouse));

    if (hasBsInstockItems) {
      const missingFields = [
        !orderEntryFieldMap.receivedWh ? "received_in_wh_1" : "",
        !orderEntryFieldMap.billNo ? "bill_no" : "",
        !orderEntryFieldMap.instock ? "instock" : "",
        !orderEntryFieldMap.receivedInUae ? "Received In UAE" : "",
      ].filter(Boolean);

      if (missingFields.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: `BS In Stock item fields not found: ${missingFields.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    const invoiceFields: Record<string, any> = {
      [invoiceFieldMap.customerLink]: [customerId],
    };

    if (invoiceFieldMap.discount) {
      invoiceFields[invoiceFieldMap.discount] = Number(discount) || 0;
    }

    if (invoiceFieldMap.shipping) {
      invoiceFields[invoiceFieldMap.shipping] = Number(shipping) || 0;
    }

    if (invoiceFieldMap.vat) {
      invoiceFields[invoiceFieldMap.vat] = isI5qDqBase
        ? 0
        : Number(vat) || 0;
    }

    if (invoiceFieldMap.totalAdjustment) {
      invoiceFields[invoiceFieldMap.totalAdjustment] =
        Number(totalAdjustment) || 0;
    }

    if (invoiceFieldMap.orderNote) {
      invoiceFields[invoiceFieldMap.orderNote] = orderNote || "";
    }

    if (invoiceFieldMap.replacement) {
      invoiceFields[invoiceFieldMap.replacement] = !!replacement;
    }

    if (invoiceFieldMap.returnItemsValue) {
      invoiceFields[invoiceFieldMap.returnItemsValue] =
        Number(returnOrderValue) || 0;
    }

    if (invoiceFieldMap.orderStatus && !isI5qDqBase) {
      invoiceFields[invoiceFieldMap.orderStatus] = "Order Received";
    }

    if (
      isI5qDqBase &&
      invoiceFieldMap.salesPerson &&
      loggedInUser
    ) {
      invoiceFields[invoiceFieldMap.salesPerson] = loggedInUser;
    }

    if (requiresStore && selectedStore && invoiceFieldMap.store) {
      invoiceFields[invoiceFieldMap.store] = selectedStore;
    }

    const invoiceData = await airtableFetch({
      baseId: airtable.baseId,
      token: airtable.token,
      table: invoiceTable,
      method: "POST",
      fields: {
        fields: invoiceFields,
      },
    });

    const invoiceId = invoiceData.id;

    const orderEntries = [];

    for (const item of items) {
      const entryFields: Record<string, any> = {
        [orderEntryFieldMap.invoiceLink]: [invoiceId],
        [orderEntryFieldMap.sku]: [item.productId],
        [orderEntryFieldMap.quantity]: Number(item.qty) || 1,
      };

      if (isI5qDqBase) {
        if (orderEntryFieldMap.size) {
          entryFields[orderEntryFieldMap.size] = String(item.size || "").trim();
        }

        if (orderEntryFieldMap.singlePrice) {
          entryFields[orderEntryFieldMap.singlePrice] =
            Number(item.price) || 0;
        }

        if (orderEntryFieldMap.packPrice) {
          entryFields[orderEntryFieldMap.packPrice] =
            Number(item.packPrice) || 0;
        }
      } else {
        if (item.warehouse) {
          if (orderEntryFieldMap.receivedWh) {
            entryFields[orderEntryFieldMap.receivedWh] = "Yes";
          }

          if (orderEntryFieldMap.receivedInUae) {
            entryFields[orderEntryFieldMap.receivedInUae] = "Yes";
          }

          // Locked BS Order Entry In Stock rule:
          // received_in_wh_1 = Yes
          // bill_no = blank
          // instock = Yes
          // Received In UAE = Yes
          if (isBsOrderEntry) {
            entryFields[orderEntryFieldMap.instock!] = "Yes";
            entryFields[orderEntryFieldMap.billNo!] = "";
          }
        } else if (orderEntryFieldMap.supplier) {
          entryFields[orderEntryFieldMap.supplier] =
            item.purchaseSupplier || "";
        }
      }

      const orderEntryData = await airtableFetch({
        baseId: airtable.baseId,
        token: airtable.token,
        table: orderEntryTable,
        method: "POST",
        fields: {
          fields: entryFields,
        },
      });

      orderEntries.push(orderEntryData);
    }

    let instock = "";

    if (!isI5qDqBase) {
      const warehouseCount = items.filter(
        (item: any) => item.warehouse
      ).length;

      if (warehouseCount === items.length) {
        instock = "Full";
      } else if (warehouseCount > 0) {
        instock = "Partial";
      }

      if (instock) {
        const tables = await getBaseSchema(airtable.baseId, airtable.token);
        const invoiceSchema = tables.find(
          (table) => table.name === invoiceTable
        );
        const instockField = findSchemaField(
          invoiceSchema?.fields || [],
          ["Instock", "In Stock", "Stock Status"]
        );

        if (instockField) {
          await airtableFetch({
            baseId: airtable.baseId,
            token: airtable.token,
            table: invoiceTable,
            recordId: invoiceId,
            method: "PATCH",
            fields: {
              fields: {
                [instockField]: instock,
              },
            },
          });
        }
      }
    }

    const refreshedInvoice = await airtableFetch({
      baseId: airtable.baseId,
      token: airtable.token,
      table: invoiceTable,
      recordId: invoiceId,
      method: "GET",
    });

    await createAuditLog({
      module: "Orders",
      action: "Create Order",
      recordId: invoiceId,
      recordLabel:
        String(
          refreshedInvoice?.fields?.["Order No."] ||
            refreshedInvoice?.fields?.["Order No"] ||
            refreshedInvoice?.fields?.["Invoice No."] ||
            refreshedInvoice?.fields?.["Invoice No"] ||
            refreshedInvoice?.fields?.Number ||
            invoiceId
        ),
      newValue: JSON.stringify({
        baseName: airtable.baseName,
        orderMode: isI5qDqBase ? normalizedOrderMode : "",
        invoiceTable,
        orderEntryTable,
        selectedStore: requiresStore ? selectedStore : "",
        itemCount: items.length,
        instock,
      }),
      note: isI5qDqBase
        ? `${normalizedOrderMode} order created`
        : "Order created",
    });

    return NextResponse.json({
      success: true,
      invoice: refreshedInvoice,
      orderEntries,
      orderMode: isI5qDqBase ? "DQ" : undefined,
      invoiceTable,
      orderEntryTable,
      summary: {
        discount: Number(discount) || 0,
        shipping: Number(shipping) || 0,
        vat: isI5qDqBase ? 0 : Number(vat) || 0,
        advancePayment: Number(body.advancePayment) || 0,
        totalAdjustment: Number(body.totalAdjustment) || 0,
        returnOrderValue: Number(returnOrderValue) || 0,
        orderNote: orderNote || "",
      },
      items,
      instock,
      billNo: getTodayBillNo(),
    });
  } catch (error) {
    return handleApiError(error, "Order create failed");
  }
}
