import { NextResponse } from "next/server";
import { createProduct, handleApiError } from "@/lib/airtable";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      sku,
      supplierSku,
      supplier,
      cp,
      price,
      imageUrl,
    } = body;

    if (!String(sku || "").trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "SKU is required",
        },
        { status: 400 }
      );
    }

    const record = await createProduct({
      sku: String(sku).trim(),
      supplierSku: String(supplierSku || "").trim(),
      supplier: String(supplier || "").trim(),
      cp: Number(cp) || 0,
      price: Number(price) || Number(cp) || 0,
      imageUrl: String(imageUrl || "").trim(),
    });

    return NextResponse.json({
      success: true,
      record,
    });
  } catch (error) {
    return handleApiError(error, "Product create failed");
  }
}
