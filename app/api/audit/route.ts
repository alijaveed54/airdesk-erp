import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const AUTH_AIRTABLE_TOKEN = process.env.AUTH_AIRTABLE_TOKEN;
const AUTH_AIRTABLE_BASE_ID = process.env.AUTH_AIRTABLE_BASE_ID;

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }

    if (!session.superAdmin && session.role !== "Admin") {
      return NextResponse.json({ success: false, message: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const user = searchParams.get("user")?.trim() || "";
    const moduleName = searchParams.get("module")?.trim() || "";
    const action = searchParams.get("action")?.trim() || "";

    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set("sort[0][field]", "Date");
    params.set("sort[0][direction]", "desc");

    const filters: string[] = [];
    if (user) filters.push(`LOWER({User})=LOWER('${escapeAirtableString(user)}')`);
    if (moduleName) filters.push(`LOWER({Module})=LOWER('${escapeAirtableString(moduleName)}')`);
    if (action) filters.push(`LOWER({Action})=LOWER('${escapeAirtableString(action)}')`);

    if (filters.length === 1) params.set("filterByFormula", filters[0]);
    if (filters.length > 1) params.set("filterByFormula", `AND(${filters.join(",")})`);

    const response = await fetch(
      `https://api.airtable.com/v0/${AUTH_AIRTABLE_BASE_ID}/${encodeURIComponent("Activity Log")}?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${AUTH_AIRTABLE_TOKEN}` },
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: "Activity log failed", error: data },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true, records: data.records || [] });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Activity log failed" },
      { status: 500 }
    );
  }
}
