import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
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

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function POST(request: Request) {
  try {
    if (!AUTH_AIRTABLE_TOKEN || !AUTH_AIRTABLE_BASE_ID) {
      return apiError("Auth Airtable env missing", 500);
    }

    const session = await getSession();

    if (!session?.username) {
      return apiError("Not authenticated", 401);
    }

    const body = await request.json();
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      return apiError("All password fields are required", 400);
    }

    if (newPassword.length < 6) {
      return apiError("New password must be at least 6 characters", 400);
    }

    if (newPassword !== confirmPassword) {
      return apiError("New password and confirm password do not match", 400);
    }

    if (currentPassword === newPassword) {
      return apiError("New password must be different from current password", 400);
    }

    const params = new URLSearchParams();
    params.set(
      "filterByFormula",
      `LOWER({Username})=LOWER('${escapeAirtableString(String(session.username))}')`,
    );
    params.set("maxRecords", "1");

    const findRes = await fetch(airtableUrl("ERP Users", params), {
      headers: airtableHeaders(),
      cache: "no-store",
    });

    const findData = await findRes.json();

    if (!findRes.ok) {
      return NextResponse.json(
        {
          success: false,
          message: findData?.error?.message || "User lookup failed",
          error: findData,
        },
        { status: findRes.status },
      );
    }

    const user = findData.records?.[0];

    if (!user) {
      return apiError("User account not found", 404);
    }

    if (String(user.fields?.Password || "") !== currentPassword) {
      return apiError("Current password is incorrect", 400);
    }

    const updateRes = await fetch(airtableUrl("ERP Users"), {
      method: "PATCH",
      headers: airtableHeaders(),
      body: JSON.stringify({
        records: [
          {
            id: user.id,
            fields: {
              Password: newPassword,
            },
          },
        ],
      }),
    });

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      return NextResponse.json(
        {
          success: false,
          message: updateData?.error?.message || "Password update failed",
          error: updateData,
        },
        { status: updateRes.status },
      );
    }

    await createAuditLog({
      module: "Profile",
      action: "Change Password",
      recordId: user.id,
      recordLabel: String(session.username),
      note: "User changed own password",
    });

    return apiSuccess({
      message: "Password changed successfully. Please login again.",
    });
  } catch (error) {
    return handleApiError(error, "Password change failed");
  }
}
