import { NextRequest, NextResponse } from "next/server";
import { loadAIResult } from "@/lib/ai/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AIResultRecord = Record<string, unknown>;

function cleanImageKey(value: unknown) {
  const imageKey = String(value || "").trim();

  if (!imageKey || !imageKey.startsWith("products/")) {
    return "";
  }

  return imageKey;
}

export async function GET(request: NextRequest) {
  try {
    const imageKey = cleanImageKey(
      request.nextUrl.searchParams.get("imageKey"),
    );

    if (!imageKey) {
      return NextResponse.json(
        {
          success: false,
          status: "invalid",
          error: "Valid imageKey is required",
        },
        { status: 400 },
      );
    }

    const result = await loadAIResult<AIResultRecord>(imageKey);

    if (!result) {
      return NextResponse.json(
        {
          success: true,
          status: "pending",
          imageKey,
          result: null,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      {
        success: true,
        status: "completed",
        imageKey,
        result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("AI result GET failed:", error);

    return NextResponse.json(
      {
        success: false,
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "AI result load failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      imageKeys?: unknown[];
    };

    const imageKeys = Array.from(
      new Set(
        (Array.isArray(body.imageKeys) ? body.imageKeys : [])
          .map(cleanImageKey)
          .filter(Boolean),
      ),
    );

    if (imageKeys.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "At least one valid imageKey is required",
        },
        { status: 400 },
      );
    }

    if (imageKeys.length > 100) {
      return NextResponse.json(
        {
          success: false,
          error: "Maximum 100 image keys are allowed per request",
        },
        { status: 400 },
      );
    }

    const entries = await Promise.all(
      imageKeys.map(async (imageKey) => {
        const result = await loadAIResult<AIResultRecord>(imageKey);

        return [
          imageKey,
          {
            status: result ? "completed" : "pending",
            result,
          },
        ] as const;
      }),
    );

    return NextResponse.json(
      {
        success: true,
        results: Object.fromEntries(entries),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("AI result POST failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "AI results load failed",
      },
      { status: 500 },
    );
  }
}
