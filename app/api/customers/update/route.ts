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
};

type SchemaTable = {
  id: string;
  name: string;
  fields: SchemaField[];
};

const schemaCache = new Map<string, SchemaTable[]>();

function findField(fields: SchemaField[], candidates: string[]) {
  const lookup = new Map(
    fields.map((field) => [
      field.name.trim().toLowerCase(),
      field.name,
    ])
  );

  for (const candidate of candidates) {
    const found = lookup.get(candidate.trim().toLowerCase());

    if (found) {
      return found;
    }
  }

  return "";
}

async function getSchema(baseId: string, token: string) {
  const cached = schemaCache.get(baseId);

  if (cached) {
    return cached;
  }

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

  const tables = (data.tables || []) as SchemaTable[];
  schemaCache.set(baseId, tables);

  return tables;
}

export async function PATCH(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to update customers",
        },
        { status: 403 }
      );
    }

    const body = await req.json();
    const recordId = String(body.recordId || "").trim();

    if (!recordId) {
      return NextResponse.json(
        {
          success: false,
          message: "Customer record ID is required",
        },
        { status: 400 }
      );
    }

    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );

    const configuredCustomerTable =
      airtable.tables?.customers || "";

    const customerTable =
      schema.find(
        (table) => table.name === configuredCustomerTable
      ) ||
      schema.find((table) =>
        ["Customers", "Customer"].includes(table.name)
      );

    if (!customerTable) {
      return NextResponse.json(
        {
          success: false,
          message: "Customer table not found in selected base",
        },
        { status: 404 }
      );
    }

    const nameField = findField(customerTable.fields, [
      "Customer Name",
      "Name",
      "Consignee",
      "Full Name",
    ]);

    const mobileField = findField(customerTable.fields, [
      "Contact No.",
      "Contact No",
      "Contact",
      "Mobile Number",
      "Mobile",
      "Phone",
      "Telephone1",
    ]);

    const addressField = findField(customerTable.fields, [
      "Address",
      "Customer Address",
      "Billing Address Line 1",
      "Consignee Address 1",
    ]);

    const cityField = findField(customerTable.fields, [
      "City Name",
      "City",
      "Billing Address City",
    ]);

    const countryField = findField(customerTable.fields, [
      "Area Name",
      "Country",
      "Billing Address Country",
      "Area",
    ]);

    const fields: Record<string, unknown> = {};

    if (body.name !== undefined && nameField) {
      fields[nameField] = String(body.name || "");
    }

    if (body.mobile !== undefined && mobileField) {
      fields[mobileField] = String(body.mobile || "");
    }

    if (body.address !== undefined && addressField) {
      fields[addressField] = String(body.address || "");
    }

    if (body.city !== undefined && cityField) {
      fields[cityField] = String(body.city || "");
    }

    if (body.country !== undefined && countryField) {
      fields[countryField] = String(body.country || "");
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "No matching editable customer fields were found in selected base",
        },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${airtableUrl(
        airtable.baseId,
        customerTable.name
      )}/${recordId}`,
      {
        method: "PATCH",
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
        body: JSON.stringify({
          fields,
          typecast: false,
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
            "Customer update failed",
          error: data,
          tableName: customerTable.name,
          sentFields: Object.keys(fields),
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      record: data,
      tableName: customerTable.name,
      updatedFields: Object.keys(fields),
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
