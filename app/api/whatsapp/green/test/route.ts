import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getGreenApiGroup,
  sendGreenApiText,
  type GreenApiTarget,
} from "@/lib/green-api";

export async function POST(request: Request) {
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
        { success: false, message: "Only Admin can send GREEN-API tests" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const target = String(body?.target || "") as GreenApiTarget;
    if (!(["soldOut", "dispatch", "timelines"] as string[]).includes(target)) {
      return NextResponse.json(
        {
          success: false,
          message: "target must be soldOut, dispatch, or timelines",
        },
        { status: 400 },
      );
    }

    const chatId = getGreenApiGroup(target);
    const message = String(
      body?.message || `Mysmar ERP GREEN-API test: ${target}`,
    ).trim();
    const result = await sendGreenApiText({ chatId, message });

    return NextResponse.json({ success: true, target, chatId, result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "GREEN-API test failed",
      },
      { status: 500 },
    );
  }
}
