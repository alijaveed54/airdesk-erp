import { NextRequest, NextResponse } from "next/server";
import { addFacebookJob } from "@/lib/facebook/queue-store";

export const runtime = "nodejs";


export async function POST(request: NextRequest) {
  try {

    const body = await request.json();


    const job = addFacebookJob({
      id: crypto.randomUUID(),

      campaignId:
        body.campaignId || "test-campaign",

      productId:
        body.productId || "test-product",

      sku:
        body.sku || "TEST-SKU",

      pageId:
        body.pageId || "test-page",

      imageUrls:
        body.imageUrls || [],

      status: "pending",

      retryCount: 0,

      createdAt:
        new Date().toISOString(),
    });


    return NextResponse.json({
      success: true,
      message: "Facebook job created",
      job,
    });


  } catch (error) {

    console.error(
      "Queue create error:",
      error
    );


    return NextResponse.json(
      {
        success:false,
        message:"Failed to create job",
      },
      {
        status:500,
      }
    );
  }
}