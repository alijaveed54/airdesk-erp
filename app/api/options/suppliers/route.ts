import { NextResponse } from "next/server";
import { getCurrentAirtableBase } from "@/lib/airtable";

export async function GET() {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable?.token || !airtable?.baseId) {
      return NextResponse.json(
        {
          success: false,
          message: "Airtable configuration missing",
        },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.airtable.com/v0/meta/bases/${airtable.baseId}/tables`,
      {
        headers: {
          Authorization: `Bearer ${airtable.token}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Airtable Metadata Error: ${response.status} ${error}`);
    }

    const data = await response.json();

    const table = data.tables.find(
      (t: any) => t.name === airtable.tables?.orderEntry || t.name === "BS Order Entry"
    );

    const field = table?.fields?.find(
      (f: any) => f.name === "Supplier"
    );

    const suppliers =
      field?.options?.choices?.map((choice: any) => choice.name) || [];

    return NextResponse.json({
      success: true,
      suppliers,
      options: suppliers,
    });
  } catch (error) {
    console.error("Supplier options error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to load suppliers",
      },
      { status: 500 }
    );
  }
}
