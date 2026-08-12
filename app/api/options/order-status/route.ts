import { NextResponse } from "next/server";
import {
  airtableUrl,
  getCurrentAirtableBase,
  getInvoiceFieldMap,
  handleApiError,
} from "@/lib/airtable";

function normalizeName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function valuesFromField(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  const text = String(value || "").trim();
  return text ? [text] : [];
}

function uniqueOptions(values: unknown[]) {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();

    if (!text || seen.has(key)) continue;

    seen.add(key);
    options.push(text);
  }

  return options;
}

export async function GET() {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view order statuses",
        },
        { status: 403 }
      );
    }

    const invoiceTableName = airtable.tables.invoice || "BS Invoice";
    const invoiceFieldMap = await getInvoiceFieldMap(
      airtable.baseId,
      airtable.token,
      invoiceTableName
    );

    const metadataResponse = await fetch(
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

    const metadata = await metadataResponse.json();

    if (!metadataResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            metadata?.error?.message ||
            `Unable to load Airtable metadata (${metadataResponse.status})`,
          error: metadata,
        },
        { status: metadataResponse.status }
      );
    }

    const invoiceTable = (metadata.tables || []).find(
      (table: any) => table.name === invoiceTableName
    );

    if (!invoiceTable) {
      return NextResponse.json(
        {
          success: false,
          message: `Invoice table not found: ${invoiceTableName}`,
        },
        { status: 404 }
      );
    }

    const expectedStatusName = normalizeName(invoiceFieldMap.status);
    const statusField = (invoiceTable.fields || []).find(
      (field: any) => normalizeName(field.name) === expectedStatusName
    );

    if (!statusField) {
      return NextResponse.json(
        {
          success: false,
          message: `Order status field not found in ${invoiceTableName}`,
        },
        { status: 404 }
      );
    }

    const configuredChoices = Array.isArray(statusField?.options?.choices)
      ? statusField.options.choices.map((choice: any) => choice?.name)
      : [];

    let observedValues: string[] = [];

    // Single-select fields normally expose choices in metadata. This fallback
    // also supports legacy text/formula fields without returning an empty list.
    if (configuredChoices.length === 0) {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      params.append("fields[]", statusField.name);

      const recordsResponse = await fetch(
        airtableUrl(airtable.baseId, invoiceTableName, params),
        {
          headers: {
            Authorization: `Bearer ${airtable.token}`,
          },
          cache: "no-store",
        }
      );

      if (recordsResponse.ok) {
        const recordsData = await recordsResponse.json();
        observedValues = (recordsData.records || []).flatMap((record: any) =>
          valuesFromField(record?.fields?.[statusField.name])
        );
      }
    }

    const options = uniqueOptions([
      ...configuredChoices,
      ...observedValues,
    ]);

    return NextResponse.json({
      success: true,
      options,
      statusOptions: options,
      tableName: invoiceTableName,
      fieldName: statusField.name,
    });
  } catch (error) {
    return handleApiError(error, "Order status options failed");
  }
}
