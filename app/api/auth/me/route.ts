import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { apiError, apiSuccess, handleApiError } from "@/lib/airtable";

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return apiError("Not authenticated", 401);
    }

    return apiSuccess({ user: session });
  } catch (error) {
    return handleApiError(error, "Session fetch failed");
  }
}
