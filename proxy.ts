import { NextRequest, NextResponse } from "next/server";
import {
  getCookieName,
  getPermissionsCookieName,
} from "@/lib/auth";

function decodeSession(token?: string) {
  if (!token) return null;

  try {
    const [payload, signature] = token.split(".");

    if (!payload || !signature) return null;

    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
  } catch {
    return null;
  }
}

function hasPermission(session: any, key: string) {
  return Array.isArray(session?.permissions)
    ? session.permissions.some((p: any) => p[key] === true)
    : false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * Public routes
   */
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/base/select") ||
    pathname.startsWith("/privacy-policy") ||
    pathname.startsWith("/stock/doha") ||
    pathname.startsWith("/api/public/stock/doha") ||
    pathname.startsWith("/stock/uae") ||
    pathname.startsWith("/api/public/stock/uae") ||
    pathname === "/gallery" ||
    pathname.startsWith("/api/public/r2/gallery")
  ) {
    return NextResponse.next();
  }

  /*
   * Read basic session
   */
  const basicSession = decodeSession(
    request.cookies.get(getCookieName())?.value
  );

  if (!basicSession) {
    return NextResponse.redirect(
      new URL("/login", request.url)
    );
  }

  /*
   * Read permissions cookie
   */
  const permissionSession = decodeSession(
    request.cookies.get(getPermissionsCookieName())?.value
  );

  const session = {
    ...basicSession,
    permissions: permissionSession?.permissions || [],
  };

  /*
   * Supplier
   */
  if (session.role === "Supplier") {
    const allowed =
      pathname.startsWith("/suppliers") ||
      pathname.startsWith("/api/suppliers") ||
      pathname.startsWith("/reports/supplier-activity") ||
      pathname.startsWith("/api/reports/supplier-activity");

    return allowed
      ? NextResponse.next()
      : NextResponse.redirect(
          new URL("/suppliers", request.url)
        );
  }

  /*
   * Admin / Super Admin
   */
  if (
    session.role === "Admin" ||
    session.superAdmin
  ) {
    return NextResponse.next();
  }

  /*
   * Reports
   */
  if (
    pathname.startsWith("/reports") &&
    !hasPermission(session, "canReports")
  ) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
  }

  /*
   * Users
   */
  if (
    pathname.startsWith("/users") &&
    !hasPermission(session, "canUsers")
  ) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
  }

  /*
   * Orders
   */
  if (
    pathname.startsWith("/orders") &&
    !hasPermission(session, "canView")
  ) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
  }

  /*
   * Grouped Orders
   */
  if (
    pathname.startsWith("/grouped-orders") &&
    !hasPermission(session, "canView")
  ) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
  }

  /*
   * Inventory
   */
  if (
    pathname.startsWith("/inventory") &&
    !hasPermission(session, "canInventory")
  ) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
  }

  /*
   * API Usage
   */
  if (pathname.startsWith("/admin/api-usage")) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
  }

  /*
   * Settings
   */
  if (
    pathname.startsWith("/settings") &&
    !(
      session.role === "Admin" ||
      session.superAdmin
    )
  ) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/facebook/post/direct|api/facebook/batch/process).*)",
  ],
};