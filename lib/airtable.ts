const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!AIRTABLE_TOKEN) {
  throw new Error("AIRTABLE_TOKEN is missing in .env.local");
}

if (!AIRTABLE_BASE_ID) {
  throw new Error("AIRTABLE_BASE_ID is missing in .env.local");
}

export async function airtableRequest(
  tableName: string,
  params: Record<string, string> = {}
) {
  const url = new URL(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
      tableName
    )}`
  );

  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Airtable Error: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function getProducts({
  search = "",
  offset = "",
  pageSize = "50",
}: {
  search?: string;
  offset?: string;
  pageSize?: string;
}) {
  const params: Record<string, string> = {
    pageSize,
  };

  if (offset) {
    params.offset = offset;
  }

  if (search.trim()) {
  const safeSearch = search.trim().replaceAll('"', '\\"');

  params.filterByFormula = `FIND(LOWER("${safeSearch}"), LOWER({SKU} & ""))`;
}

  return airtableRequest("Products", params);
}