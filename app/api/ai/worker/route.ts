import { NextResponse } from "next/server";
import { processPendingAIJobs } from "@/lib/ai/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getPublicUrl() {
  const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, "");

  if (!publicUrl) {
    throw new Error("R2_PUBLIC_URL is missing in .env.local");
  }

  return publicUrl;
}

export async function POST() {
  try {
    const publicUrl = getPublicUrl();

    const summary = await processPendingAIJobs(async (imageKey) => ({
      imageUrl: `${publicUrl}/${imageKey}`,
    }));

    return NextResponse.json({
      success: true,
      message:
        summary.total === 0
          ? "No pending AI jobs found"
          : "AI worker completed",
      ...summary,
    });
  } catch (error) {
    console.error("AI worker route failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "AI worker failed",
      },
      { status: 500 },
    );
  }
}
