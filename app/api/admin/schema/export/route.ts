import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type SessionBase = {
  baseName: string;
  baseId: string;
  airtableToken?: string;
  invoiceTable?: string;
  orderEntryTable?: string;
  customersTable?: string;
  productsTable?: string;
  canUsers?: boolean;
};

function safeFileName(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "airtable-base"
  );
}

async function fetchBaseSchema(base: SessionBase) {
  const token =
    base.airtableToken ||
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    "";

  if (!token) {
    throw new Error(`Airtable token missing for ${base.baseName}`);
  }

  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(base.baseId)}/tables`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        data?.error?.error?.message ||
        `Schema download failed for ${base.baseName}`,
    );
  }

  return {
    displayName: base.baseName,
    baseId: base.baseId,
    configuredTables: {
      invoice: base.invoiceTable || "",
      orderEntry: base.orderEntryTable || "",
      customers: base.customersTable || "",
      products: base.productsTable || "",
    },
    tables: data.tables || [],
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    const role = String(session.role || "").trim().toLowerCase();
    if (role !== "admin" && !session.superAdmin) {
      return NextResponse.json(
        { success: false, message: "Admin access required" },
        { status: 403 },
      );
    }

    const allBases = (
      session.availableBases?.length
        ? session.availableBases
        : session.permissions || []
    ) as SessionBase[];

    const { searchParams } = new URL(req.url);
    const requestedBaseId = String(searchParams.get("baseId") || "").trim();
    const exportedAt = new Date().toISOString();

    if (requestedBaseId) {
      const selectedBase = allBases.find(
        (base) => base.baseId === requestedBaseId,
      );

      if (!selectedBase) {
        return NextResponse.json(
          {
            success: false,
            message: "Selected base is not available in your session",
          },
          { status: 404 },
        );
      }

      const schema = await fetchBaseSchema(selectedBase);
      const fileName = `${safeFileName(selectedBase.baseName)}-schema-${exportedAt.slice(0, 10)}.json`;

      return new NextResponse(
        JSON.stringify({ success: true, exportedAt, ...schema }, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const results = await Promise.all(
      allBases.map(async (base) => {
        try {
          return { success: true as const, ...(await fetchBaseSchema(base)) };
        } catch (error) {
          return {
            success: false as const,
            displayName: base.baseName,
            baseId: base.baseId,
            error:
              error instanceof Error ? error.message : "Schema download failed",
          };
        }
      }),
    );

    const successfulBases = results.filter((result) => result.success);
    const failedBases = results.filter((result) => !result.success);
    const fileName = `airtable-all-bases-schema-${exportedAt.slice(0, 10)}.json`;

    return new NextResponse(
      JSON.stringify(
        {
          success: failedBases.length === 0,
          exportedAt,
          totalRegisteredBases: allBases.length,
          successfulBases: successfulBases.length,
          failedBases: failedBases.length,
          bases: successfulBases,
          errors: failedBases,
        },
        null,
        2,
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Schema export failed",
      },
      { status: 500 },
    );
  }
}
