import { NextResponse } from "next/server";
import {
  AuthSession,
  createPermissionsToken,
  createSessionToken,
  getCookieName,
  getPermissionsCookieName,
  getSession,
} from "@/lib/auth";

function redirectForSession(session: AuthSession) {
  if (session.role === "Supplier") {
    return "/suppliers";
  }

  const base = session.selectedBase;

  if (session.role === "Accounts" || base?.canReports) {
    return "/reports";
  }

  if (base?.canReceive || base?.canDispatch) {
    return "/suppliers";
  }

  return "/dashboard";
}

export async function POST(request: Request) {
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

    const body = await request.json();

    const baseId = String(body.baseId || "").trim();

    if (!baseId) {
      return NextResponse.json(
        {
          success: false,
          message: "Base ID is required",
        },
        { status: 400 }
      );
    }

    const selectedBase = session.permissions.find(
      (permission) =>
        String(permission.baseId) === baseId
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

    /*
     * Put selected base first.
     * This keeps the currently selected base
     * available to existing code that uses permissions[0].
     */
    const reorderedPermissions = [
      selectedBase,
      ...session.permissions.filter(
        (permission) =>
          permission.baseId !== selectedBase.baseId
      ),
    ];

    const updatedSession: AuthSession = {
      ...session,
      permissions: reorderedPermissions,
      availableBases: reorderedPermissions,
      selectedBase,
    };

    const response = NextResponse.json({
      success: true,
      selectedBase,
      redirectTo: redirectForSession(updatedSession),
    });

    /*
     * Main session cookie stays small.
     */
    response.cookies.set(
      getCookieName(),
      createSessionToken(updatedSession),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      }
    );

    /*
     * Permissions cookie contains permissions only.
     * The selected base is represented by making it
     * permissions[0], so we don't duplicate the
     * entire selectedBase object.
     */
    response.cookies.set(
      getPermissionsCookieName(),
      createPermissionsToken(updatedSession),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      }
    );

    return response;
  } catch (error) {
    console.error("Base selection failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Base selection failed",
      },
      { status: 500 }
    );
  }
}