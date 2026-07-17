import { NextResponse } from "next/server";
import { AuthSession, createSessionToken, getCookieName, getSession } from "@/lib/auth";

function redirectForSession(session: AuthSession) {
  if (session.role === "Supplier") return "/suppliers";

  const base = session.selectedBase;

  if (session.role === "Accounts" || base?.canReports) return "/reports";
  if (base?.canReceive || base?.canDispatch) return "/suppliers";

  return "/dashboard";
}

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const baseId = String(body.baseId || "").trim();

    if (!baseId) {
      return NextResponse.json(
        { success: false, message: "Base ID is required" },
        { status: 400 }
      );
    }

    const selectedBase = session.permissions.find(
      (permission) => String(permission.baseId) === baseId
    );

    if (!selectedBase) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have access to this base",
        },
        { status: 403 }
      );
    }

    const reorderedPermissions = [
      selectedBase,
      ...session.permissions.filter(
        (permission) => permission.baseId !== selectedBase.baseId
      ),
    ];

    const updatedSession: AuthSession = {
      ...session,
      permissions: reorderedPermissions,
      selectedBase: undefined,
    };

    const response = NextResponse.json({
      success: true,
      selectedBase,
      redirectTo: redirectForSession(updatedSession),
    });

    response.cookies.set(getCookieName(), createSessionToken(updatedSession), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Base selection failed",
      },
      { status: 500 }
    );
  }
}
