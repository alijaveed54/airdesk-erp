import { NextRequest, NextResponse } from "next/server";
import {
  analyzeProductImage,
  createAIJob,
  updateAIJobStatus,
} from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClassifyRequestBody = {
  imageUrl?: string;
  imageKey?: string;
  sku?: string;
};

export async function POST(request: NextRequest) {
  let imageKey = "";

  try {
    const body = (await request.json()) as ClassifyRequestBody;

    const imageUrl = body.imageUrl?.trim() ?? "";
    imageKey = body.imageKey?.trim() ?? "";
    const sku = body.sku?.trim() || undefined;

    if (!imageUrl || !imageKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Image URL and image key are required",
        },
        { status: 400 },
      );
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid image URL",
        },
        { status: 400 },
      );
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return NextResponse.json(
        {
          success: false,
          error: "Only HTTP or HTTPS image URLs are supported",
        },
        { status: 400 },
      );
    }

    createAIJob(imageKey, sku);
    updateAIJobStatus(imageKey, "processing");

    const analysis = await analyzeProductImage({
      imageUrl,
      imageKey,
      sku,
    });

    if (!analysis.success) {
      updateAIJobStatus(imageKey, "failed");

      return NextResponse.json(
        {
          success: false,
          error: analysis.error || "AI analysis failed",
        },
        { status: 500 },
      );
    }

    updateAIJobStatus(imageKey, "completed");

    return NextResponse.json({
      success: true,
      result: analysis.result,
    });
  } catch (error) {
    if (imageKey) {
      try {
        updateAIJobStatus(imageKey, "failed");
      } catch {
        // Ignore queue status errors while returning the main API error.
      }
    }

    console.error("AI classify route failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected image classification error",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "AI Image Classifier",
    status: "ready",
    endpoint: "POST /api/ai/classify",
  });
}
