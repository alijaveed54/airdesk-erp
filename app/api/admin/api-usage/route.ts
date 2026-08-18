import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getApiUsageReport,
  isVercelApiUsageTrackingEnabled,
  type ApiUsageRange,
} from "@/lib/api-usage";

export const dynamic = "force-dynamic";

const ALLOWED_RANGES = new Set<ApiUsageRange>(["1", "7", "30", "all"]);

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (session.role !== "Admin" && !session.superAdmin) {
      return NextResponse.json(
        { success: false, message: "Only Admin can view API usage" },
        { status: 403 },
      );
    }

    const rawRange = String(
      request.nextUrl.searchParams.get("range") || "30",
    ) as ApiUsageRange;

    const range: ApiUsageRange = ALLOWED_RANGES.has(rawRange)
      ? rawRange
      : "30";

    const report = await getApiUsageReport(range);

    return NextResponse.json({
      success: true,
      trackingScope: "vercel-outbound-fetch-only",
      deploymentEnvironment: String(process.env.VERCEL_ENV || "local"),
      trackingActiveHere: isVercelApiUsageTrackingEnabled(),
      ...report,
    });
  } catch (error) {
    console.error("API usage report failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "API usage report failed",
      },
      { status: 500 },
    );
  }
}
