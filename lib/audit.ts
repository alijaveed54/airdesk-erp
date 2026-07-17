import { getSession } from "@/lib/auth";

const AUTH_AIRTABLE_TOKEN = process.env.AUTH_AIRTABLE_TOKEN;
const AUTH_AIRTABLE_BASE_ID = process.env.AUTH_AIRTABLE_BASE_ID;

type AuditInput = {
  action: string;
  module: string;
  recordId?: string;
  recordLabel?: string;
  oldValue?: string;
  newValue?: string;
  note?: string;
};

export async function createAuditLog(input: AuditInput) {
  try {
    const session = await getSession();

    if (!AUTH_AIRTABLE_TOKEN || !AUTH_AIRTABLE_BASE_ID) return;

    await fetch(
      `https://api.airtable.com/v0/${AUTH_AIRTABLE_BASE_ID}/${encodeURIComponent("Activity Log")}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            User: session?.username || "System",
            "Full Name": session?.fullName || "",
            Role: session?.role || "",
            Company: session?.selectedBase?.baseName || "",
            Module: input.module,
            Action: input.action,
            "Record ID": input.recordId || "",
            "Record Label": input.recordLabel || "",
            "Old Value": input.oldValue || "",
            "New Value": input.newValue || "",
            Note: input.note || "",
            Date: new Date().toISOString(),
          },
        }),
      }
    );
  } catch (error) {
    console.log("Audit log failed:", error);
  }
}
