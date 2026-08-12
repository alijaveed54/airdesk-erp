import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@libsql/client";

const BASE_ID = "app2hjpuQoeEL1Rn2";
const TABLE_NAME = "BS Order Entry";
const RECEIVED_FIELD = "Received In UAE";
const RECEIVED_AT_FIELD = "Received In UAE DateTime";
const ITEM_CODE_FIELD = "Item Code";
const ORDER_NUMBER_FIELD = "Order Number";
const APPLY = process.argv.includes("--apply");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

function requiredEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }

  throw new Error(`Missing environment variable: ${names.join(" or ")}`);
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function cleanText(value) {
  return String(firstValue(value) ?? "").trim();
}

function isYes(value) {
  if (value === true || value === 1) return true;

  if (Array.isArray(value)) {
    return value.some(isYes);
  }

  if (value && typeof value === "object") {
    if ("value" in value) return isYes(value.value);
    if ("name" in value) return isYes(value.name);
  }

  return ["yes", "true", "1", "checked"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function findFieldCaseInsensitive(object, fieldName) {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    return undefined;
  }

  const target = fieldName.trim().toLowerCase();
  for (const [key, value] of Object.entries(object)) {
    if (key.trim().toLowerCase() === target) return value;
  }

  return undefined;
}

function isReceivedTransition(row) {
  const changes = parseJson(row.changed_fields, {});
  const receivedChange = findFieldCaseInsensitive(changes, RECEIVED_FIELD);

  if (
    receivedChange &&
    typeof receivedChange === "object" &&
    !Array.isArray(receivedChange)
  ) {
    const oldValue = receivedChange.old;
    const newValue = receivedChange.new;
    return !isYes(oldValue) && isYes(newValue);
  }

  const oldData = parseJson(row.old_data, {});
  const newData = parseJson(row.new_data, {});
  const oldValue = findFieldCaseInsensitive(oldData, RECEIVED_FIELD);
  const newValue = findFieldCaseInsensitive(newData, RECEIVED_FIELD);

  return !isYes(oldValue) && isYes(newValue);
}

function airtableHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function airtableUrl(params) {
  const query = params ? `?${params.toString()}` : "";
  return `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${query}`;
}

async function fetchBlankReceivedDateRecords(token) {
  const records = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set(
      "filterByFormula",
      `AND(LOWER({${RECEIVED_FIELD}}&'')='yes',LEN({${RECEIVED_AT_FIELD}}&'')=0)`,
    );
    params.append("fields[]", RECEIVED_FIELD);
    params.append("fields[]", RECEIVED_AT_FIELD);
    params.append("fields[]", ITEM_CODE_FIELD);
    params.append("fields[]", ORDER_NUMBER_FIELD);
    if (offset) params.set("offset", offset);

    const response = await fetch(airtableUrl(params), {
      headers: airtableHeaders(token),
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          "Unable to load BS Order Entry records from Airtable",
      );
    }

    records.push(...(data.records || []));
    offset = String(data.offset || "");
  } while (offset);

  return records;
}

async function fetchReceivedAuditEvents(sql) {
  const result = await sql.execute({
    sql: `
      SELECT
        record_id,
        created_at,
        operation,
        old_data,
        new_data,
        changed_fields
      FROM audit_events
      WHERE base_id = ?
        AND table_name = ?
        AND operation IN ('CREATE', 'UPDATE')
        AND (
          changed_fields LIKE ? COLLATE NOCASE
          OR new_data LIKE ? COLLATE NOCASE
        )
      ORDER BY created_at ASC
    `,
    args: [
      BASE_ID,
      TABLE_NAME,
      `%${RECEIVED_FIELD}%`,
      `%${RECEIVED_FIELD}%`,
    ],
  });

  return result.rows.map((row) => ({
    record_id: String(row.record_id || ""),
    created_at: String(row.created_at || ""),
    operation: String(row.operation || ""),
    old_data: row.old_data,
    new_data: row.new_data,
    changed_fields: row.changed_fields,
  }));
}

async function updateAirtableDates(token, matches) {
  let updated = 0;

  for (let index = 0; index < matches.length; index += 10) {
    const batch = matches.slice(index, index + 10);
    const response = await fetch(airtableUrl(), {
      method: "PATCH",
      headers: airtableHeaders(token),
      body: JSON.stringify({
        records: batch.map((match) => ({
          id: match.recordId,
          fields: {
            [RECEIVED_AT_FIELD]: match.receivedAt,
          },
        })),
        typecast: true,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          "Unable to update Airtable received dates",
      );
    }

    updated += (data.records || []).length;
  }

  return updated;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(fileName, rows) {
  const headers = ["Record ID", "Order Number", "Item Code", "Received Date"];
  const lines = [headers.map(csvCell).join(",")];

  for (const row of rows) {
    lines.push(
      [row.recordId, row.orderNo, row.itemCode, row.receivedAt || ""]
        .map(csvCell)
        .join(","),
    );
  }

  fs.writeFileSync(path.resolve(process.cwd(), fileName), `${lines.join("\n")}\n`);
}

async function main() {
  const airtableToken = requiredEnv("AIRTABLE_TOKEN", "AUTH_AIRTABLE_TOKEN");
  const tursoUrl = requiredEnv("TURSO_DATABASE_URL");
  const tursoAuthToken = String(process.env.TURSO_AUTH_TOKEN || "").trim();

  const sql = createClient({
    url: tursoUrl,
    authToken: tursoAuthToken || undefined,
  });

  console.log("\nMysmar ERP — Received In UAE Date Backfill");
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "PREVIEW ONLY"}`);
  console.log(`Base: ${BASE_ID}`);
  console.log(`Table: ${TABLE_NAME}\n`);

  const [airtableRecords, auditEvents] = await Promise.all([
    fetchBlankReceivedDateRecords(airtableToken),
    fetchReceivedAuditEvents(sql),
  ]);

  const latestReceivedDateByRecord = new Map();
  for (const event of auditEvents) {
    if (!event.record_id || !event.created_at) continue;
    if (!isReceivedTransition(event)) continue;

    // Ordered ascending, so later valid re-receive events intentionally replace earlier ones.
    latestReceivedDateByRecord.set(event.record_id, event.created_at);
  }

  const matches = [];
  const unmatched = [];

  for (const record of airtableRecords) {
    const fields = record.fields || {};
    const row = {
      recordId: String(record.id || ""),
      orderNo: cleanText(fields[ORDER_NUMBER_FIELD]),
      itemCode: cleanText(fields[ITEM_CODE_FIELD]),
      receivedAt: latestReceivedDateByRecord.get(String(record.id || "")) || "",
    };

    if (row.receivedAt) matches.push(row);
    else unmatched.push(row);
  }

  writeCsv("received-in-uae-date-backfill-matched.csv", matches);
  writeCsv("received-in-uae-date-backfill-unmatched.csv", unmatched);

  console.log(`Received=Yes with blank date: ${airtableRecords.length}`);
  console.log(`Matched from audit history:   ${matches.length}`);
  console.log(`No exact audit date found:    ${unmatched.length}`);

  if (matches.length) {
    console.log("\nPreview (first 25 matched):");
    console.table(matches.slice(0, 25));
  }

  if (unmatched.length) {
    console.log("\nUnmatched items were NOT guessed and will remain blank.");
    console.log(
      "See: received-in-uae-date-backfill-unmatched.csv",
    );
  }

  if (!APPLY) {
    console.log("\nNo Airtable data was changed.");
    console.log(
      "After reviewing the matched CSV, run again with: node scripts/backfill-received-in-uae-datetime.mjs --apply",
    );
    return;
  }

  if (!matches.length) {
    console.log("\nNothing to update.");
    return;
  }

  const updated = await updateAirtableDates(airtableToken, matches);
  console.log(`\nSuccessfully updated ${updated} Airtable record(s).`);
  console.log("Existing non-blank dates were never touched.");
}

main().catch((error) => {
  console.error("\nBackfill failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
