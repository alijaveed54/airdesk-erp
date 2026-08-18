import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getGreenApiChatHistory,
  getGreenApiGroup,
} from "@/lib/green-api";
import { parseTimelineHistory } from "@/lib/timelines-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdminSession(session: Awaited<ReturnType<typeof getSession>>) {
  return Boolean(
    session && (session.role === "Admin" || session.superAdmin),
  );
}

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (!isAdminSession(session)) {
      return NextResponse.json(
        { success: false, message: "Only Admin can use Timelines" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const startAfterSku = String(body?.startAfterSku || "").trim().toUpperCase();

    if (!startAfterSku) {
      return NextResponse.json(
        { success: false, message: "Start After SKU is required" },
        { status: 400 },
      );
    }

    // UI par message-count setting nahi dikhani. One getChatHistory request mein
    // a large history window read karte hain, then latest exact SKU marker ke baad ka data rakhte hain.
    const count = 10000;
    const chatId = getGreenApiGroup("timelines", "secondary");
    const history = await getGreenApiChatHistory({
      account: "secondary",
      chatId,
      count,
    });
    const parsed = parseTimelineHistory(history, { startAfterSku });

    return NextResponse.json({
      success: true,
      source: "GREEN-API account 2",
      groupConfigured: true,
      startAfterSku,
      scannedMessages: history.length,
      fetchedMessages: parsed.summary.messages,
      ...parsed,
    });
  } catch (error) {
    console.error("Timelines history fetch failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Timelines history fetch failed",
      },
      { status: 500 },
    );
  }
}
