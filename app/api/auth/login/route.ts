import { NextResponse } from "next/server";
import {
  BasePermission,
  createSessionToken,
  getBool,
  getCookieName,
  getFirstValue,
  normalizeRole,
} from "@/lib/auth";

const AUTH_AIRTABLE_TOKEN = process.env.AUTH_AIRTABLE_TOKEN;
const AUTH_AIRTABLE_BASE_ID = process.env.AUTH_AIRTABLE_BASE_ID;

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function airtableList(table: string, filterByFormula: string) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", filterByFormula);

  const response = await fetch(
    `https://api.airtable.com/v0/${AUTH_AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${AUTH_AIRTABLE_TOKEN}` },
      cache: "no-store",
    }
  );

  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.records || [];
}

function getField(fields: Record<string, any>, names: string[]) {
  for (const name of names) {
    const value = fields[name];
    if (Array.isArray(value)) return value[0] ?? "";
    if (value !== undefined && value !== null) return value;
  }
  return "";
}

function defaultRedirect(role: string, permissions: BasePermission[]) {
  if (role === "Supplier") return "/suppliers";

  const firstBase = permissions[0];

  if (role === "Accounts" || firstBase?.canReports) return "/reports";
  if (firstBase?.canReceive || firstBase?.canDispatch) return "/suppliers";

  return "/dashboard";
}

export async function POST(request: Request) {
  try {
    if (!AUTH_AIRTABLE_TOKEN || !AUTH_AIRTABLE_BASE_ID) {
      return NextResponse.json(
        { success: false, message: "AUTH_AIRTABLE_TOKEN or AUTH_AIRTABLE_BASE_ID missing" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    const users = await airtableList(
      "ERP Users",
      `AND(LOWER({Username})=LOWER('${escapeAirtableString(username)}'),{Active}=1)`
    );

    const user = users[0];
    if (!user) {
      return NextResponse.json({ success: false, message: "User not found or inactive" }, { status: 401 });
    }

    const userFields = user.fields || {};
    if (String(userFields.Password || "") !== password) {
      return NextResponse.json({ success: false, message: "Invalid password" }, { status: 401 });
    }

    const accessRecords = await airtableList(
      "User Base Access",
      `AND(LOWER({Username})=LOWER('${escapeAirtableString(username)}'),{Active}=1)`
    );

    const baseRecords = await airtableList("ERP Bases", `{Active}=1`);
    const baseMap = new Map<string, { id: string; fields: Record<string, any> }>();

    for (const record of baseRecords) {
      const fields = record.fields || {};

      const displayName = String(
        getField(fields, ["Display Name", "Base Name", "Internal Name"]) || ""
      ).trim();

      const internalName = String(
        getField(fields, ["Internal Name", "Airtable Base Name"]) || ""
      ).trim();

      // Support Airtable linked-record IDs and text/display names.
      baseMap.set(record.id, { id: record.id, fields });

      if (displayName) {
        baseMap.set(displayName.toLowerCase(), { id: record.id, fields });
      }

      if (internalName) {
        baseMap.set(internalName.toLowerCase(), { id: record.id, fields });
      }
    }

    const permissions: BasePermission[] = accessRecords
      .map((record: any) => {
        const fields = record.fields || {};

        const baseReference = String(
          getFirstValue(fields["Base Name"]) ||
          getFirstValue(fields["ERP Base"]) ||
          getFirstValue(fields["Base"]) ||
          getFirstValue(fields["Display Name"]) ||
          ""
        ).trim();

        const baseRecord =
          baseMap.get(baseReference) ||
          baseMap.get(baseReference.toLowerCase());

        if (!baseRecord) {
          console.log("Base access mapping failed:", {
            username,
            baseReference,
            accessRecordId: record.id,
          });
          return null;
        }

        const baseFields = baseRecord.fields;

        const baseName = String(
          getField(baseFields, ["Display Name", "Base Name", "Internal Name"]) ||
          baseReference
        ).trim();

        return {
          baseName,
          baseId: String(baseFields["Base ID"] || ""),
          invoiceTable: String(baseFields["Invoice Table"] || "BS Invoice"),
          orderEntryTable: String(baseFields["Order Entry Table"] || "BS Order Entry"),
          customersTable: String(baseFields["Customers Table"] || "Customers"),
          productsTable: String(baseFields["Products Table"] || "Products"),
          supplierCode: String(fields["Supplier Code"] || ""),
          canView: getBool(fields["Can View"]),
          canEdit: getBool(fields["Can Edit"]),
          canReports: getBool(fields["Can Reports"]),
          canDispatch: getBool(fields["Can Dispatch"]),
          canReceive: getBool(fields["Can Receive"]),
          canInventory: getBool(fields["Can Inventory"]),
          canFinance: getBool(fields["Can Finance"]),
          canUsers: getBool(fields["Can Users"]),
          canDelete: getBool(fields["Can Delete"]),
        };
      })
      .filter(
        (permission: BasePermission | null): permission is BasePermission =>
          permission !== null
      );

    if (!permissions.length) {
      return NextResponse.json({ success: false, message: "No active base access found" }, { status: 403 });
    }

    const role = normalizeRole(String(userFields.Role || "Employee"));

    const currentLoginCount = Number(userFields["Login Count"] || 0);

    await fetch(
      `https://api.airtable.com/v0/${AUTH_AIRTABLE_BASE_ID}/${encodeURIComponent("ERP Users")}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AUTH_AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          records: [
            {
              id: user.id,
              fields: {
                "Last Login": new Date().toISOString(),
                "Login Count": currentLoginCount + 1,
              },
            },
          ],
        }),
      }
    );

    const session = {
  username,
  fullName: String(userFields["Full Name"] || username),
  role,
  superAdmin: getBool(userFields["Super Admin"]),
  defaultBase: String(userFields["Default Base"] || ""),
  permissions,
  availableBases: permissions,
  selectedBase: permissions[0],
};

    const response = NextResponse.json({
      success: true,
      user: session,
      redirectTo: defaultRedirect(role, permissions),
    });

    response.cookies.set(getCookieName(), createSessionToken(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    console.log("Login Error:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Login failed" },
      { status: 500 }
    );
  }
}
