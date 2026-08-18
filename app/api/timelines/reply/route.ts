import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getGreenApiGroup,
  sendGreenApiText,
} from "@/lib/green-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdminSession(session: Awaited<ReturnType<typeof getSession>>) {
  return Boolean(
    session && (session.role === "Admin" || session.superAdmin),
  );
}

function normalizeSku(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
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
        { success: false, message: "Only Admin can reply from Timelines" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const descriptionMessageId = String(
      body?.descriptionMessageId || "",
    ).trim();
    const sku = normalizeSku(body?.sku);

    if (!descriptionMessageId) {
      return NextResponse.json(
        { success: false, message: "Description message ID is required" },
        { status: 400 },
      );
    }

    if (!sku || sku.length > 60) {
      return NextResponse.json(
        { success: false, message: "Valid SKU is required" },
        { status: 400 },
      );
    }

    const chatId = getGreenApiGroup("timelines", "secondary");
    const result = await sendGreenApiText({
      account: "secondary",
      chatId,
      message: `SKU: ${sku}`,
      quotedMessageId: descriptionMessageId,
    });

    return NextResponse.json({
      success: true,
      sku,
      idMessage: String(result?.idMessage || ""),
      message: `SKU: ${sku}`,
    });
  } catch (error) {
    console.error("Timelines SKU reply failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Timelines SKU reply failed",
      },
      { status: 500 },
    );
  }
}
