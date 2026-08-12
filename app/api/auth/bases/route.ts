import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Not authenticated",
        },
        { status: 401 }
      );
    }


    const bases = (session.permissions || [])
      .filter(
        (base: any) =>
          base.baseId &&
          !String(base.baseName || "")
            .toLowerCase()
            .includes("admin")
      )
      .map((base: any) => ({
        baseId: base.baseId,
        baseName: base.baseName,
      }));


    return NextResponse.json({
      success: true,
      bases,
    });


  } catch (error) {

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to load bases",
      },
      {
        status: 500,
      }
    );

  }
}