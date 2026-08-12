import { NextRequest, NextResponse } from "next/server";
import { auditedFetch as fetch } from "@/lib/audit-airtable-fetch";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import {
  resolveInvoiceIdsForOrderEntryRecords,
  syncInvoiceInstockStatuses,
} from "@/lib/order-instock-sync";

type SchemaField = {
  id: string;
  name: string;
  type: string;
  options?: {
    choices?: Array<{ name: string }>;
    linkedTableId?: string;
  };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: SchemaField[];
};

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

function findField(fields: SchemaField[], candidates: string[]) {
  const lookup = new Map(fields.map((field) => [field.name.trim().toLowerCase(), field]));
  for (const candidate of candidates) {
    const found = lookup.get(candidate.trim().toLowerCase());
    if (found) return found;
  }
  return undefined;
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[.]+/g, "")
    .replace(/\s+/g, " ");
}

const ORDER_LINK_FIELD_NAMES = [
  "order no",
  "order number",
  "order",
  "invoice no",
  "invoice number",
  "invoice",
];

function findEditableOrderLinkField(
  fields: SchemaField[],
  schema: SchemaTable[],
  configuredInvoiceTableName: string
) {
  const configuredInvoice = normalizeName(configuredInvoiceTableName);

  const scored = fields
    .filter(
      (field) =>
        field.type === "multipleRecordLinks" &&
        Boolean(field.options?.linkedTableId)
    )
    .map((field) => {
      const linkedTable = schema.find(
        (table) => table.id === field.options?.linkedTableId
      );
      const fieldName = normalizeName(field.name);
      const linkedTableName = normalizeName(linkedTable?.name || "");
      const primaryFieldName = normalizeName(
        linkedTable?.fields.find(
          (linkedField) => linkedField.id === linkedTable.primaryFieldId
        )?.name || ""
      );

      let score = 0;

      if (
        configuredInvoice &&
        linkedTableName === configuredInvoice
      ) {
        score += 1000;
      }

      if (linkedTableName.includes("invoice")) {
        score += 500;
      }

      if (
        ORDER_LINK_FIELD_NAMES.includes(fieldName)
      ) {
        score += 400;
      }

      if (
        ORDER_LINK_FIELD_NAMES.includes(primaryFieldName)
      ) {
        score += 250;
      }

      if (
        fieldName.includes("return") ||
        linkedTableName.includes("return")
      ) {
        score -= 1000;
      }

      return { field, score };
    })
    .sort((first, second) => second.score - first.score);

  return scored[0]?.score > 0
    ? scored[0].field
    : undefined;
}

async function getSchema(baseId: string, token: string) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Unable to load Airtable schema");
  return (data.tables || []) as SchemaTable[];
}

function escapeFormulaText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function resolveLinkedOrderRecordId({
  baseId,
  token,
  schema,
  orderField,
  orderNumber,
}: {
  baseId: string;
  token: string;
  schema: SchemaTable[];
  orderField: SchemaField;
  orderNumber: string;
}) {
  const linkedTableId = orderField.options?.linkedTableId;
  if (!linkedTableId) {
    throw new Error(`${orderField.name} is not configured as a linked Order Number field`);
  }

  const linkedTable = schema.find((item) => item.id === linkedTableId);
  if (!linkedTable) {
    throw new Error("Linked invoice table not found for Order Number");
  }

  const primaryField =
    linkedTable.fields.find((field) => field.id === linkedTable.primaryFieldId) ||
    linkedTable.fields[0];

  if (!primaryField) {
    throw new Error("Order Number field not found in linked invoice table");
  }

  const params = new URLSearchParams({
    pageSize: "2",
    filterByFormula: `LOWER({${primaryField.name}}&'')=LOWER('${escapeFormulaText(orderNumber)}')`,
  });

  const response = await fetch(airtableUrl(baseId, linkedTable.name, params), {
    headers: airtableHeaders(token),
    cache: "no-store",
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to find target Order Number");
  }

  const records = data.records || [];
  if (!records.length) {
    throw new Error(`Order Number "${orderNumber}" not found`);
  }

  return String(records[0].id);
}

function normalizeForAirtable(field: SchemaField, value: unknown) {
  if (field.type === "number" || field.type === "currency" || field.type === "percent") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (field.type === "checkbox") return Boolean(value);
  if (field.type === "singleSelect") {
    const text = String(value ?? "").trim();
    return text || null;
  }
  return String(value ?? "");
}

function isYesValue(value: unknown) {
  if (value === true || value === 1) return true;

  return ["yes", "true", "1", "checked", "received"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase()
  );
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function PATCH(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();
    if (isSupplierRole(airtable)) {
      return NextResponse.json(
        { success: false, message: "Supplier accounts cannot access Quick Edit" },
        { status: 403 }
      );
    }

    if (!airtable.canEdit) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to edit order items" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const recordId = String(body?.recordId || "").trim();
    const changes = body?.changes && typeof body.changes === "object" ? body.changes : {};
    if (!recordId.startsWith("rec")) {
      return NextResponse.json({ success: false, message: "Valid record ID is required" }, { status: 400 });
    }

    const schema = await getSchema(airtable.baseId, airtable.token);
    const tableName = airtable.tables?.orderEntry || "BS Order Entry";
    const table = schema.find((item) => item.name === tableName);
    if (!table) {
      return NextResponse.json({ success: false, message: `Order Entry table not found: ${tableName}` }, { status: 404 });
    }

    const invoiceTableName =
      airtable.tables?.invoice || "BS Invoice";

    let previousInvoiceIds: string[] = [];

    try {
      previousInvoiceIds =
        await resolveInvoiceIdsForOrderEntryRecords({
          baseId: airtable.baseId,
          token: airtable.token,
          orderEntryTableName: tableName,
          invoiceTableName,
          recordIds: [recordId],
        });
    } catch (syncError) {
      console.error(
        "Unable to resolve invoice before Quick Edit:",
        syncError
      );
    }

    const fields = table.fields || [];
    const allowed: Record<string, SchemaField | undefined> = {
      orderNo: findEditableOrderLinkField(
        fields,
        schema,
        airtable.tables?.invoice || ""
      ),
      quantity: findField(fields, ["quantity", "Quantity", "Qty", "QTY"]),
      supplier: findField(fields, ["Supplier", "Purchase Supplier"]),
      billNo: findField(fields, ["bill_no", "Bill No", "Bill No.", "Bill Number"]),
      dispatchedFromIndia: findField(fields, [
        "received_in_wh_1",
        "Received in WH 1",
        "Received In WH 1",
        "Warehouse Received",
      ]),
      receivedInUae: findField(fields, [
        "Received In UAE",
        "Received in UAE",
        "received_in_uae",
      ]),
      soldOut: findField(fields, ["Sold Out", "Supplier Activity"]),
    };

    const airtableFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      const field = allowed[key];
      if (!field) continue;

      if (key === "orderNo") {
        if (field.type !== "multipleRecordLinks") {
          throw new Error(`${field.name} is not an editable linked Order Number field`);
        }

        const orderNumber = String(value ?? "").trim();
        airtableFields[field.name] = orderNumber
          ? [
              await resolveLinkedOrderRecordId({
                baseId: airtable.baseId,
                token: airtable.token,
                schema,
                orderField: field,
                orderNumber,
              }),
            ]
          : [];
        continue;
      }

      if (["formula", "multipleLookupValues", "rollup", "createdTime", "lastModifiedTime"].includes(field.type)) continue;
      airtableFields[field.name] = normalizeForAirtable(field, value);
    }

    if (
      "dispatchedFromIndia" in changes &&
      isYesValue(changes.dispatchedFromIndia) &&
      allowed.receivedInUae
    ) {
      airtableFields[allowed.receivedInUae.name] =
        normalizeForAirtable(
          allowed.receivedInUae,
          "Yes"
        );
    }

    if (
      "orderNo" in changes &&
      !allowed.orderNo
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Editable linked Order Number field was not found in the selected Order Entry table",
        },
        { status: 400 }
      );
    }

    if (!Object.keys(airtableFields).length) {
      return NextResponse.json({ success: false, message: "No editable fields were supplied" }, { status: 400 });
    }

    const response = await fetch(`${airtableUrl(airtable.baseId, tableName)}/${recordId}`, {
      method: "PATCH",
      headers: airtableHeaders(airtable.token),
      body: JSON.stringify({ fields: airtableFields, typecast: true }),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.error?.message || "Order item update failed", error: data },
        { status: response.status }
      );
    }

    let instockSync: unknown = null;

    try {
      let lastSync: unknown = null;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const currentInvoiceIds =
          await resolveInvoiceIdsForOrderEntryRecords({
            baseId: airtable.baseId,
            token: airtable.token,
            orderEntryTableName: tableName,
            invoiceTableName,
            recordIds: [recordId],
          });

        lastSync = await syncInvoiceInstockStatuses({
          baseId: airtable.baseId,
          token: airtable.token,
          orderEntryTableName: tableName,
          invoiceTableName,
          invoiceIds: Array.from(
            new Set([
              ...previousInvoiceIds,
              ...currentInvoiceIds,
            ])
          ),
        });

        const result = lastSync as {
          success?: boolean;
          checked?: Array<{ totalItems?: number }>;
        };
        const loadedItems =
          result.checked?.some(
            (item) => Number(item.totalItems || 0) > 0
          ) || false;

        if (result.success && loadedItems) {
          break;
        }

        if (attempt < 3) {
          await wait(attempt * 350);
        }
      }

      instockSync = lastSync;
    } catch (syncError) {
      console.error("Invoice Instock sync after Quick Edit failed:", syncError);
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
      record: data,
      instockSync,
    });
  } catch (error) {
    console.error("Quick edit update failed:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Quick edit update failed" },
      { status: 500 }
    );
  }
}
