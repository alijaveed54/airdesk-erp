import { NextResponse } from "next/server";
import { getProducts } from "@/lib/airtable";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") || "";
    const offset = searchParams.get("offset") || "";
    const pageSize = searchParams.get("pageSize") || "50";

    const data = await getProducts({
      search,
      offset,
      pageSize,
    });

    return NextResponse.json({
      success: true,
      ...data,
    });

  } catch (error) {
    console.error("Products API Error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      {
        status: 500,
      }
    );
  }
}