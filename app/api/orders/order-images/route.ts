import { NextRequest, NextResponse } from "next/server";
import { airtableHeaders, airtableUrl, getCurrentAirtableBase } from "@/lib/airtable";

export async function GET(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();
    const { searchParams } = new URL(req.url);
    const orderNo = searchParams.get("orderNo") || "";

    if (!orderNo) {
      return NextResponse.json({ success:false, message:"orderNo required" }, {status:400});
    }

    const params = new URLSearchParams({
      pageSize:"100",
      filterByFormula:`{Order Number}="${orderNo}"`
    });

    const response = await fetch(
      airtableUrl(
        airtable.baseId,
        airtable.tables.orderEntry || "BS Order Entry",
        params
      ),
      {
        headers: airtableHeaders(airtable.token),
        cache:"no-store"
      }
    );

    const data = await response.json();

    return NextResponse.json({
      success:true,
      items:(data.records || []).map((r:any)=>({
        id:r.id,
        image:r.fields?.image || []
      }))
    });
  } catch(e:any) {
    return NextResponse.json(
      {success:false,message:e.message},
      {status:500}
    );
  }
}
