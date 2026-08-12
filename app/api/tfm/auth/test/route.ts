import { NextResponse } from "next/server";
import { getCurrentAirtableBase } from "@/lib/airtable";
import { getSession } from "@/lib/auth";
import { authenticateTfm } from "@/lib/tfm-auth";
import { isTfmSupportedBase } from "@/lib/tfm";

export async function POST() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (session.role !== "Admin") {
      return NextResponse.json(
        {
          success: false,
          message: "Only Admin can test TFM credentials",
        },
        { status: 403 },
      );
    }

    const airtable = await getCurrentAirtableBase();

    if (!isTfmSupportedBase(airtable.baseId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "TFM integration is available only for BS Order Entry and Tatlumput Siyam Order Entry",
        },
        { status: 400 },
      );
    }

    const tfmSession = await authenticateTfm({
      forceRefresh: true,
    });

    return NextResponse.json({
      success: true,
      message: "TFM authentication successful",
      authentication: {
        userId: tfmSession.userId,
        shipperId: tfmSession.shipperId,
        tokenType: tfmSession.tokenType,
        expiresAt: tfmSession.expiresAt,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "TFM authentication test failed",
      },
      { status: 500 },
    );
  }
}
