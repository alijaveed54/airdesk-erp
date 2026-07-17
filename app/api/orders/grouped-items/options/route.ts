import { NextResponse } from "next/server";

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;

export async function GET() {
  try {
    const statusSet = new Set<string>();
    const storeSet = new Set<string>();

    let offset = "";

    do {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      if (offset) params.set("offset", offset);

      const response = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
          "BS Order Entry"
        )}?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          },
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          { success: false, error: data },
          { status: response.status }
        );
      }

      for (const record of data.records || []) {
        const statusValue =
          record.fields.Order_status?.[0] ||
          record.fields["Order Status"]?.[0] ||
          record.fields.Order_status ||
          record.fields["Order Status"] ||
          "";

        const storeValue =
          record.fields.Store?.[0] ||
          record.fields.Store ||
          record.fields["Select Store"]?.[0] ||
          record.fields["Select Store"] ||
          "";

        const status = String(statusValue).trim();
        const store = String(storeValue).trim();

        if (status) statusSet.add(status);
        if (store) storeSet.add(store);
      }

      offset = data.offset || "";
    } while (offset);

    return NextResponse.json({
      success: true,
      statusOptions: Array.from(statusSet).sort(),
      storeOptions: Array.from(storeSet).sort(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown Error",
      },
      { status: 500 }
    );
  }
}