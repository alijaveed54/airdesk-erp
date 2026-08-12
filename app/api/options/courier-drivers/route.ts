import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type CourierBasePermission = {
  baseName: string;
  baseId: string;
  airtableToken?: string;
  invoiceTable?: string;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function firstValue(value: unknown) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Not authenticated",
        },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const baseId = searchParams.get("baseId") || "";

    if (!baseId) {
      return NextResponse.json({
        success: true,
        options: [],
      });
    }

    const base = session.permissions.find(
      (item) => String(item.baseId) === String(baseId),
    ) as CourierBasePermission | undefined;

    if (!base) {
      return NextResponse.json(
        {
          success: false,
          message: "Base access denied",
        },
        { status: 403 },
      );
    }

    const token =
      process.env.AIRTABLE_TOKEN ||
      process.env.AUTH_AIRTABLE_TOKEN ||
      base.airtableToken;

    if (!token) {
      throw new Error("Airtable token missing");
    }

    const schemaResponse = await fetch(
      `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    const schema = await schemaResponse.json();

    if (!schemaResponse.ok) {
      throw new Error(
        schema?.error?.message ||
          schema?.error?.error?.message ||
          "Schema loading failed",
      );
    }

    const invoiceTableName = base.invoiceTable || "BS Invoice";

    const invoiceTable = (schema.tables || []).find(
      (table: any) => table.name === invoiceTableName,
    );

    if (!invoiceTable) {
      return NextResponse.json({
        success: true,
        options: [],
      });
    }

    const fields = invoiceTable.fields || [];

    const courierField = fields.find((field: any) =>
      [
        "Courier",
        "Courier Name",
        "Driver",
        "Driver Name",
      ].includes(field.name),
    );

    if (!courierField) {
      return NextResponse.json({
        success: true,
        options: [],
      });
    }

    const recordsResponse = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        invoiceTable.name,
      )}?fields[]=${encodeURIComponent(courierField.name)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    const records = await recordsResponse.json();

    if (!recordsResponse.ok) {
      throw new Error(
        records?.error?.message ||
          records?.error?.error?.message ||
          "Courier loading failed",
      );
    }

    const options = Array.from(
      new Set<string>(
        (records.records || [])
          .map((record: any) =>
            normalize(firstValue(record.fields?.[courierField.name])),
          )
          .filter((value: string) => Boolean(value)),
      ),
    );

    return NextResponse.json({
      success: true,
      options,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Courier loading failed",
      },
      {
        status: 500,
      },
    );
  }
}
