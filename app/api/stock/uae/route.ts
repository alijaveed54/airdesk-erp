import { NextRequest, NextResponse } from "next/server";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";
const UAE_STOCK_BASE_ID =
  process.env.AIRTABLE_UAE_STOCK_BASE_ID || process.env.AIRTABLE_BASE_ID || "";
const PRODUCTS_TABLE =
  process.env.AIRTABLE_UAE_PRODUCTS_TABLE || "Products";

async function isAuthenticated(req: NextRequest): Promise<boolean> {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const meUrl = new URL("/api/auth/me", req.url);
    const res = await fetch(meUrl, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.success && data?.user);
  } catch {
    return false;
  }
}

async function getSingleSelectOptions(): Promise<{
  categoryOptions: string[];
  sizeOptions: string[];
}> {
  try {
    const metaRes = await fetch(
      `https://api.airtable.com/v0/meta/bases/${UAE_STOCK_BASE_ID}/tables`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
        cache: "no-store",
      },
    );

    if (!metaRes.ok) {
      return { categoryOptions: [], sizeOptions: [] };
    }

    const metaData = await metaRes.json();
    const tables = Array.isArray(metaData?.tables) ? metaData.tables : [];
    const productsTable = tables.find(
      (t: any) =>
        String(t?.name || "").trim().toLowerCase() ===
        PRODUCTS_TABLE.trim().toLowerCase(),
    );

    const fields = Array.isArray(productsTable?.fields)
      ? productsTable.fields
      : [];

    const categoryField = fields.find(
      (f: any) => String(f?.name || "").trim().toLowerCase() === "category",
    );
    const sizeField = fields.find(
      (f: any) => String(f?.name || "").trim().toLowerCase() === "size",
    );

    const categoryOptions = Array.isArray(categoryField?.options?.choices)
      ? categoryField.options.choices
          .map((c: any) => String(c?.name || "").trim())
          .filter(Boolean)
      : [];

    const sizeOptions = Array.isArray(sizeField?.options?.choices)
      ? sizeField.options.choices
          .map((c: any) => String(c?.name || "").trim())
          .filter(Boolean)
      : [];

    return { categoryOptions, sizeOptions };
  } catch {
    return { categoryOptions: [], sizeOptions: [] };
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!AIRTABLE_API_KEY || !UAE_STOCK_BASE_ID) {
      return NextResponse.json(
        { success: false, message: "Airtable UAE base env variables missing hain." },
        { status: 500 },
      );
    }

    const authenticated = await isAuthenticated(req);
    const { categoryOptions, sizeOptions } = await getSingleSelectOptions();

    const records: Array<{ id: string; fields: Record<string, any> }> = [];
    let offset = "";

    do {
      const url = new URL(
        `https://api.airtable.com/v0/${UAE_STOCK_BASE_ID}/${encodeURIComponent(PRODUCTS_TABLE)}`,
      );
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
        cache: "no-store",
      });

      const data = await response.json();
      if (!response.ok) {
        return NextResponse.json(
          { success: false, message: data?.error?.message || "Airtable fetch failed" },
          { status: response.status },
        );
      }

      if (Array.isArray(data.records)) {
        records.push(...data.records);
      }
      offset = data.offset || "";
    } while (offset);

    const items = records
      .map((rec) => {
        const f = rec.fields || {};
        const qtyInStock = Number(f["Quantity in Stock"] ?? 0);
        const photos = Array.isArray(f["Photo"]) ? f["Photo"] : [];
        const imageUrl =
          photos[0]?.thumbnails?.large?.url ||
          photos[0]?.url ||
          "";

        return {
          id: rec.id,
          name: String(f["Product Name"] || "").trim(),
          category: String(f["Category"] || "").trim(),
          size: String(f["Size"] || "").trim(),
          price: f["Unit Cost"] ?? 0,
          currency: "AED",
          imageUrl,
          _rawStock: qtyInStock,
          ...(authenticated ? { stock: qtyInStock } : {}),
        };
      })
      .filter((item) => authenticated || item._rawStock > 0)
      .map(({ _rawStock, ...publicOrAuthItem }) => publicOrAuthItem);

    return NextResponse.json({
      success: true,
      authenticated,
      categoryOptions,
      sizeOptions,
      items,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: err instanceof Error ? err.message : "UAE stock report error",
      },
      { status: 500 },
    );
  }
}