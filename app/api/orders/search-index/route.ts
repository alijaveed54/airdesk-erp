import { NextResponse } from "next/server";
import {
  airtablePaginatedFetch,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";

export async function GET() {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to view search index" },
        { status: 403 }
      );
    }

    const params = new URLSearchParams();

    params.set("pageSize", "100");
    params.set("fields[]", "order_no.");
    params.append("fields[]", "Consignee");
    params.append("fields[]", "Telephone1");
    params.append("fields[]", "date");
    params.append("fields[]", "Select Store");
    params.append("fields[]", "total_order_value");

    const records = await airtablePaginatedFetch({
      baseId: airtable.baseId,
      token: airtable.token,
      table: "BS Invoice",
      params,
    });

    return NextResponse.json({
      success: true,
      records,
    });
  } catch (error) {
    return handleApiError(error, "Search index failed");
  }
}
