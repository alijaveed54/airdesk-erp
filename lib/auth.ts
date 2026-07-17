import { cookies } from "next/headers";
import crypto from "crypto";

export type UserRole = "Admin" | "Manager" | "Employee" | "Warehouse" | "Accounts" | "Supplier";

export type BasePermission = {
  baseName: string;
  baseId: string;
  airtableToken?: string;
  supplierCode?: string;
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

function getSecret() {
  return process.env.AUTH_SECRET || "change-this-secret-before-production";
}

function sign(payload: string) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createSessionToken(session: AuthSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null): AuthSession | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== sign(payload)) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
}

export function getCookieName() {
  return COOKIE_NAME;
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
  if (["Admin", "Manager", "Employee", "Warehouse", "Accounts", "Supplier"].includes(role)) {
    return role as UserRole;
  }
  return "Employee";
}
