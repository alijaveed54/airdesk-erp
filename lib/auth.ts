import { cookies } from "next/headers";
import crypto from "crypto";

export type UserRole =
  | "Admin"
  | "Manager"
  | "Employee"
  | "Warehouse"
  | "Accounts"
  | "Supplier";

export type BasePermission = {
  baseName: string;
  baseId: string;
  airtableToken?: string;
  supplierCode?: string;

  invoiceTable?: string;
  orderEntryTable?: string;
  customersTable?: string;
  productsTable?: string;

  canView: boolean;
  canEdit: boolean;
  canReports: boolean;
  canDispatch: boolean;
  canReceive: boolean;
  canInventory: boolean;
  canFinance: boolean;
  canUsers: boolean;
  canDelete: boolean;
};

export type AuthSession = {
  username: string;
  fullName: string;
  role: UserRole;
  superAdmin: boolean;
  defaultBase?: string;

  permissions: BasePermission[];
  availableBases?: BasePermission[];
  selectedBase?: BasePermission;
};

const COOKIE_NAME = "erp_session";
const PERMISSIONS_COOKIE_NAME = "erp_permissions";

function getSecret() {
  return process.env.AUTH_SECRET || "change-this-secret-before-production";
}

function sign(payload: string) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
}

function encodeToken(data: unknown) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

function decodeToken<T>(token?: string | null): T | null {
  if (!token) return null;

  try {
    const [payload, signature] = token.split(".");

    if (!payload || !signature) return null;

    if (signature !== sign(payload)) return null;

    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as T;
  } catch {
    return null;
  }
}

/**
 * Main authentication cookie.
 *
 * IMPORTANT:
 * Keep this cookie very small.
 */
export function createSessionToken(session: AuthSession) {
  return encodeToken({
    username: session.username,
    fullName: session.fullName,
    role: session.role,
    superAdmin: session.superAdmin,
    defaultBase: session.defaultBase || "",
  });
}

/**
 * Store ONLY permissions here.
 *
 * Do NOT store availableBases or selectedBase.
 * They are duplicates and can make the cookie exceed 4KB.
 */
export function createPermissionsToken(session: AuthSession) {
  const compactPermissions = (session.permissions || []).map((p) => ({
    baseName: p.baseName,
    baseId: p.baseId,

    supplierCode: p.supplierCode || "",

    canView: !!p.canView,
    canEdit: !!p.canEdit,
    canReports: !!p.canReports,
    canDispatch: !!p.canDispatch,
    canReceive: !!p.canReceive,
    canInventory: !!p.canInventory,
    canFinance: !!p.canFinance,
    canUsers: !!p.canUsers,
    canDelete: !!p.canDelete,

    invoiceTable: p.invoiceTable || "BS Invoice",
    orderEntryTable: p.orderEntryTable || "BS Order Entry",
    customersTable: p.customersTable || "Customers",
    productsTable: p.productsTable || "Products",
  }));

  return encodeToken({
    permissions: compactPermissions,
  });
}

export function verifySessionToken(
  token?: string | null
): Omit<AuthSession, "permissions" | "availableBases" | "selectedBase"> | null {
  return decodeToken<
    Omit<AuthSession, "permissions" | "availableBases" | "selectedBase">
  >(token);
}

export function verifyPermissionsToken(
  token?: string | null
): Pick<AuthSession, "permissions"> | null {
  return decodeToken<Pick<AuthSession, "permissions">>(token);
}

export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();

  const basicSession = verifySessionToken(
    cookieStore.get(COOKIE_NAME)?.value
  );

  if (!basicSession) return null;

  const permissionSession = verifyPermissionsToken(
    cookieStore.get(PERMISSIONS_COOKIE_NAME)?.value
  );

  const permissions = permissionSession?.permissions || [];

  return {
    ...basicSession,

    permissions,

    availableBases: permissions,

    selectedBase: permissions[0],
  };
}

export function getCookieName() {
  return COOKIE_NAME;
}

export function getPermissionsCookieName() {
  return PERMISSIONS_COOKIE_NAME;
}

export function getBool(value: any) {
  return value === true;
}

export function getFirstValue(value: any) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function normalizeRole(value: string): UserRole {
  const role = String(value || "Employee").trim();

  if (
    [
      "Admin",
      "Manager",
      "Employee",
      "Warehouse",
      "Accounts",
      "Supplier",
    ].includes(role)
  ) {
    return role as UserRole;
  }

  return "Employee";
}