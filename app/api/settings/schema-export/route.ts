import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const AUTH_AIRTABLE_TOKEN = process.env.AUTH_AIRTABLE_TOKEN;
const AUTH_AIRTABLE_BASE_ID = process.env.AUTH_AIRTABLE_BASE_ID;

function authHeaders() {
  return {
    Authorization: `Bearer ${AUTH_AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function readAllRecords(tableName: string) {
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    if (offset) {
      params.set("offset", offset);
    }

    const response = await fetch(
      `https://api.airtable.com/v0/${AUTH_AIRTABLE_BASE_ID}/${encodeURIComponent(
        tableName
      )}?${params.toString()}`,
      {
        headers: authHeaders(),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Failed to read ${tableName}`
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

async function getBaseSchema(baseId: string, token: string) {
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
      data?.error?.message || `Schema fetch failed for ${baseId}`
    );
  }

  return data;
}

function getText(value: any) {
  if (Array.isArray(value)) {
    return String(value[0] || "");
  }

  return String(value || "");
}

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    const isAdmin =
      session.role === "Admin" ||
      session.superAdmin === true ||
      session.selectedBase?.canUsers === true;

    if (!isAdmin) {
      return NextResponse.json(
        { success: false, message: "Admin access required" },
        { status: 403 }
      );
    }

    if (!AUTH_AIRTABLE_TOKEN || !AUTH_AIRTABLE_BASE_ID) {
      return NextResponse.json(
        {
          success: false,
          message:
            "AUTH_AIRTABLE_TOKEN or AUTH_AIRTABLE_BASE_ID is missing",
        },
        { status: 500 }
      );
    }

    const baseRecords = await readAllRecords("ERP Bases");

    const activeBases = baseRecords
      .map((record) => {
        const fields = record.fields || {};

        return {
          recordId: record.id,
          displayName:
            getText(fields["Display Name"]) ||
            getText(fields["Base Name"]) ||
            getText(fields["Company"]) ||
            "Unnamed Base",
          internalName:
            getText(fields["Airtable Base Name"]) ||
            getText(fields["Internal Name"]) ||
            "",
          baseId: getText(fields["Base ID"]),
          token:
            getText(fields["Airtable Token"]) ||
            process.env.AIRTABLE_TOKEN ||
            AUTH_AIRTABLE_TOKEN,
          active: fields.Active !== false,
        };
      })
      .filter((base) => base.active && base.baseId);

    const exports: any[] = [];
    const failures: any[] = [];

    for (const base of activeBases) {
      try {
        const schema = await getBaseSchema(base.baseId, base.token);

        exports.push({
          recordId: base.recordId,
          displayName: base.displayName,
          internalName: base.internalName,
          baseId: base.baseId,
          tables: (schema.tables || []).map((table: any) => ({
            id: table.id,
            name: table.name,
            description: table.description || "",
            primaryFieldId: table.primaryFieldId || "",
            fields: (table.fields || []).map((field: any) => ({
              id: field.id,
              name: field.name,
              type: field.type,
              description: field.description || "",
              options: field.options || null,
            })),
            views: (table.views || []).map((view: any) => ({
              id: view.id,
              name: view.name,
              type: view.type,
            })),
          })),
        });
      } catch (error) {
        failures.push({
          displayName: base.displayName,
          baseId: base.baseId,
          message:
            error instanceof Error
              ? error.message
              : "Unknown schema export error",
        });
      }
    }

    const payload = {
      success: true,
      exportedAt: new Date().toISOString(),
      totalRegisteredBases: activeBases.length,
      successfulBases: exports.length,
      failedBases: failures.length,
      bases: exports,
      failures,
    };

    const fileName = `airtable-all-bases-schema-${
      new Date().toISOString().slice(0, 10)
    }.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Schema export failed",
      },
      { status: 500 }
    );
  }
}
