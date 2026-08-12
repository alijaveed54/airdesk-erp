import { NextRequest, NextResponse } from "next/server";
import {
  analyzeProductImage,
  createAIJob,
  updateAIJobStatus,
} from "@/lib/ai";

type BatchImage = {
  imageUrl?: string;
  imageKey?: string;
  sku?: string;
};

type BatchResult = {
  imageKey: string;
  sku?: string;
  success: boolean;
  result?: unknown;
  error?: string;
};

const MAX_BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      images?: BatchImage[];
    };

    if (!Array.isArray(body.images) || body.images.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "At least one image is required",
        },
        { status: 400 },
      );
    }

    if (body.images.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        {
          success: false,
          error: `Maximum ${MAX_BATCH_SIZE} images are allowed per batch`,
        },
        { status: 400 },
      );
    }

    const results: BatchResult[] = [];

    for (const image of body.images) {
      const imageKey = image.imageKey?.trim() ?? "";
      const imageUrl = image.imageUrl?.trim() ?? "";
      const sku = image.sku?.trim() || undefined;

      if (!imageKey || !imageUrl) {
        results.push({
          imageKey,
          sku,
          success: false,
          error: "Image URL and image key are required",
        });
        continue;
      }

      createAIJob(imageKey, sku);
      updateAIJobStatus(imageKey, "processing");

      const analysis = await analyzeProductImage({
        imageUrl,
        imageKey,
        sku,
      });

      if (analysis.success) {
        updateAIJobStatus(imageKey, "completed");

        results.push({
          imageKey,
          sku,
          success: true,
          result: analysis.result,
        });
      } else {
        updateAIJobStatus(imageKey, "failed");

        results.push({
          imageKey,
          sku,
          success: false,
          error: analysis.error || "AI analysis failed",
        });
      }
    }

    const completed = results.filter((item) => item.success).length;
    const failed = results.length - completed;

    return NextResponse.json({
      success: failed === 0,
      total: results.length,
      completed,
      failed,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected batch classification error",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "AI Batch Classifier",
    status: "ready",
    maximumBatchSize: MAX_BATCH_SIZE,
    endpoint: "POST /api/ai/classify-all",
  });
}
