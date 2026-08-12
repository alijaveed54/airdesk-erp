export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const {
    installGlobalAirtableAudit,
  } = await import(
    "./lib/audit-airtable-fetch"
  );

  installGlobalAirtableAudit();
}
