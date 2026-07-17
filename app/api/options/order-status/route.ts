import { NextResponse } from "next/server";

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

export async function GET() {
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
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
      (table: any) => table.name === "BS Invoice"
    );

    const field = table?.fields?.find(
      (field: any) => field.name === "order_status"
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