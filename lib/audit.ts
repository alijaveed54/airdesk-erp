import {
  getAuditActor,
  getAuditSource,
  insertAuditEvents,
} from "@/lib/audit-db";
import {
  parseLegacyValue,
} from "@/lib/audit-redaction";

export type AuditInput = {
  action: string;
  module: string;
  recordId?: string;
  recordLabel?: string;
  oldValue?: string;
  newValue?: string;
  note?: string;
};

function legacySummaryEnabled() {
  const value = String(
    process.env.AUDIT_LEGACY_SUMMARY ?? "false"
  )
    .trim()
    .toLowerCase();

  return ["1", "true", "yes", "on"].includes(value);
}

export async function createAuditLog(
  input: AuditInput
) {
  // Legacy route summaries are not actual Airtable field-level events.
  // Keep them off unless explicitly enabled, avoiding duplicates and
  // ensuring /activity contains only real Airtable mutations.
  if (!legacySummaryEnabled()) {
    return;
  }

  try {
    const actor = await getAuditActor();

    const oldData = parseLegacyValue(input.oldValue);
    const newData = parseLegacyValue(input.newValue);

    await insertAuditEvents([
      {
        id: crypto.randomUUID(),
        eventGroupId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),

        actorUsername: actor.actorUsername,
        actorFullName: actor.actorFullName,
        actorRole: actor.actorRole,
        companyName: actor.companyName,

        baseId: "",
        tableName: "Orders",
        recordId: input.recordId || "",
        recordLabel:
          input.recordLabel ||
          input.recordId ||
          "",

        module: input.module,
        action: input.action,

        operation:
          input.action.toLowerCase().includes("create")
            ? "CREATE"
            : "UPDATE",

        oldData,
        newData,

        changedFields: {},

        sourceHost: getAuditSource(),

        metadata: {
          note: input.note || "",
          manualAudit: true,
        },
      },
    ]);
  } catch (error) {
    console.error(
      "Audit log insert failed:",
      error
    );
  }
}
