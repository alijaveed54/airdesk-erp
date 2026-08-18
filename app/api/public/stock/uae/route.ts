import { NextResponse } from "next/server";

const BASE_ID =
  process.env.UAE_STOCK_BASE_ID ||
  process.env.AIRTABLE_BASE_ID ||
  "app2hjpuQoeEL1Rn2";

const TABLE_NAME =
  process.env.UAE_STOCK_PRODUCT_TABLE ||
  "Products";

function getToken() {
  return (
    process.env.UAE_STOCK_AIRTABLE_TOKEN ||
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    ""
  );
}

type AirtableRecord = {
  id: string;
  fields?: Record<string, unknown>;
};

function firstAttachmentUrl(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return "";

  const first = value[0] as {
    url?: string;
    thumbnails?: {
      large?: { url?: string };
      full?: { url?: string };
      small?: { url?: string };
    };
  };

  return (
    first?.thumbnails?.large?.url ||
    first?.thumbnails?.full?.url ||
    first?.url ||
    first?.thumbnails?.small?.url ||
    ""
  );
}

function textValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value ?? "");
}

function firstField(
  fields: Record<string, unknown>,
  candidates: string[],
): unknown {
  const keys = new Map(
    Object.keys(fields).map((key) => [key.trim().toLowerCase(), key]),
  );

  for (const candidate of candidates) {
    const actual = keys.get(candidate.trim().toLowerCase());
    if (actual) return fields[actual];
  }

  return undefined;
}

export async function GET() {
  try {
    const token = getToken();

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Airtable token is not configured" },
        { status: 500 },
      );
    }

    const records: AirtableRecord[] = [];
    let offset = "";

    do {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      params.set("filterByFormula", "{Balance Stock}>=1");
      params.append("sort[0][field]", "SKU");
      params.append("sort[0][direction]", "asc");

      if (offset) params.set("offset", offset);

      const url =
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}` +
        `?${params.toString()}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          {
            success: false,
            message: data?.error?.message || "Unable to load UAE stock",
          },
          { status: response.status },
        );
      }

      records.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);

    const products = records
      .map((record) => {
        const fields = record.fields || {};
        const balanceStock = Number(
          firstField(fields, [
            "Balance Stock",
            "Stock",
            "Available Stock",
            "Current Stock",
          ]) || 0,
        );

        return {
          id: record.id,
          sku: textValue(
            firstField(fields, ["SKU", "Sku", "Product SKU", "Item Code"]),
          ),
          price: Number(
            firstField(fields, [
              "Price",
              "Sale Price",
              "Selling Price",
              "Retail Price",
              "AED Price",
              "CP",
            ]) || 0,
          ),
          image: firstAttachmentUrl(
            firstField(fields, ["Image", "image", "Product Image"]),
          ),
          balanceStock,
          category: textValue(
            firstField(fields, ["Catagory", "Category", "category"]),
          ),
          color: textValue(firstField(fields, ["Color", "Colour", "color"])),
          size: textValue(firstField(fields, ["Size", "size"])),
        };
      })
      .filter((product) => product.balanceStock >= 1 && product.sku);

    return NextResponse.json(
      {
        success: true,
        market: "UAE",
        currency: "AED",
        products,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    console.error("Public UAE stock error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to load UAE stock" },
      { status: 500 },
    );
  }
}
