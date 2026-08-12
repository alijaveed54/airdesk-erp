import {
  auditedFetch as fetch,
  installGlobalAirtableAudit,
} from "@/lib/audit-airtable-fetch";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// API routes across the ERP import this central Airtable module.
// Install the audit wrapper here as a runtime safety net in addition
// to Next.js instrumentation.ts, so direct Airtable fetch() mutations
// are still captured during local dev, Turbopack reloads, and Vercel.
if (process.env.NEXT_RUNTIME !== "edge") {
  installGlobalAirtableAudit();
}

export type CurrentAirtableBase = {
  baseName: string;
  baseId: string;
  token: string;
  supplierCode?: string;
  canView: boolean;
  canEdit: boolean;
  canReports: boolean;
  canDispatch: boolean;
  canReceive: boolean;
  canInventory: boolean;
  canFinance: boolean;
  canUsers: boolean;
  canDelete: boolean;
  tables: {
    invoice: string;
    orderEntry: string;
    customers: string;
    products: string;
  };
};

export async function getCurrentAirtableBase(): Promise<CurrentAirtableBase> {
  const session = await getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  const selectedBase = session.selectedBase || session.permissions?.[0];

  if (!selectedBase) {
    throw new Error("No selected base found");
  }

  if (!selectedBase.baseId) {
    throw new Error("Selected base ID missing");
  }

  const selectedBaseConfig = selectedBase as typeof selectedBase & {
    invoiceTable?: string;
    orderEntryTable?: string;
    customersTable?: string;
    productsTable?: string;
  };

  const tables = {
    invoice: selectedBaseConfig.invoiceTable || "BS Invoice",
    orderEntry: selectedBaseConfig.orderEntryTable || "BS Order Entry",
    customers: selectedBaseConfig.customersTable || "Customers",
    products: selectedBaseConfig.productsTable || "Products",
  };

  const token =
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    selectedBase.airtableToken ||
    "";

  if (!token) {
    throw new Error("Airtable token missing for selected base");
  }

  console.log("===== AIRTABLE DEBUG =====");
  console.log("Base:", selectedBase.baseName);
  console.log("Base ID:", selectedBase.baseId);
  console.log("Token Prefix:", token.substring(0, 12));
  console.log("Tables:", tables);

  return {
    baseName: selectedBase.baseName,
    baseId: selectedBase.baseId,
    token,
    tables,
    supplierCode: selectedBase.supplierCode,
    canView: selectedBase.canView,
    canEdit: selectedBase.canEdit,
    canReports: selectedBase.canReports,
    canDispatch: selectedBase.canDispatch,
    canReceive: selectedBase.canReceive,
    canInventory: selectedBase.canInventory,
    canFinance: selectedBase.canFinance,
    canUsers: selectedBase.canUsers,
    canDelete: selectedBase.canDelete,
  };
}

export function airtableUrl(
  baseId: string,
  tableName: string,
  params?: URLSearchParams
) {
  const query = params ? `?${params.toString()}` : "";

  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    tableName
  )}${query}`;
}

export function airtableHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function escapeAirtableString(value: string) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function apiError(message: string, status = 500, error?: any) {
  return NextResponse.json(
    {
      success: false,
      message,
      error,
    },
    { status }
  );
}

export function apiSuccess(data: Record<string, any> = {}) {
  return NextResponse.json({
    success: true,
    ...data,
  });
}

export async function airtableFetch({
  baseId,
  token,
  table,
  recordId,
  params,
  method = "GET",
  fields,
}: {
  baseId: string;
  token: string;
  table: string;
  recordId?: string;
  params?: URLSearchParams;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  fields?: Record<string, any> | { records: any[] };
}) {
  const url = airtableUrl(baseId, table, params) + (recordId ? `/${recordId}` : "");

  const response = await fetch(url, {
    method,
    headers: airtableHeaders(token),
    cache: "no-store",
    body: fields ? JSON.stringify(fields) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw {
      status: response.status,
      message:
        (typeof data?.error === "string"
          ? data.error
          : data?.error?.message ||
            data?.error?.type ||
            data?.message) ||
        `Airtable request failed (HTTP ${response.status})`,
      error: data,
    };
  }

  return data;
}

export async function airtablePaginatedFetch({
  baseId,
  token,
  table,
  params,
  maxRecords,
}: {
  baseId: string;
  token: string;
  table: string;
  params: URLSearchParams;
  maxRecords?: number;
}) {
  const records: any[] = [];
  let offset = "";

  do {
    const pageParams = new URLSearchParams(params);
    pageParams.set("pageSize", pageParams.get("pageSize") || "100");

    if (offset) {
      pageParams.set("offset", offset);
    }

    const data = await airtableFetch({
      baseId,
      token,
      table,
      params: pageParams,
    });

    records.push(...(data.records || []));
    offset = data.offset || "";

    if (maxRecords && records.length >= maxRecords) {
      break;
    }
  } while (offset);

  return maxRecords ? records.slice(0, maxRecords) : records;
}

export function handleApiError(error: any, fallbackMessage = "Request failed") {
  console.error(fallbackMessage, error);

  if (error?.status) {
    return apiError(error.message || fallbackMessage, error.status, error.error);
  }

  return apiError(
    error instanceof Error ? error.message : fallbackMessage,
    500,
    error
  );
}


type CustomerFieldMap = {
  contact: string;
  name: string;
  address?: string;
  area?: string;
  city?: string;
  googleMapLocation?: string;
};

const customerFieldCache = new Map<string, CustomerFieldMap>();

function firstMatchingField(
  fields: Array<{ name: string; type: string }>,
  candidates: string[]
) {
  const normalized = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field.name])
  );

  for (const candidate of candidates) {
    const match = normalized.get(candidate.trim().toLowerCase());
    if (match) return match;
  }

  return "";
}


export type InvoiceFieldMap = {
  number: string;
  status: string;
  courier?: string;
  dispatchDate?: string;
};

const invoiceFieldCache = new Map<string, InvoiceFieldMap>();

export async function getInvoiceFieldMap(
  baseId: string,
  token: string,
  tableName: string
): Promise<InvoiceFieldMap> {
  const cacheKey = `${baseId}:${tableName}`;
  const cached = invoiceFieldCache.get(cacheKey);
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
    throw new Error(
      data?.error?.message || "Unable to load Airtable invoice schema"
    );
  }

  const table = (data.tables || []).find(
    (item: any) => item.name === tableName
  );

  if (!table) {
    throw new Error(`Invoice table not found: ${tableName}`);
  }

  const fields = table.fields || [];

  const map: InvoiceFieldMap = {
    number: firstMatchingField(fields, [
      "Order No.",
      "Order No",
      "Order Number",
      "Invoice No.",
      "Invoice No",
      "Invoice Number",
      "Order ID",
    ]),
    status: firstMatchingField(fields, [
      "Order Status",
      "Status",
      "order_status",
    ]),
    courier: firstMatchingField(fields, [
      "Courier",
      "Driver",
      "Courier Name",
      "Driver Name",
      "Delivery Partner",
    ]),
    dispatchDate: firstMatchingField(fields, [
      "Despatch Date",
      "Dispatch Date",
      "Dispatched Date",
      "Date Dispatched",
    ]),
  };

  if (!map.status) {
    throw new Error(
      `Invoice status field not found in table: ${tableName}`
    );
  }

  invoiceFieldCache.set(cacheKey, map);
  return map;
}

async function getCustomerFieldMap(
  baseId: string,
  token: string,
  tableName: string
): Promise<CustomerFieldMap> {
  const cacheKey = `${baseId}:${tableName}`;
  const cached = customerFieldCache.get(cacheKey);
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
    throw new Error(data?.error?.message || "Unable to load Airtable customer schema");
  }

  const table = (data.tables || []).find((item: any) => item.name === tableName);
  if (!table) throw new Error(`Customer table not found: ${tableName}`);

  const fields = table.fields || [];
  const map: CustomerFieldMap = {
    contact: firstMatchingField(fields, [
      "Contact No.", "Contact No", "Contact", "Phone", "Mobile", "Telephone1",
    ]),
    name: firstMatchingField(fields, [
      "Customer Name", "Name", "Consignee", "Full Name",
    ]),
    address: firstMatchingField(fields, [
      "Address", "Customer Address", "Delivery Address",
    ]),
    area: firstMatchingField(fields, ["Area Name", "Area", "Location"]),
    city: firstMatchingField(fields, ["City Name", "City"]),
    googleMapLocation: firstMatchingField(fields, ["Google Map Location"]),
  };

  if (!map.contact) throw new Error(`Customer contact field not found in table: ${tableName}`);
  if (!map.name) throw new Error(`Customer name field not found in table: ${tableName}`);

  customerFieldCache.set(cacheKey, map);
  return map;
}

export async function searchCustomers(query: string) {
  const airtable = await getCurrentAirtableBase();
  if (!airtable.canView) {
    throw { status: 403, message: "You do not have permission to view customers" };
  }

  let customerTable = airtable.tables.customers || "Customers";
  let fieldMap: CustomerFieldMap;

  try {
    fieldMap = await getCustomerFieldMap(
      airtable.baseId,
      airtable.token,
      customerTable
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Customer table not found") &&
      customerTable !== "Customers"
    ) {
      customerTable = "Customers";
      fieldMap = await getCustomerFieldMap(
        airtable.baseId,
        airtable.token,
        customerTable
      );
    } else {
      throw error;
    }
  }
  const safeQuery = escapeAirtableString(query.trim());

  const params = new URLSearchParams();
  params.set("pageSize", "50");
  params.set(
    "filterByFormula",
    `OR(FIND(LOWER('${safeQuery}'), LOWER({${fieldMap.contact}} & '')) > 0,FIND(LOWER('${safeQuery}'), LOWER({${fieldMap.name}} & '')) > 0)`
  );

  return airtableFetch({
    baseId: airtable.baseId,
    token: airtable.token,
    table: customerTable,
    params,
  });
}

export async function createCustomer(input: {
  contactNo: string;
  customerName: string;
  address?: string;
  areaName?: string;
  cityName?: string;
  googleMapLocation?: string;
}) {
  const airtable = await getCurrentAirtableBase();
  if (!airtable.canEdit) {
    throw { status: 403, message: "You do not have permission to create customers" };
  }

  let customerTable = airtable.tables.customers || "Customers";
  let fieldMap: CustomerFieldMap;

  try {
    fieldMap = await getCustomerFieldMap(
      airtable.baseId,
      airtable.token,
      customerTable
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Customer table not found") &&
      customerTable !== "Customers"
    ) {
      customerTable = "Customers";
      fieldMap = await getCustomerFieldMap(
        airtable.baseId,
        airtable.token,
        customerTable
      );
    } else {
      throw error;
    }
  }

  const fields: Record<string, any> = {
    [fieldMap.contact]: input.contactNo.trim(),
    [fieldMap.name]: input.customerName.trim(),
  };

  if (fieldMap.address) fields[fieldMap.address] = input.address || "";
  if (fieldMap.area) fields[fieldMap.area] = input.areaName || "";
  if (fieldMap.city) fields[fieldMap.city] = input.cityName || "";

  const normalizedBaseName = airtable.baseName.trim().toLowerCase();
  const isI5qDqBase =
    normalizedBaseName.includes("i5q") ||
    /(^|[^a-z0-9])dq([^a-z0-9]|$)/.test(normalizedBaseName);

  const supportsGoogleMapLocation =
    (normalizedBaseName.includes("fab") &&
      normalizedBaseName.includes("doha")) ||
    isI5qDqBase;

  if (supportsGoogleMapLocation && fieldMap.googleMapLocation) {
    fields[fieldMap.googleMapLocation] = input.googleMapLocation || "";
  }

  return airtableFetch({
    baseId: airtable.baseId,
    token: airtable.token,
    table: customerTable,
    method: "POST",
    fields: { fields },
  });
}

type ProductFieldMap = {
  sku: string;
  image?: string;
  costPrice?: string;
  sellingPrice?: string;
  stock?: string;
  supplier?: string;
  supplierSku?: string;
};

const productFieldCache = new Map<string, ProductFieldMap>();

async function resolveProductTableName(
  baseId: string,
  token: string,
  configuredTable: string
) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Unable to load Airtable product schema"
    );
  }

  const tables = (data.tables || []) as Array<{ name: string }>;
  const names = new Map(
    tables.map((table) => [table.name.trim().toLowerCase(), table.name])
  );

  const candidates = [
    configuredTable,
    "Products",
    "Product",
    "Stock",
  ];

  for (const candidate of candidates) {
    const found = names.get(String(candidate || "").trim().toLowerCase());
    if (found) return found;
  }

  throw new Error(
    `Product table not found. Tried: ${candidates
      .filter(Boolean)
      .join(", ")}`
  );
}

async function getProductFieldMap(
  baseId: string,
  token: string,
  tableName: string
): Promise<ProductFieldMap> {
  const cacheKey = `${baseId}:${tableName}`;
  const cached = productFieldCache.get(cacheKey);
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
    throw new Error(
      data?.error?.message || "Unable to load Airtable product schema"
    );
  }

  const table = (data.tables || []).find(
    (item: any) => item.name === tableName
  );

  if (!table) throw new Error(`Product table not found: ${tableName}`);

  const fields = table.fields || [];

  const map: ProductFieldMap = {
    sku: firstMatchingField(fields, [
      "SKU",
      "Product SKU",
      "Item Code",
      "Product Code",
    ]),
    image: firstMatchingField(fields, [
      "Image",
      "image",
      "Product Image",
      "Images",
    ]),
    costPrice: firstMatchingField(fields, [
      "CP",
      "Cost Price",
      "Purchase Price",
      "Buying Price",
      "Product Cost",
    ]),
    sellingPrice: firstMatchingField(fields, [
      "Price",
      "Sale Price",
      "Selling Price",
      "Doha Price",
      "Dubai Price",
      "UAE Price",
      "Qatar Price",
      "Retail Price",
    ]),
    stock: firstMatchingField(fields, [
      "Balance Stock",
      "Stock",
      "stock",
      "Available Stock",
      "Current Stock",
    ]),
    supplier: firstMatchingField(fields, [
      "Supplier",
      "Purchase Supplier",
      "Supplier Code",
    ]),
    supplierSku: firstMatchingField(fields, [
      "ALV Supplier Code",
      "Supplier SKU",
      "P SKU",
      "P_SKU",
    ]),
  };

  if (!map.sku) {
    throw new Error(`Product SKU field not found in table: ${tableName}`);
  }

  productFieldCache.set(cacheKey, map);
  return map;
}

function normalizeProductRecord(record: any, map: ProductFieldMap) {
  const fields = record.fields || {};
  const normalized: Record<string, any> = {
    ...fields,
    SKU: fields[map.sku] ?? "",
  };

  if (map.image) normalized.Image = fields[map.image] ?? [];
  if (map.costPrice) normalized.CP = fields[map.costPrice] ?? 0;
  if (map.sellingPrice) {
    normalized.Price = fields[map.sellingPrice] ?? 0;
  } else if (map.costPrice) {
    normalized.Price = fields[map.costPrice] ?? 0;
  }
  if (map.stock) normalized["Balance Stock"] = fields[map.stock] ?? 0;
  if (map.supplier) normalized.Supplier = fields[map.supplier] ?? "";
  if (map.supplierSku) {
    normalized["ALV Supplier Code"] = fields[map.supplierSku] ?? "";
  }

  return { ...record, fields: normalized };
}

export async function getProducts({
  search = "",
  offset = "",
  pageSize = "50",
}: {
  search?: string;
  offset?: string;
  pageSize?: string;
}) {
  const airtable = await getCurrentAirtableBase();

  if (!airtable.canView) {
    throw {
      status: 403,
      message: "You do not have permission to view products",
    };
  }

  const productTable = await resolveProductTableName(
    airtable.baseId,
    airtable.token,
    airtable.tables.products || "Products"
  );

  const map = await getProductFieldMap(
    airtable.baseId,
    airtable.token,
    productTable
  );

  const params = new URLSearchParams();
  params.set(
    "pageSize",
    String(Math.min(Math.max(Number(pageSize) || 50, 1), 100))
  );

  if (offset) params.set("offset", offset);

  const query = search.trim();

  if (query) {
    const safeQuery = escapeAirtableString(query);

    params.set(
      "filterByFormula",
      `FIND(LOWER('${safeQuery}'), LOWER({${map.sku}} & '')) > 0`
    );
  }

  const data = await airtableFetch({
    baseId: airtable.baseId,
    token: airtable.token,
    table: productTable,
    params,
  });

  return {
    ...data,
    records: (data.records || []).map((record: any) =>
      normalizeProductRecord(record, map)
    ),
  };
}

export async function createProduct(input: {
  sku: string;
  supplierSku?: string;
  supplier?: string;
  cp?: number;
  price?: number;
  imageUrl?: string;
}) {
  const airtable = await getCurrentAirtableBase();

  if (!airtable.canEdit) {
    throw {
      status: 403,
      message: "You do not have permission to create products",
    };
  }

  const productTable = await resolveProductTableName(
    airtable.baseId,
    airtable.token,
    airtable.tables.products || "Products"
  );

  const map = await getProductFieldMap(
    airtable.baseId,
    airtable.token,
    productTable
  );

  const sku = String(input.sku || "").trim();

  if (!sku) {
    throw {
      status: 400,
      message: "SKU is required",
    };
  }

  const fields: Record<string, any> = {
    [map.sku]: sku,
  };

  if (map.supplierSku && String(input.supplierSku || "").trim()) {
    fields[map.supplierSku] = String(input.supplierSku).trim();
  }

  if (map.supplier && String(input.supplier || "").trim()) {
    fields[map.supplier] = String(input.supplier).trim();
  }

  if (map.costPrice) {
    fields[map.costPrice] = Number(input.cp) || 0;
  }

  if (map.sellingPrice) {
    fields[map.sellingPrice] =
      Number(input.price) || Number(input.cp) || 0;
  }

  if (map.image && String(input.imageUrl || "").trim()) {
    fields[map.image] = [
      {
        url: String(input.imageUrl).trim(),
      },
    ];
  }

  const record = await airtableFetch({
    baseId: airtable.baseId,
    token: airtable.token,
    table: productTable,
    method: "POST",
    fields: {
      fields,
    },
  });

  return normalizeProductRecord(record, map);
}

