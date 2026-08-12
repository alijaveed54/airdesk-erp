import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGreenApiGroups, getGreenApiState } from "@/lib/green-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }
    if (String(session.role || "").toLowerCase() !== "admin") {
      return NextResponse.json(
        { success: false, message: "Only Admin can test GREEN-API" },
        { status: 403 },
      );
    }

    const state = await getGreenApiState();
    const groups = getGreenApiGroups();
    return NextResponse.json({
      success: true,
      state,
      configuredGroups: {
        soldOut: Boolean(groups.soldOut),
        dispatch: Boolean(groups.dispatch),
        timelines: Boolean(groups.timelines),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "GREEN-API status check failed",
      },
      { status: 500 },
    );
  }
}
