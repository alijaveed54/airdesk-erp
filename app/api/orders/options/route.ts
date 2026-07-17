import { NextResponse } from "next/server";
import {
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";

export async function GET() {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to view order options" },
        { status: 403 }
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

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: "Options fetch failed", error: data },
        { status: response.status }
      );
    }

    const invoiceTable = data.tables.find(
      (table: any) =>
        table.name === (airtable.tables.invoice || "BS Invoice")
    );

    const statusField = invoiceTable?.fields.find(
      (field: any) => field.name === "order_status"
    );

    const courierField = invoiceTable?.fields.find(
      (field: any) => field.name === "Courier"
    );

    return NextResponse.json({
      success: true,
      statusOptions:
        statusField?.options?.choices?.map((choice: any) => choice.name) || [],
      courierOptions:
        courierField?.options?.choices?.map((choice: any) => choice.name) || [],
    });
  } catch (error) {
    return handleApiError(error, "Order options failed");
  }
}
