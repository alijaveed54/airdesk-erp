import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { apiError, apiSuccess, handleApiError } from "@/lib/airtable";

const AUTH_AIRTABLE_TOKEN = process.env.AUTH_AIRTABLE_TOKEN;
const AUTH_AIRTABLE_BASE_ID = process.env.AUTH_AIRTABLE_BASE_ID;

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AUTH_AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function airtableUrl(table: string, params?: URLSearchParams) {
  const query = params ? `?${params.toString()}` : "";
  return `https://api.airtable.com/v0/${AUTH_AIRTABLE_BASE_ID}/${encodeURIComponent(table)}${query}`;
}

function getFirst(value: any) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listRecords(table: string, filterByFormula?: string) {
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    if (filterByFormula) params.set("filterByFormula", filterByFormula);
    if (offset) params.set("offset", offset);

    const res = await fetch(airtableUrl(table, params), {
      headers: airtableHeaders(),
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(JSON.stringify(data));
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

export async function GET() {
  try {
    if (!AUTH_AIRTABLE_TOKEN || !AUTH_AIRTABLE_BASE_ID) {
      return apiError("Auth Airtable env missing", 500);
    }

    const [users, bases, access] = await Promise.all([
      listRecords("ERP Users"),
      listRecords("ERP Bases", "{Active}=1"),
      listRecords("User Base Access"),
    ]);

    const rows = users.map((user) => {
      const f = user.fields || {};
      const username = String(f.Username || "");

      const userAccess = access
        .filter(
          (row) =>
            String(row.fields?.Username || "").toLowerCase() ===
            username.toLowerCase(),
        )
        .map((row) => ({
          id: row.id,
          baseName: String(getFirst(row.fields?.["Base Name"]) || ""),
          supplierCode: String(row.fields?.["Supplier Code"] || ""),
          canView: row.fields?.["Can View"] === true,
          canEdit: row.fields?.["Can Edit"] === true,
          canReports: row.fields?.["Can Reports"] === true,
          canDispatch: row.fields?.["Can Dispatch"] === true,
          canReceive: row.fields?.["Can Receive"] === true,
          canInventory: row.fields?.["Can Inventory"] === true,
          canFinance: row.fields?.["Can Finance"] === true,
          canUsers: row.fields?.["Can Users"] === true,
          canDelete: row.fields?.["Can Delete"] === true,
          active: row.fields?.Active === true,
        }));

      return {
        id: user.id,
        username,
        password: String(f.Password || ""),
        email: String(f.Email || ""),
        fullName: String(f["Full Name"] || ""),
        role: String(f.Role || "Employee"),
        defaultBase: String(f["Default Base"] || ""),
        lastLogin: String(f["Last Login"] || ""),
        loginCount: Number(f["Login Count"] || 0),
        active: f.Active === true,
        access: userAccess,
      };
    });

    return apiSuccess({
      users: rows,
      bases: bases.map((base) => ({
        id: base.id,
        baseName: String(
          base.fields?.["Base Name"] || base.fields?.["Display Name"] || "",
        ),
        baseId: String(base.fields?.["Base ID"] || ""),
        active: base.fields?.Active === true,
      })),
    });
  } catch (error) {
    return handleApiError(error, "Users load failed");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim();
    const role = String(body.role || "Employee").trim();
    const active = body.active !== false;

    if (!username || !password || !fullName) {
      return apiError("Username, password and full name are required", 400);
    }

    const existing = await listRecords(
      "ERP Users",
      `LOWER({Username})=LOWER('${escapeAirtableString(username)}')`,
    );

    if (existing.length > 0) {
      return apiError("Username already exists", 409);
    }

    const res = await fetch(airtableUrl("ERP Users"), {
      method: "POST",
      headers: airtableHeaders(),
      body: JSON.stringify({
        fields: {
          Username: username,
          Password: password,
          Email: email,
          "Full Name": fullName,
          Role: role,
          Active: active,
          ...(body.defaultBase
            ? { "Default Base": String(body.defaultBase) }
            : {}),
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          message: data?.error?.message || JSON.stringify(data),
          error: data,
        },
        { status: res.status },
      );
    }

    await createAuditLog({
      module: "Users",
      action: "Create User",
      recordId: data.id,
      recordLabel: username,
      newValue: JSON.stringify({ username, fullName, role }),
    });

    return apiSuccess({ user: data });
  } catch (error) {
    return handleApiError(error, "User create failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    const id = String(body.id || "");
    const fields: Record<string, any> = {};

    if (!id) {
      return NextResponse.json(
        { success: false, message: "User ID is required" },
        { status: 400 },
      );
    }

    if ("password" in body) fields.Password = String(body.password || "");
    if ("fullName" in body) fields["Full Name"] = String(body.fullName || "");
    if ("email" in body) fields.Email = String(body.email || "");
    if ("role" in body) fields.Role = String(body.role || "Employee");
    if ("defaultBase" in body)
      fields["Default Base"] = String(body.defaultBase || "");
    if ("active" in body) fields.Active = body.active === true;

    const res = await fetch(airtableUrl("ERP Users"), {
      method: "PATCH",
      headers: airtableHeaders(),
      body: JSON.stringify({
        records: [
          {
            id,
            fields,
          },
        ],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: "User update failed", error: data },
        { status: res.status },
      );
    }

    await createAuditLog({
      module: "Users",
      action: "Update User",
      recordId: id,
      recordLabel: id,
      newValue: JSON.stringify(fields),
    });

    return apiSuccess({ records: data.records || [] });
  } catch (error) {
    return handleApiError(error, "User update failed");
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();

    const username = String(body.username || "").trim();
    const baseName = String(body.baseName || "").trim();

    if (!username || !baseName) {
      return NextResponse.json(
        { success: false, message: "Username and base name are required" },
        { status: 400 },
      );
    }

    let fields: Record<string, any> = {
      Username: username,
      "Base Name": baseName,
      "Supplier Code": String(body.supplierCode || ""),
      "Can View": body.canView === true,
      "Can Edit": body.canEdit === true,
      "Can Reports": body.canReports === true,
      "Can Dispatch": body.canDispatch === true,
      "Can Receive": body.canReceive === true,
      "Can Inventory": body.canInventory === true,
      "Can Finance": body.canFinance === true,
      "Can Users": body.canUsers === true,
      "Can Delete": body.canDelete === true,
      Active: body.active !== false,
    };

    while (true) {
      const res = await fetch(airtableUrl("User Base Access"), {
        method: body.id ? "PATCH" : "POST",
        headers: airtableHeaders(),
        body: JSON.stringify(body.id ? {records:[{id:body.id,fields}]} : {fields}),
      });

      const data = await res.json();

      if (res.ok) return apiSuccess({data});

      const msg = String(data?.error?.message || "");
      const m = msg.match(/Unknown field name:?\s*"([^"]+)"/i);
      if (!m || !(m[1] in fields)) {
        return NextResponse.json({success:false,message:msg,error:data},{status:res.status});
      }
      delete fields[m[1]];
    }
  } catch (error) {
    return handleApiError(error, "Base access save failed");
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get("id") || "");
    const type = String(searchParams.get("type") || "access");

    if (!id) {
      return apiError("Record ID is required", 400);
    }

    if (type === "user") {
      const users = await listRecords("ERP Users");
      const user = users.find((row) => row.id === id);

      if (!user) {
        return apiError("User not found", 404);
      }

      const username = String(user.fields?.Username || "");
      const accessRows = await listRecords(
        "User Base Access",
        `LOWER({Username})=LOWER('${escapeAirtableString(username)}')`,
      );

      for (const accessRow of accessRows) {
        const params = new URLSearchParams();
        params.set("records[]", accessRow.id);

        const accessRes = await fetch(airtableUrl("User Base Access", params), {
          method: "DELETE",
          headers: airtableHeaders(),
        });

        const accessData = await accessRes.json();
        if (!accessRes.ok) {
          return NextResponse.json(
            {
              success: false,
              message: "User base access delete failed",
              error: accessData,
            },
            { status: accessRes.status },
          );
        }
      }

      const params = new URLSearchParams();
      params.set("records[]", id);

      const res = await fetch(airtableUrl("ERP Users", params), {
        method: "DELETE",
        headers: airtableHeaders(),
      });

      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(
          { success: false, message: "User delete failed", error: data },
          { status: res.status },
        );
      }

      await createAuditLog({
        module: "Users",
        action: "Delete User",
        recordId: id,
        recordLabel: username,
      });

      return apiSuccess({ data });
    }

    const params = new URLSearchParams();
    params.set("records[]", id);

    const res = await fetch(airtableUrl("User Base Access", params), {
      method: "DELETE",
      headers: airtableHeaders(),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: "Base access delete failed", error: data },
        { status: res.status },
      );
    }

    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error, "Delete failed");
  }
}
