import { NextRequest, NextResponse } from "next/server";

function decodeSession(token?: string) {
  if (!token) return null;
  try {
    const payload = token.split(".")[0];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function hasPermission(session: any, key: string) {
  return Array.isArray(session?.permissions)
    ? session.permissions.some((p: any) => p[key])
    : false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  const session = decodeSession(request.cookies.get("erp_session")?.value);

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const activeBase =
    session.selectedBase ||
    (Array.isArray(session.permissions) ? session.permissions[0] : null);

  if (!activeBase && session.role !== "Supplier") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session.role === "Admin" || session.superAdmin) {
    return NextResponse.next();
  }

  if (session.role === "Supplier") {
    const allowed =
      pathname.startsWith("/suppliers") ||
      pathname.startsWith("/api/suppliers") ||
      pathname.startsWith("/reports/supplier-activity") ||
      pathname.startsWith("/api/reports/supplier-activity");

    return allowed
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/suppliers", request.url));
  }

  if (pathname.startsWith("/reports") && !hasPermission(session, "canReports")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/users") && !hasPermission(session, "canUsers")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/orders") && !hasPermission(session, "canView")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/grouped-orders") && !hasPermission(session, "canView")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/inventory") && !hasPermission(session, "canInventory")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/admin/api-usage")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/settings") && !(session.role === "Admin" || session.superAdmin)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/facebook/post/direct|api/facebook/batch/process).*)",
  ],
};
