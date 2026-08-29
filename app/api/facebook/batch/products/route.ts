import { NextRequest, NextResponse } from "next/server";
import { getProducts } from "@/lib/airtable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const category = String(body.category || "").toLowerCase();
    const color = String(body.color || "").toLowerCase();
    const sku = String(body.sku || "").toLowerCase();
    const minPrice = Number(body.minPrice || 0);
    const maxPrice = Number(body.maxPrice || 0);

    const data = await getProducts({
      search: sku,
      pageSize: "100",
    });

    const products = (data.records || [])
      .map((record: any) => {
        const fields = record.fields || {};

        return {
          productId: record.id,
          sku: fields["SKU"] || "",
          name: fields["Product Name"] || fields["Name"] || "",
          category: fields["Category"] || "",
          color: fields["Color"] || "",
          price: Number(fields["Price"] || fields["Selling Price"] || 0),
          images: fields["Images"] || fields["Image URLs"] || [],
        };
      })
      .filter((product: any) => {
        if (category && !String(product.category).toLowerCase().includes(category)) return false;
        if (color && !String(product.color).toLowerCase().includes(color)) return false;
        if (minPrice && product.price < minPrice) return false;
        if (maxPrice && product.price > maxPrice) return false;
        return true;
      });

    return NextResponse.json({
      success: true,
      count: products.length,
      products,
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Product filter failed",
      },
      { status: 500 }
    );
  }
}
