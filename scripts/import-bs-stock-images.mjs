import fs from "node:fs/promises";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 0) : 0;

const BASE_ID = String(
  process.env.BS_STOCK_AIRTABLE_BASE_ID || "app2hjpuQoeEL1Rn2"
).trim();

const TABLE_NAME = String(
  process.env.BS_STOCK_AIRTABLE_TABLE || "BS Stock"
).trim();

const TOKEN = String(
  process.env.BS_STOCK_AIRTABLE_TOKEN ||
  process.env.AIRTABLE_TOKEN ||
  process.env.AIRTABLE_ADMIN_TOKEN ||
  ""
).trim();

const SKU_FIELD = "SKU";
const IMAGE_FIELD = "Image";
const MAPPING_FILE = new URL("../data/bs-stock-images.json", import.meta.url);

if (!TOKEN) {
  console.error("ERROR: Airtable token not found.");
  console.error(
    "Add BS_STOCK_AIRTABLE_TOKEN to .env.local, or ensure AIRTABLE_TOKEN is available."
  );
  process.exit(1);
}

function tableUrl(params = {}) {
  const url = new URL(
    `https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(TABLE_NAME)}`
  );

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error?.type ||
      data?.message ||
      `HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}

async function loadAllStockRecords() {
  const records = [];
  let offset = "";

  do {
    const data = await request(
      tableUrl({
        pageSize: 100,
        offset,
      })
    );

    records.push(...(data.records || []));
    offset = String(data.offset || "");
  } while (offset);

  return records;
}

async function patchBatch(records) {
  return request(tableUrl(), {
    method: "PATCH",
    body: JSON.stringify({
      records,
    }),
  });
}

const raw = await fs.readFile(MAPPING_FILE, "utf8");
const sourceRows = JSON.parse(raw);

console.log("==============================================");
console.log("BS STOCK — ONE-TIME IMAGE IMPORT");
console.log("==============================================");
console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`Base: ${BASE_ID}`);
console.log(`Table: ${TABLE_NAME}`);
console.log(`Source image mappings: ${sourceRows.length}`);
if (LIMIT) console.log(`Apply limit: ${LIMIT}`);
console.log("");

const stockRecords = await loadAllStockRecords();

console.log(`Airtable records found: ${stockRecords.length}`);

const bySku = new Map();
const duplicateAirtableSkus = [];

for (const record of stockRecords) {
  const rawSku = String(record.fields?.[SKU_FIELD] || "").trim();
  const key = rawSku.toLowerCase();

  if (!key) continue;

  if (bySku.has(key)) {
    duplicateAirtableSkus.push(rawSku);
    continue;
  }

  bySku.set(key, record);
}

const updates = [];
const missingSkus = [];
const alreadyHasImage = [];

for (const row of sourceRows) {
  const key = String(row.sku || "").trim().toLowerCase();
  const record = bySku.get(key);

  if (!record) {
    missingSkus.push(row.sku);
    continue;
  }

  const currentImage = record.fields?.[IMAGE_FIELD];

  if (Array.isArray(currentImage) && currentImage.length > 0) {
    alreadyHasImage.push(row.sku);
    continue;
  }

  updates.push({
    id: record.id,
    sku: row.sku,
    fields: {
      [IMAGE_FIELD]: [
        {
          url: row.imageUrl,
        },
      ],
    },
  });
}

console.log(`Matched and ready: ${updates.length}`);
console.log(`Already has image: ${alreadyHasImage.length}`);
console.log(`SKU missing from Airtable: ${missingSkus.length}`);
console.log(`Duplicate SKU in Airtable: ${duplicateAirtableSkus.length}`);
console.log("");

const preview = updates.slice(0, 10).map((item) => item.sku);
if (preview.length) {
  console.log("First matching SKUs:");
  for (const sku of preview) console.log(`  - ${sku}`);
  console.log("");
}

if (!APPLY) {
  console.log("DRY RUN COMPLETE — no Airtable record was changed.");
  console.log("");
  console.log("Test first 5 images:");
  console.log(
    "node --env-file=.env.local scripts\\import-bs-stock-images.mjs --apply --limit=5"
  );
  console.log("");
  console.log("Full import after checking the 5 images:");
  console.log(
    "node --env-file=.env.local scripts\\import-bs-stock-images.mjs --apply"
  );
  process.exit(0);
}

let queue = updates;
if (LIMIT) queue = updates.slice(0, LIMIT);

let completed = 0;
let failed = 0;
const failures = [];

for (let index = 0; index < queue.length; index += 10) {
  const batch = queue.slice(index, index + 10);

  try {
    await patchBatch(
      batch.map(({ id, fields }) => ({
        id,
        fields,
      }))
    );

    completed += batch.length;
    console.log(`Updated ${completed}/${queue.length}`);
  } catch (error) {
    failed += batch.length;

    failures.push({
      skus: batch.map((item) => item.sku),
      error: error instanceof Error ? error.message : String(error),
    });

    console.error(
      `Batch failed ${index + 1}-${index + batch.length}: ${failures.at(-1).error}`
    );
  }

  // Airtable API rate limit is handled conservatively.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const report = {
  mode: "apply",
  baseId: BASE_ID,
  tableName: TABLE_NAME,
  sourceMappings: sourceRows.length,
  airtableRecords: stockRecords.length,
  matchedBeforeLimit: updates.length,
  attempted: queue.length,
  updated: completed,
  alreadyHasImage: alreadyHasImage.length,
  missingSkuCount: missingSkus.length,
  missingSkus,
  duplicateAirtableSkuCount: duplicateAirtableSkus.length,
  duplicateAirtableSkus,
  failed,
  failures,
  finishedAtUtc: new Date().toISOString(),
};

const reportPath = new URL(
  "../BS_Stock_Image_Import_Report.json",
  import.meta.url
);

await fs.writeFile(
  reportPath,
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log("");
console.log("==============================================");
console.log("FINISHED");
console.log("==============================================");
console.log(`Updated: ${completed}`);
console.log(`Failed: ${failed}`);
console.log(`Missing SKU: ${missingSkus.length}`);
console.log(`Already had image: ${alreadyHasImage.length}`);
console.log("");
console.log("Report: BS_Stock_Image_Import_Report.json");

if (failed > 0) process.exitCode = 1;
