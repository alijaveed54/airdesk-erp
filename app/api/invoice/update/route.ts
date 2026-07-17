import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import { createAuditLog } from "@/lib/audit";

type AirtableSchemaField = {
  id?: string;
  name: string;
  type?: string;
};

function isReadOnlyField(field?: AirtableSchemaField) {
  return !!field && [
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
  ].includes(field.type || "");
}

function isSafeSelectValue(value: any) {
  const text = String(value || "").trim();

  if (!text) return false;
  if (text.toLowerCase().includes("customer will return")) return false;

  return true;
}

function findFieldName(
  fields: AirtableSchemaField[],
  candidates: string[]
): string {
  const normalized = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field.name])
  );

  for (const candidate of candidates) {
    const found = normalized.get(candidate.trim().toLowerCase());
    if (found) return found;
  }

  return "";
}

async function getInvoiceSchema({
  baseId,
  token,
  tableName,
}: {
  baseId: string;
  token: string;
  tableName: string;
}) {
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
      data?.error?.message || "Unable to load invoice schema"
    );
  }

  const table = (data.tables || []).find(
    (item: any) => item.name === tableName
  );

  if (!table) {
    throw new Error(`Invoice table not found: ${tableName}`);
  }

  return (table.fields || []) as AirtableSchemaField[];
}

export async function PATCH(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to edit invoice",
        },
        { status: 403 }
      );
    }

    const body = await req.json();
    const recordId = body.recordId;

    if (!recordId) {
      return NextResponse.json(
        {
          success: false,
          message: "Invoice record ID is required",
        },
        { status: 400 }
      );
    }

    const invoiceTable =
      airtable.tables.invoice || "BS Invoice";

    const schemaFields = await getInvoiceSchema({
      baseId: airtable.baseId,
      token: airtable.token,
      tableName: invoiceTable,
    });

    const fieldMap = {
      shipping: findFieldName(schemaFields, [
        "shipping",
        "Shipping",
        "Shipping Amount",
        "Shipping Charges",
        "Delivery Charges",
      ]),
      discount: findFieldName(schemaFields, [
        "discount",
        "Discount",
        "Discount Amount",
      ]),
      vat: findFieldName(schemaFields, [
        "vat",
        "VAT",
      ]),
      advancePayment: findFieldName(schemaFields, [
        "Advance Payment",
        "advancePayment",
        "Advance",
        "Advance Amount",
      ]),
      totalAdjustment: findFieldName(schemaFields, [
        "Total Adjustment",
        "totalAdjustment",
        "Adjustment",
        "Total Adjustments",
      ]),
      replacement: findFieldName(schemaFields, [
        "Replacement",
        "replacement",
      ]),
      returnItemsValue: findFieldName(
        schemaFields.filter((field) => !isReadOnlyField(field)),
        [
          "Return Items Value",
          "returnItemsValue",
          "Return Order Value",
        ]
      ),
      store: findFieldName(schemaFields, [
        "Select Store",
        "Store",
        "store",
      ]),
      status: findFieldName(schemaFields, [
        "order_status",
        "Order_status",
        "Order Status",
        "Status",
      ]),
      despatchDate: findFieldName(schemaFields, [
        "Despatch Date",
        "Dispatch Date",
        "dispatch_date",
      ]),
    };

    const fields: Record<string, any> = {};

    if (fieldMap.shipping) {
      fields[fieldMap.shipping] = Number(body.shipping || 0);
    }

    if (fieldMap.discount) {
      fields[fieldMap.discount] = Number(body.discount || 0);
    }

    if (fieldMap.vat) {
      fields[fieldMap.vat] = Number(body.vat || 0);
    }

    if (fieldMap.advancePayment) {
      fields[fieldMap.advancePayment] =
        Number(body.advancePayment || 0);
    }

    if (fieldMap.totalAdjustment) {
      fields[fieldMap.totalAdjustment] =
        Number(body.totalAdjustment || 0);
    }

    if (fieldMap.replacement) {
      fields[fieldMap.replacement] = !!body.replacement;
    }

    // Return Items Value is relevant only when Replacement is enabled.
    // Some i5Q/DQ invoice tables do not contain this field, so never send
    // a zero value merely because the frontend included returnItemsValue.
    if (body.replacement === true && fieldMap.returnItemsValue) {
      const targetField = schemaFields.find(
        (field) => field.name === fieldMap.returnItemsValue
      );

      if (!isReadOnlyField(targetField)) {
        fields[fieldMap.returnItemsValue] =
          Number(body.returnItemsValue || 0);
      }
    }

    if (fieldMap.store && isSafeSelectValue(body.store)) {
      fields[fieldMap.store] = body.store;
    }

    if (fieldMap.status && isSafeSelectValue(body.status)) {
      fields[fieldMap.status] = body.status;

      if (
        body.status === "Dispatched" &&
        fieldMap.despatchDate
      ) {
        fields[fieldMap.despatchDate] =
          new Date().toISOString().slice(0, 10);
      }
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "No editable invoice fields were found for this base",
        },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${airtableUrl(
        airtable.baseId,
        invoiceTable
      )}/${recordId}`,
      {
        method: "PATCH",
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
        body: JSON.stringify({ fields }),
      }
    );

    const responseText = await response.text();

    let data: any = null;

    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.log("Invoice Update Sent Fields:", fields);
      console.log("Invoice Update Error:", data);

      return NextResponse.json(
        {
          success: false,
          message:
            data?.error?.message ||
            data?.error?.error?.message ||
            "Invoice update failed",
          error: data,
        },
        { status: response.status }
      );
    }

    await createAuditLog({
      module: "Invoice",
      action: "Invoice Update",
      recordId,
      recordLabel: data?.fields?.Number
        ? String(data.fields.Number)
        : recordId,
      newValue: JSON.stringify(fields),
    });

    return NextResponse.json({
      success: true,
      record: data,
      updatedFields: fields,
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
