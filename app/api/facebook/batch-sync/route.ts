import { NextRequest, NextResponse } from "next/server";

// Agar aap Airtable use kar rahe hain:
// import { base } from "@/lib/airtable"; 
// Ya Prisma/MongoDB/Postgres jo bhi aapka DB client ho

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let rawText = body.payload;

    if (typeof rawText === "string") {
      try {
        rawText = JSON.parse(rawText);
      } catch (e) {
        return NextResponse.json(
          { success: false, error: "Invalid JSON format. Graph API Explorer ka pura JSON paste karein." },
          { status: 400 }
        );
      }
    }

    // Graph API Explorer me/accounts response format handle karna:
    // Case 1: { "data": [ { "id": "...", "access_token": "..." } ] }
    // Case 2: Direct array [ { "id": "...", "access_token": "..." } ]
    const accounts = Array.isArray(rawText) ? rawText : rawText?.data;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json(
        { success: false, error: "JSON mein koi valid pages data nahi mila ('data' array missing)." },
        { status: 400 }
      );
    }

    const updatedPages: { id: string; name: string }[] = [];

    for (const page of accounts) {
      const pageId = page.id;
      const pageName = page.name || "Unknown";
      const accessToken = page.access_token;

      if (!pageId || !accessToken) continue;

      // TODO: Yahan apna database update logic lagayein
      // Example Airtable:
      /*
      const records = await base("FacebookPages").select({
        filterByFormula: `{PageID} = '${pageId}'`
      }).firstPage();

      if (records.length > 0) {
        await base("FacebookPages").update(records[0].id, {
          AccessToken: accessToken,
          Status: "Active",
          LastUpdated: new Date().toISOString()
        });
      } else {
        await base("FacebookPages").create({
          PageID: pageId,
          PageName: pageName,
          AccessToken: accessToken,
          Status: "Active"
        });
      }
      */

      updatedPages.push({ id: pageId, name: pageName });
    }

    return NextResponse.json({
      success: true,
      message: `${updatedPages.length} Facebook pages ke tokens kamyabi se update ho gaye hain.`,
      updatedPages,
    });
  } catch (error: any) {
    console.error("Batch sync error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update tokens" },
      { status: 500 }
    );
  }
}