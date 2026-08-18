import { NextRequest, NextResponse } from "next/server";
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
    choices?: Array<{ name: string }>;
    linkedTableId?: string;
    recordLinkFieldId?: string;
    fieldIdInLinkedTable?: string;
  };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: SchemaField[];
};

type FieldConfig = {
  orderNo?: SchemaField;
  sku?: SchemaField;
  quantity?: SchemaField;
  image?: SchemaField;
  supplier?: SchemaField;
  billNo?: SchemaField;
  receivedInWh1?: SchemaField;
  orderStatus?: SchemaField;
  dispatchedFromUae?: SchemaField;
  dispatchDate?: SchemaField;
};

const READONLY_TYPES = new Set([
  "formula",
  "rollup",
  "count",
  "multipleLookupValues",
  "createdTime",
  "lastModifiedTime",
  "autoNumber",
  "button",
]);

function getRole(airtable: unknown): string {
  const source = airtable as Record<string, any>;

  return String(
    source?.role ??
      source?.userRole ??
      source?.accountRole ??
      source?.user?.role ??
      source?.session?.role ??
      source?.permissions?.role ??
      ""
  )
    .trim()
    .toLowerCase();
}

function isSupplierRole(airtable: unknown) {
  return getRole(airtable).includes("supplier");
}

function isFabDohaNonStockBase(baseName: unknown) {
  const normalized = String(baseName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  const isFabOrDoha =
    normalized.includes("fab") || normalized.includes("doha");

  const isNonStock =
    normalized.includes("non stock") ||
    normalized.includes("without stock");

  return isFabOrDoha && isNonStock;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
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
    ).trim();
  }

  return String(resolved).trim();
}

function numberValue(value: unknown): number {
  const parsed = Number(first(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

type AirtableAttachment = {
  url?: string;
  filename?: string;
  thumbnails?: {
    small?: { url?: string };
    large?: { url?: string };
    full?: { url?: string };
  };
};

function getFirstAttachment(value: unknown): AirtableAttachment | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const attachment = getFirstAttachment(item);
      if (attachment) return attachment;
    }

    return null;
  }

  if (!value || typeof value !== "object") return null;

  const candidate = value as AirtableAttachment;
  if (typeof candidate.url === "string" && candidate.url.trim()) {
    return candidate;
  }

  return null;
}

function isAllowedAirtableImageUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (hostname === "dl.airtable.com" ||
        hostname.endsWith(".airtableusercontent.com"))
    );
  } catch {
    return false;
  }
}

function makeImageProxyUrl(value: string) {
  if (!value) return "";

  return `/api/orders/uae-dispatch?image=${encodeURIComponent(value)}`;
}

async function proxyAirtableImage(value: string) {
  if (!isAllowedAirtableImageUrl(value)) {
    return NextResponse.json(
      { success: false, message: "Invalid image URL" },
      { status: 400 }
    );
  }

  const response = await fetch(value, {
    cache: "no-store",
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    return NextResponse.json(
      { success: false, message: "Image could not be loaded" },
      { status: response.status || 404 }
    );
  }

  return new NextResponse(response.body, {
    status: 200,
    headers: {
      "Content-Type":
        response.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
}

function getOrderNumberValue(value: string): number {
  const digits = value.match(/\d+/g);
  if (!digits) return -1;

  const parsed = Number(digits.join(""));
  return Number.isFinite(parsed) ? parsed : -1;
}

function compareOrderNumbersDescending(
  firstItem: { orderNo: string; sku: string },
  secondItem: { orderNo: string; sku: string }
) {
  const numberDifference =
    getOrderNumberValue(secondItem.orderNo) -
    getOrderNumberValue(firstItem.orderNo);

  if (numberDifference !== 0) return numberDifference;

  const orderDifference = secondItem.orderNo.localeCompare(
    firstItem.orderNo,
    undefined,
    { numeric: true, sensitivity: "base" }
  );

  if (orderDifference !== 0) return orderDifference;

  return firstItem.sku.localeCompare(secondItem.sku, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function findField(
  fields: SchemaField[],
  candidates: string[]
): SchemaField | undefined {
  const lookup = new Map(
    fields.map((field) => [
      field.name.trim().toLowerCase(),
      field,
    ])
  );

  for (const candidate of candidates) {
    const field = lookup.get(candidate.trim().toLowerCase());
    if (field) return field;
  }

  return undefined;
}

function getFieldConfig(fields: SchemaField[]): FieldConfig {
  return {
    orderNo: findField(fields, [
      "Order Number",
      "Order No.",
      "Order No",
      "order_no",
      "order_no.",
      "Invoice No",
      "order no. (QB)",
    ]),
    sku: findField(fields, [
      "Item Code",
      "SKU",
      "sku",
      "Product",
      "Product SKU",
    ]),
    quantity: findField(fields, [
      "quantity",
      "Quantity",
      "Qty",
      "QTY",
    ]),
    image: findField(fields, [
      "image",
      "Image",
      "Product Image",
      "Item Image",
    ]),
    supplier: findField(fields, [
      "Supplier",
      "Purchase Supplier",
    ]),
    billNo: findField(fields, [
      "bill_no",
      "Bill No",
      "Bill No.",
      "Bill Number",
    ]),
    receivedInWh1: findField(fields, [
      "received_in_wh_1",
      "Received In WH 1",
      "Received in WH 1",
      "Received In Warehouse 1",
      "Received in Warehouse 1",
    ]),
    orderStatus: findField(fields, [
      "Order Status",
      "Order_status",
      "order_status",
      "Order_Status",
    ]),
    dispatchedFromUae: findField(fields, [
      "Dispatched From UAE",
      "Dispatched from UAE",
      "dispatched_from_uae",
      "dispatched_from_wh_1",
      "Dispatched From WH 1",
      "Dispatched from WH 1",
      "Dispatched",
    ]),
    dispatchDate: findField(fields, [
      "dispatch_date_from_WH1",
      "Dispatch Date From WH 1",
      "Dispatch Date from WH 1",
    ]),
  };
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

function escapeFormulaValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function containsFormula(fieldName: string, value: string) {
  return `FIND(LOWER('${escapeFormulaValue(
    value
  )}'),LOWER({${fieldName}}&''))>0`;
}

function buildSearchFormula(config: FieldConfig, query: string) {
  if (!query) return "";

  const searchableFields = [
    config.orderNo,
    config.sku,
    config.supplier,
    config.billNo,
  ].filter((field): field is SchemaField => Boolean(field));

  if (searchableFields.length === 0) return "";

  const formulas = searchableFields.map((field) =>
    containsFormula(field.name, query)
  );

  return formulas.length === 1
    ? formulas[0]
    : `OR(${formulas.join(",")})`;
}

async function resolveLinkedValues({
  baseId,
  token,
  schema,
  field,
  records,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  field?: SchemaField;
  records: any[];
}) {
  const values = new Map<string, string>();

  if (
    !field ||
    field.type !== "multipleRecordLinks" ||
    !field.options?.linkedTableId
  ) {
    return values;
  }

  const linkedTable = schema.find(
    (table) => table.id === field.options?.linkedTableId
  );

  if (!linkedTable) return values;

  const primaryField =
    linkedTable.fields.find(
      (item) => item.id === linkedTable.primaryFieldId
    ) || linkedTable.fields[0];

  if (!primaryField) return values;

  const recordIds = Array.from(
    new Set(
      records
        .flatMap((record) => {
          const value = record.fields?.[field.name];
          return Array.isArray(value) ? value : value ? [value] : [];
        })
        .filter(
          (value): value is string =>
            typeof value === "string" && value.startsWith("rec")
        )
    )
  );

  for (let start = 0; start < recordIds.length; start += 40) {
    const batch = recordIds.slice(start, start + 40);
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
    params.append("fields[]", primaryField.name);

    const response = await fetch(
      airtableUrl(baseId, linkedTable.name, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to resolve linked values from ${linkedTable.name}`
      );
    }

    for (const record of data.records || []) {
      values.set(record.id, text(record.fields?.[primaryField.name]));
    }
  }

  return values;
}

async function resolveLinkedProductImages({
  baseId,
  token,
  schema,
  skuField,
  records,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  skuField?: SchemaField;
  records: any[];
}) {
  const images = new Map<string, AirtableAttachment>();

  if (
    !skuField ||
    skuField.type !== "multipleRecordLinks" ||
    !skuField.options?.linkedTableId
  ) {
    return images;
  }

  const productTable = schema.find(
    (table) => table.id === skuField.options?.linkedTableId
  );

  if (!productTable) return images;

  const imageField = findField(productTable.fields || [], [
    "Image",
    "image",
    "Product Image",
    "Item Image",
  ]);

  if (!imageField) return images;

  const productIds = Array.from(
    new Set(
      records
        .flatMap((record) => {
          const rawValue = record.fields?.[skuField.name];
          return Array.isArray(rawValue)
            ? rawValue
            : rawValue
              ? [rawValue]
              : [];
        })
        .filter(
          (value): value is string =>
            typeof value === "string" && value.startsWith("rec")
        )
    )
  );

  for (let start = 0; start < productIds.length; start += 40) {
    const batch = productIds.slice(start, start + 40);
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
    params.append("fields[]", imageField.name);

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
          `Unable to load product images from ${productTable.name}`
      );
    }

    for (const record of data.records || []) {
      const attachment = getFirstAttachment(
        record.fields?.[imageField.name]
      );

      if (attachment) {
        images.set(record.id, attachment);
      }
    }
  }

  return images;
}

function firstLinkedRecordId(value: unknown) {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  const recordId = values.find(
    (item) =>
      typeof item === "string" && item.startsWith("rec")
  );

  return typeof recordId === "string" ? recordId : "";
}

function linkedText(
  rawValue: unknown,
  resolvedValues: Map<string, string>
) {
  const values = Array.isArray(rawValue)
    ? rawValue
    : rawValue
      ? [rawValue]
      : [];

  return values
    .map((value) => {
      const raw = String(value ?? "").trim();
      return resolvedValues.get(raw) || raw;
    })
    .filter(Boolean)
    .join(", ");
}

function normalizeDispatchedValue(
  field: SchemaField,
  rawValue: unknown
): string | boolean {
  if (field.type === "checkbox") {
    return Boolean(rawValue);
  }

  return text(rawValue);
}

function writableDispatchedValue(
  field: SchemaField,
  rawValue: unknown
) {
  if (READONLY_TYPES.has(field.type)) {
    throw new Error(
      `${field.name} is not an editable Airtable field`
    );
  }

  const value = String(rawValue ?? "").trim();

  if (field.type === "checkbox") {
    return value.toLowerCase() === "yes" || value === "true";
  }

  if (field.type === "singleSelect") {
    if (!value) return null;

    const choices =
      field.options?.choices?.map((choice) => choice.name) || [];

    const canonical =
      choices.find(
        (choice) =>
          choice.trim().toLowerCase() === value.toLowerCase()
      ) || value;

    return canonical;
  }

  return value || null;
}

function writableDateValue(
  field: SchemaField,
  rawValue: unknown
) {
  if (READONLY_TYPES.has(field.type)) {
    throw new Error(
      `${field.name} is not an editable Airtable field`
    );
  }

  const value = String(rawValue ?? "").trim();

  if (!value) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Dispatch Date must be in YYYY-MM-DD format");
  }

  return value;
}

export async function GET(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!isFabDohaNonStockBase(airtable.baseName)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "UAE Dispatch Update is available only in FAB Doha Non Stock. Please switch the selected business base.",
        },
        { status: 409 }
      );
    }

    if (isSupplierRole(airtable)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Supplier accounts cannot access UAE Dispatch Update",
        },
        { status: 403 }
      );
    }

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to view order items",
        },
        { status: 403 }
      );
    }

    const requestUrl = new URL(request.url);
    const requestedImageUrl = requestUrl.searchParams.get("image") || "";

    if (requestedImageUrl) {
      return proxyAirtableImage(requestedImageUrl);
    }

    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );
    const tableName =
      airtable.tables?.orderEntry || "BS Order Entry";
    const table = schema.find(
      (item) => item.name === tableName
    );

    if (!table) {
      return NextResponse.json(
        {
          success: false,
          message: `Order Entry table not found: ${tableName}`,
        },
        { status: 404 }
      );
    }

    const config = getFieldConfig(table.fields || []);

    if (!config.orderNo && !config.sku) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Order Number and SKU fields were not found in this Order Entry table",
        },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const requestedPageSize = Number(
      searchParams.get("pageSize") || "100"
    );
    const pageSize = Math.min(
      Math.max(
        Number.isFinite(requestedPageSize)
          ? requestedPageSize
          : 100,
        1
      ),
      100
    );
    const query = (
      searchParams.get("q") || ""
    ).trim();
    const offset = (
      searchParams.get("offset") || ""
    ).trim();

    const params = new URLSearchParams({
      pageSize: String(pageSize),
    });

    if (offset) params.set("offset", offset);

    if (config.orderNo) {
      params.set("sort[0][field]", config.orderNo.name);
      params.set("sort[0][direction]", "desc");
    }

    if (!config.orderStatus) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Order Status field was not found in the FAB Doha Non Stock Order Entry table",
        },
        { status: 400 }
      );
    }

    if (!config.billNo) {
      return NextResponse.json(
        {
          success: false,
          message:
            "bill_no field was not found in the FAB Doha Non Stock Order Entry table",
        },
        { status: 400 }
      );
    }

    if (!config.receivedInWh1) {
      return NextResponse.json(
        {
          success: false,
          message:
            "received_in_wh_1 field was not found in the FAB Doha Non Stock Order Entry table",
        },
        { status: 400 }
      );
    }

    const statusFormula = `OR(LOWER({${config.orderStatus.name}}&'')='order received',LOWER({${config.orderStatus.name}}&'')='processing')`;
    const billNumberFormula = `AND(LEN(TRIM({${config.billNo.name}}&''))>0,LOWER(TRIM({${config.billNo.name}}&''))!='stock out',LOWER(TRIM({${config.billNo.name}}&''))!='sold out')`;
    const receivedInWh1Formula = `LOWER(TRIM({${config.receivedInWh1.name}}&''))='yes'`;
    const searchFormula = buildSearchFormula(config, query);

    const requiredFormula = `AND(${statusFormula},${billNumberFormula},${receivedInWh1Formula})`;

    params.set(
      "filterByFormula",
      searchFormula
        ? `AND(${requiredFormula},${searchFormula})`
        : requiredFormula
    );

    const requestedFields = Array.from(
      new Set(
        Object.values(config)
          .filter(
            (field): field is SchemaField => Boolean(field)
          )
          .map((field) => field.name)
      )
    );

    requestedFields.forEach((field) =>
      params.append("fields[]", field)
    );

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
          "Unable to load UAE dispatch items"
      );
    }

    const records = data.records || [];

    const orderValues = await resolveLinkedValues({
      baseId: airtable.baseId,
      token: airtable.token,
      schema,
      field: config.orderNo,
      records,
    });

    const skuValues = await resolveLinkedValues({
      baseId: airtable.baseId,
      token: airtable.token,
      schema,
      field: config.sku,
      records,
    });

    const productImages = await resolveLinkedProductImages({
      baseId: airtable.baseId,
      token: airtable.token,
      schema,
      skuField: config.sku,
      records,
    });

    const items = records.map((record: any) => {
      const fields = record.fields || {};

      const orderNo =
        config.orderNo?.type === "multipleRecordLinks"
          ? linkedText(fields[config.orderNo.name], orderValues)
          : config.orderNo
            ? text(fields[config.orderNo.name])
            : "";

      const sku =
        config.sku?.type === "multipleRecordLinks"
          ? linkedText(fields[config.sku.name], skuValues)
          : config.sku
            ? text(fields[config.sku.name])
            : "";

      const lookupAttachment = config.image
        ? getFirstAttachment(fields[config.image.name])
        : null;

      const productRecordId = config.sku
        ? firstLinkedRecordId(fields[config.sku.name])
        : "";

      const attachment =
        lookupAttachment || productImages.get(productRecordId) || null;

      const fullImageUrl = attachment?.url || "";
      const thumbnailImageUrl =
        attachment?.thumbnails?.large?.url ||
        attachment?.thumbnails?.small?.url ||
        fullImageUrl;

      return {
        id: record.id,
        orderNo,
        sku,
        imageUrl: makeImageProxyUrl(fullImageUrl),
        imageThumbnailUrl: makeImageProxyUrl(thumbnailImageUrl),
        quantity: config.quantity
          ? numberValue(fields[config.quantity.name])
          : 0,
        supplier: config.supplier
          ? text(fields[config.supplier.name])
          : "",
        billNo: config.billNo
          ? text(fields[config.billNo.name])
          : "",
        orderStatus: config.orderStatus
          ? text(fields[config.orderStatus.name])
          : "",
        dispatchedFromUae: config.dispatchedFromUae
          ? normalizeDispatchedValue(
              config.dispatchedFromUae,
              fields[config.dispatchedFromUae.name]
            )
          : "",
        dispatchDate: config.dispatchDate
          ? text(fields[config.dispatchDate.name])
          : "",
      };
    }).sort(compareOrderNumbersDescending);

    return NextResponse.json({
      success: true,
      items,
      nextOffset: data.offset || "",
      baseName: airtable.baseName,
      tableName,
      capabilities: {
        hasDispatchedField: Boolean(
          config.dispatchedFromUae
        ),
        hasDispatchDateField: Boolean(
          config.dispatchDate
        ),
      },
    });
  } catch (error) {
    return handleApiError(
      error,
      "Unable to load UAE dispatch items"
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!isFabDohaNonStockBase(airtable.baseName)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "UAE Dispatch Update is available only in FAB Doha Non Stock. Please switch the selected business base.",
        },
        { status: 409 }
      );
    }

    if (isSupplierRole(airtable)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Supplier accounts cannot access UAE Dispatch Update",
        },
        { status: 403 }
      );
    }

    if (!airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to update order items",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    const requestedRecordIds = Array.isArray(body?.recordIds)
      ? body.recordIds
      : [body?.recordId];

    const recordIds = Array.from(
      new Set(
        requestedRecordIds
          .map((value: unknown) => String(value || "").trim())
          .filter((value: string) => value.startsWith("rec"))
      )
    );

    if (recordIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "At least one valid record ID is required",
        },
        { status: 400 }
      );
    }

    if (recordIds.length > 500) {
      return NextResponse.json(
        {
          success: false,
          message: "Maximum 500 item lines can be updated at one time",
        },
        { status: 400 }
      );
    }

    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );
    const tableName =
      airtable.tables?.orderEntry || "BS Order Entry";
    const table = schema.find(
      (item) => item.name === tableName
    );

    if (!table) {
      return NextResponse.json(
        {
          success: false,
          message: `Order Entry table not found: ${tableName}`,
        },
        { status: 404 }
      );
    }

    const config = getFieldConfig(table.fields || []);

    if (
      !config.dispatchedFromUae ||
      !config.dispatchDate
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Dispatched From UAE or Dispatch Date field is missing in this Order Entry table",
        },
        { status: 400 }
      );
    }

    if (
      !config.orderStatus ||
      !config.billNo ||
      !config.receivedInWh1
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Order Status, bill_no, or received_in_wh_1 field is missing in the FAB Doha Non Stock Order Entry table",
        },
        { status: 400 }
      );
    }

    const dispatchedFromUae = String(
      body?.dispatchedFromUae || ""
    ).trim();
    const dispatchDate = String(
      body?.dispatchDate || ""
    ).trim();

    if (
      dispatchedFromUae.toLowerCase() === "yes" &&
      !dispatchDate
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Dispatch Date is required when Dispatched From UAE is Yes",
        },
        { status: 400 }
      );
    }

    const fields = {
      [config.dispatchedFromUae.name]:
        writableDispatchedValue(
          config.dispatchedFromUae,
          dispatchedFromUae
        ),
      [config.dispatchDate.name]: writableDateValue(
        config.dispatchDate,
        dispatchDate
      ),
    };

    const recordIdFormula =
      recordIds.length === 1
        ? `RECORD_ID()='${recordIds[0]}'`
        : `OR(${recordIds
            .map((id) => `RECORD_ID()='${id}'`)
            .join(",")})`;

    const eligibilityFormula = `AND(${recordIdFormula},OR(LOWER({${config.orderStatus.name}}&'')='order received',LOWER({${config.orderStatus.name}}&'')='processing'),LEN(TRIM({${config.billNo.name}}&''))>0,LOWER(TRIM({${config.billNo.name}}&''))!='stock out',LOWER(TRIM({${config.billNo.name}}&''))!='sold out',LOWER(TRIM({${config.receivedInWh1.name}}&''))='yes')`;

    const verificationParams = new URLSearchParams({
      pageSize: "100",
      filterByFormula: eligibilityFormula,
    });

    const eligibleRecordIds: string[] = [];
    let verificationOffset = "";

    do {
      const params = new URLSearchParams(verificationParams);
      if (verificationOffset) {
        params.set("offset", verificationOffset);
      }

      const verificationResponse = await fetch(
        airtableUrl(airtable.baseId, tableName, params),
        {
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
        }
      );

      const verificationData = await verificationResponse.json();

      if (!verificationResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            message:
              verificationData?.error?.message ||
              verificationData?.error?.error?.message ||
              "Unable to verify selected UAE dispatch items",
          },
          { status: verificationResponse.status }
        );
      }

      eligibleRecordIds.push(
        ...(verificationData.records || []).map(
          (record: { id: string }) => record.id
        )
      );
      verificationOffset = verificationData.offset || "";
    } while (verificationOffset);

    if (eligibleRecordIds.length !== recordIds.length) {
      return NextResponse.json(
        {
          success: false,
          message:
            "One or more selected item lines no longer match the UAE Dispatch list conditions. Refresh the page and try again.",
        },
        { status: 409 }
      );
    }

    let updatedRecords = 0;

    for (let index = 0; index < eligibleRecordIds.length; index += 10) {
      const batch = eligibleRecordIds.slice(index, index + 10);

      const response = await fetch(
        airtableUrl(airtable.baseId, tableName),
        {
          method: "PATCH",
          headers: {
            ...airtableHeaders(airtable.token),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            records: batch.map((id) => ({
              id,
              fields,
            })),
            typecast: true,
          }),
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
              "UAE dispatch bulk update failed",
            updatedRecords,
            error: data,
          },
          { status: response.status }
        );
      }

      updatedRecords += (data.records || []).length;
    }

    return NextResponse.json({
      success: true,
      updatedRecords,
    });
  } catch (error) {
    return handleApiError(
      error,
      "UAE dispatch update failed"
    );
  }
}