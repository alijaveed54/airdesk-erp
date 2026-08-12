import { NextResponse } from "next/server";

const BASE_ID = process.env.FAB_DOHA_STOCK_BASE_ID || "appEKsWCVMfGBFQ3L";
const TABLE_NAME = process.env.FAB_DOHA_STOCK_PRODUCT_TABLE || "Product";

function getToken() {
  return (
    process.env.FAB_DOHA_STOCK_AIRTABLE_TOKEN ||
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
  const first = value[0] as { url?: string; thumbnails?: { large?: { url?: string } } };
  return first?.thumbnails?.large?.url || first?.url || "";
}

function textValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value ?? "");
}

export async function GET() {
  try {
    const token = getToken();

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Airtable token is not configured" },
        { status: 500 }
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

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(
        TABLE_NAME
      )}?${params.toString()}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          {
            success: false,
            message: data?.error?.message || "Unable to load Doha stock",
          },
          { status: response.status }
        );
      }

      records.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);

    const products = records
      .map((record) => {
        const fields = record.fields || {};
        const balanceStock = Number(fields["Balance Stock"] || 0);

        return {
          id: record.id,
          sku: textValue(fields.SKU),
          price: Number(fields["Doha Price"] || 0),
          image: firstAttachmentUrl(fields.Image),
          balanceStock,
          category: textValue(fields.Catagory),
          color: textValue(fields.Color),
          size: textValue(fields.Size),
        };
      })
      .filter((product) => product.balanceStock >= 1 && product.sku);

    return NextResponse.json(
      { success: true, products },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    console.error("Public Doha stock error:", error);
    return NextResponse.json(
      { success: false, message: "Unable to load Doha stock" },
      { status: 500 }
    );
  }
}
