import { NextResponse } from "next/server";
import { searchCustomers } from "@/lib/airtable";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";

    if (!q.trim()) {
      return NextResponse.json(
        { success: false, message: "Search query is required" },
        { status: 400 }
      );
    }

    const data = await searchCustomers(q);

    return NextResponse.json({
      success: true,
      records: data.records || [],
    });
  } catch (error) {
    console.error("Customer Search API Error:", error);

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}