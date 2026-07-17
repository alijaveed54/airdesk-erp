import { NextResponse } from "next/server";

import { getCurrentAirtableBase } from "@/lib/airtable";


export async function GET() {
  try {
    const airtable = await getCurrentAirtableBase();

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
      const errorText = await response.text();
      throw new Error(`Airtable Metadata Error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    const table = data.tables.find(
      (table: any) => table.name === (airtable.tables.invoice || "BS Invoice")
    );

    const field = table?.fields?.find(
      (field: any) => field.name === "Select Store"
    );

    const options =
      field?.options?.choices?.map((choice: any) => choice.name) || [];

    return NextResponse.json({
      success: true,
      options,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}