import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as airtableLib from "@/lib/airtable";

// Static review only — not runtime-tested.

interface BaseTarget {
  baseId: string;
  displayName: string;
  preferredTable?: string;
}

// Known Excluded Base IDs
const EXCLUDED_BASE_IDS = new Set([
  "app4YLp41AMlWtCxK", // Tatlumput Siyam Order Entry (TAT)
  "appX8tn2Yz6a7VAie", // i5Q/DQ
]);

function isExcludedBaseName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("i5q") ||
    lower.includes("dq") ||
    lower.includes("tatlumput") ||
    lower === "tat"
  );
}

function isTargetBaseName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("bs") ||
    lower.includes("fab doha non stock") ||
    lower.includes("fab doha stock") ||
    lower.includes("fab")
  );
}

// Helper: Unwrap Airtable lookup arrays (e.g. [150] -> 150)
function unwrapValue(val: any): any {
  if (Array.isArray(val)) {
    return val.length > 0 ? val[0] : null;
  }
  return val;
}

function toNumber(val: any): number {
  const unwrapped = unwrapValue(val);
  if (typeof unwrapped === "number") return Number.isFinite(unwrapped) ? unwrapped : 0;
  if (typeof unwrapped === "string") {
    const cleaned = unwrapped.replace(/[^0-9.-]/g, "");
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateKey(val: any): string | null {
  const unwrapped = unwrapValue(val);
  if (!unwrapped) return null;
  const str = String(unwrapped).trim();

  // Case 1: ISO Format YYYY-MM-DD...
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // Case 2: US Format M/D/YYYY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, "0");
    const d = slashMatch[2].padStart(2, "0");
    const y = slashMatch[3];
    return `${y}-${m}-${d}`;
  }

  return null;
}

// Helper: Parse bill_no (DDMMYYYY e.g. 18102026) -> YYYY-MM-DD
function parseBillNoToDateKey(
  rawBill: any,
  targetYear: string,
  targetMonth: string
): string | null {
  const str = String(unwrapValue(rawBill) ?? "").trim();
  if (!str) return null;

  const lower = str.toLowerCase();
  if (lower.includes("stock out") || lower.includes("sold out")) return null;

  const match = str.match(/(\d{2})(\d{2})(\d{4})/);
  if (!match) return null;

  const [, d, m, y] = match;
  if (y === targetYear && m === targetMonth) {
    return `${y}-${m}-${d}`;
  }
  return null;
}

async function resolveAirtableToken(): Promise<string | null> {
  const envToken =
    process.env.AIRTABLE_API_KEY ||
    process.env.AIRTABLE_PAT ||
    process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN ||
    process.env.AIRTABLE_TOKEN ||
    process.env.NEXT_PUBLIC_AIRTABLE_API_KEY;

  if (envToken) return envToken;

  try {
    const anyLib = airtableLib as any;
    if (typeof anyLib.getCurrentAirtableBase === "function") {
      const baseObj = await anyLib.getCurrentAirtableBase();
      if (baseObj?.apiKey) return baseObj.apiKey;
      if (baseObj?.token) return baseObj.token;
    }
  } catch {
    // ignore
  }

  return null;
}

// Discover target bases (BS + FAB Doha Non Stock + FAB Doha Stock) from env, lib/airtable, session, or Meta API
async function discoverTargetBases(
  token: string,
  session: any
): Promise<BaseTarget[]> {
  const map = new Map<string, BaseTarget>();

  const addBase = (baseId?: string, displayName?: string, preferredTable?: string) => {
    if (!baseId || typeof baseId !== "string" || !baseId.startsWith("app")) return;
    if (EXCLUDED_BASE_IDS.has(baseId)) return;
    const name = displayName || baseId;
    if (isExcludedBaseName(name)) return;

    if (!map.has(baseId)) {
      map.set(baseId, { baseId, displayName: name, preferredTable });
    }
  };

  // 1. Always include BS Order Entry (UAE)
  addBase("app2hjpuQoeEL1Rn2", "BS Order Entry (UAE)", "BS Order Entry");

  // 2. Check Environment Variables for FAB Doha Non Stock & FAB Doha Stock
  addBase(
    process.env.AIRTABLE_BASE_FAB_NON_STOCK ||
      process.env.FAB_DOHA_NON_STOCK_BASE_ID ||
      process.env.NEXT_PUBLIC_FAB_NON_STOCK_BASE_ID,
    "FAB Doha Non Stock"
  );
  addBase(
    process.env.AIRTABLE_BASE_FAB_STOCK ||
      process.env.FAB_DOHA_STOCK_BASE_ID ||
      process.env.NEXT_PUBLIC_FAB_STOCK_BASE_ID,
    "FAB Doha Stock"
  );

  // 3. Check exported constants/configs in @/lib/airtable if available
  try {
    const anyLib = airtableLib as any;
    for (const key of Object.keys(anyLib)) {
      const val = anyLib[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object") {
            const bId = item.baseId || item.id;
            const bName = item.displayName || item.name || item.label || "";
            if (bId && isTargetBaseName(bName)) {
              addBase(bId, bName, item.orderEntry || item.orderEntryTable);
            }
          }
        }
      } else if (val && typeof val === "object") {
        for (const subKey of Object.keys(val)) {
          const item = val[subKey];
          if (item && typeof item === "object") {
            const bId = item.baseId || item.id;
            const bName = item.displayName || item.name || item.label || subKey;
            if (bId && isTargetBaseName(bName)) {
              addBase(bId, bName, item.orderEntry || item.orderEntryTable);
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 4. Check user session permissions array
  if (Array.isArray(session?.permissions)) {
    for (const perm of session.permissions) {
      const bId = perm?.baseId || perm?.id;
      const bName = perm?.baseName || perm?.displayName || perm?.name || "";
      if (bId && !EXCLUDED_BASE_IDS.has(bId) && !isExcludedBaseName(bName)) {
        if (!bName || isTargetBaseName(bName)) {
          addBase(bId, bName || `Base (${bId})`);
        }
      }
    }
  }

  // 5. Query Airtable Meta API (/v0/meta/bases) to auto-discover FAB Doha Non Stock & FAB Doha Stock
  try {
    const metaRes = await fetch("https://api.airtable.com/v0/meta/bases", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      if (Array.isArray(metaData?.bases)) {
        for (const b of metaData.bases) {
          const bId = b.id;
          const bName = b.name || "";
          if (
            bId &&
            !EXCLUDED_BASE_IDS.has(bId) &&
            !isExcludedBaseName(bName) &&
            isTargetBaseName(bName)
          ) {
            // Update display name if already added with generic name, or add new
            map.set(bId, {
              baseId: bId,
              displayName: bName,
              preferredTable: map.get(bId)?.preferredTable,
            });
          }
        }
      }
    }
  } catch {
    // ignore meta error if token lacks schema.bases:read scope
  }

  return Array.from(map.values());
}

// Helper: Match field name case-insensitively from available table fields
function findField(availableFields: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (availableFields.has(c)) return c;
  }
  const lowerMap = new Map<string, string>();
  availableFields.forEach((f) => lowerMap.set(f.toLowerCase().trim(), f));
  for (const c of candidates) {
    const matched = lowerMap.get(c.toLowerCase().trim());
    if (matched) return matched;
  }
  return null;
}

// Resolve Order Entry table & exact field names for a base using Meta API (with fallback)
async function resolveTableSchema(
  baseTarget: BaseTarget,
  token: string
): Promise<{
  tableName: string;
  dateField: string;
  qtyField: string;
  billNoField: string | null;
  totalPriceField: string | null;
  costPriceField: string | null;
  billValueField: string | null;
  statusField: string | null;
} | null> {
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/meta/bases/${baseTarget.baseId}/tables`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    if (res.ok) {
      const data = await res.json();
      const tables: any[] = data?.tables || [];

      // Find the Order Entry / Line Items table (which has quantity & bill_no or order entry name)
      let selectedTable = tables.find(
        (t) =>
          baseTarget.preferredTable &&
          t.name.toLowerCase() === baseTarget.preferredTable.toLowerCase()
      );

      if (!selectedTable) {
        selectedTable = tables.find((t) => {
          const n = t.name.toLowerCase();
          return (
            n.includes("order entry") ||
            n.includes("line items") ||
            n.includes("order items")
          );
        });
      }

      if (!selectedTable) {
        // Fallback: find any table that has both a quantity field and bill_no / total_item_price
        selectedTable = tables.find((t) => {
          const fNames = new Set<string>((t.fields || []).map((f: any) => f.name.toLowerCase()));
          return (
            (fNames.has("quantity") || fNames.has("qty")) &&
            (fNames.has("bill_no") ||
              fNames.has("bill no") ||
              fNames.has("bill no.") ||
              fNames.has("total_item_price") ||
              fNames.has("item_price"))
          );
        });
      }

      if (selectedTable) {
        const fieldSet = new Set<string>(
          (selectedTable.fields || []).map((f: any) => String(f.name))
        );

        const dateField =
          findField(fieldSet, ["date", "Order Date", "Invoice Date", "created Date", "Created"]) ||
          "date";
        const qtyField =
          findField(fieldSet, ["quantity", "Quantity", "Qty", "total_order_quantity"]) ||
          "quantity";
        const billNoField = findField(fieldSet, [
          "bill_no",
          "Bill No",
          "Bill No.",
          "Bill Number",
        ]);
        const totalPriceField = findField(fieldSet, [
          "total_item_price",
          "Item_Price",
          "Total Item Price",
          "Price After Discount",
          "price (Before Discount)",
          "Price",
        ]);
        const costPriceField = findField(fieldSet, [
          "cost_price",
          "Cost Price",
          "Cost",
          "CP",
          "Purchase Price",
        ]);
        const billValueField = findField(fieldSet, [
          "Bill Value",
          "bill_value",
          "Purchase Value",
        ]);
        const statusField = findField(fieldSet, [
          "Order Status",
          "Order_status",
          "Order_Status",
          "Status",
        ]);

        return {
          tableName: selectedTable.name,
          dateField,
          qtyField,
          billNoField,
          totalPriceField,
          costPriceField,
          billValueField,
          statusField,
        };
      }
    }
  } catch {
    // Fall through to default BS-style schema
  }

  // Fallback if Meta API is unavailable
  return {
    tableName: baseTarget.preferredTable || "BS Order Entry",
    dateField: "date",
    qtyField: "quantity",
    billNoField: "bill_no",
    totalPriceField: "total_item_price",
    costPriceField: "cost_price",
    billValueField: "Bill Value",
    statusField: "Order Status",
  };
}

// Fetch records from Airtable REST API with pagination
async function fetchAirtableRecords(
  baseId: string,
  tableName: string,
  token: string,
  filterByFormula: string,
  fields: string[]
) {
  const allRecords: any[] = [];
  let offset: string | undefined = undefined;

  do {
    const params = new URLSearchParams();
    if (filterByFormula) {
      params.set("filterByFormula", filterByFormula);
    }
    for (const f of fields) {
      params.append("fields[]", f);
    }
    if (offset) {
      params.set("offset", offset);
    }

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}?${params.toString()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Airtable (${baseId}/${tableName}) Error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    if (Array.isArray(data.records)) {
      allRecords.push(...data.records);
    }
    offset = data.offset;
  } while (offset);

  return allRecords;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !session.username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.role === "Supplier") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const selectedMonth =
      searchParams.get("month") || new Date().toISOString().slice(0, 7);
    const [yearStr, monthStr] = selectedMonth.split("-");

    if (!yearStr || !monthStr || yearStr.length !== 4 || monthStr.length !== 2) {
      return NextResponse.json(
        { error: "Invalid month format. Expected YYYY-MM" },
        { status: 400 }
      );
    }

    // Initialize all days of the selected month
    const dailyMap: Record<
      string,
      { date: string; soldQty: number; soldValue: number; purchaseValue: number }
    > = {};

    const daysInMonth = new Date(Number(yearStr), Number(monthStr), 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dStr = String(day).padStart(2, "0");
      const dateKey = `${yearStr}-${monthStr}-${dStr}`;
      dailyMap[dateKey] = {
        date: dateKey,
        soldQty: 0,
        soldValue: 0,
        purchaseValue: 0,
      };
    }

    const token = await resolveAirtableToken();
    if (!token) {
      return NextResponse.json(
        {
          error:
            "Airtable API token not found in environment variables.",
        },
        { status: 500 }
      );
    }

    const targetBases = await discoverTargetBases(token, session);
    const billSuffix = `${monthStr}${yearStr}`; // e.g. "102026"

    let totalRecordsFetched = 0;
    let soldRecordsMatched = 0;
    let purchaseRecordsMatched = 0;
    const baseSummaries: {
      baseName: string;
      tableName: string;
      recordsFetched: number;
      soldMatched: number;
      purchaseMatched: number;
      error?: string;
    }[] = [];

    // Fetch and aggregate across all target bases concurrently
    await Promise.all(
      targetBases.map(async (baseTarget) => {
        try {
          const schema = await resolveTableSchema(baseTarget, token);
          if (!schema) {
            baseSummaries.push({
              baseName: baseTarget.displayName,
              tableName: "Not Found",
              recordsFetched: 0,
              soldMatched: 0,
              purchaseMatched: 0,
              error: "Could not resolve Order Entry table",
            });
            return;
          }

          const formulaParts = [
            `FIND('${selectedMonth}', DATETIME_FORMAT({${schema.dateField}}, 'YYYY-MM')) > 0`,
          ];
          if (schema.billNoField) {
            formulaParts.push(
              `FIND('${billSuffix}', {${schema.billNoField}} & '') > 0`
            );
          }
          const formula =
            formulaParts.length > 1
              ? `OR(${formulaParts.join(", ")})`
              : formulaParts[0];

          const fieldsToFetch = [
            schema.dateField,
            schema.qtyField,
            schema.billNoField,
            schema.totalPriceField,
            schema.costPriceField,
            schema.billValueField,
            schema.statusField,
          ].filter(Boolean) as string[];

          const records = await fetchAirtableRecords(
            baseTarget.baseId,
            schema.tableName,
            token,
            formula,
            fieldsToFetch
          );

          let baseSold = 0;
          let basePurchase = 0;

          for (const rec of records) {
            const f = rec.fields || {};

            const qty = toNumber(f[schema.qtyField]);
            const itemSellingValue = schema.totalPriceField
              ? toNumber(f[schema.totalPriceField])
              : 0;
            const orderStatus = schema.statusField
              ? String(unwrapValue(f[schema.statusField]) || "").toLowerCase()
              : "";

            // 1. Sold Qty & Sold Value (by Date)
            const orderDateKey = toDateKey(f[schema.dateField]);
            if (
              orderDateKey &&
              dailyMap[orderDateKey] &&
              orderStatus !== "cancelled"
            ) {
              dailyMap[orderDateKey].soldQty += qty;
              dailyMap[orderDateKey].soldValue += itemSellingValue;
              baseSold++;
              soldRecordsMatched++;
            }

            // 2. Purchase on that day (by bill_no DDMMYYYY)
            if (schema.billNoField) {
              const purchaseDateKey = parseBillNoToDateKey(
                f[schema.billNoField],
                yearStr,
                monthStr
              );
              if (purchaseDateKey && dailyMap[purchaseDateKey]) {
                const billVal = schema.billValueField
                  ? toNumber(f[schema.billValueField])
                  : 0;
                const unitCost = schema.costPriceField
                  ? toNumber(f[schema.costPriceField])
                  : 0;
                const purchaseAmount = billVal > 0 ? billVal : unitCost * qty;

                dailyMap[purchaseDateKey].purchaseValue +=
                  purchaseAmount > 0 ? purchaseAmount : qty;
                basePurchase++;
                purchaseRecordsMatched++;
              }
            }
          }

          totalRecordsFetched += records.length;
          baseSummaries.push({
            baseName: baseTarget.displayName,
            tableName: schema.tableName,
            recordsFetched: records.length,
            soldMatched: baseSold,
            purchaseMatched: basePurchase,
          });
        } catch (baseErr: any) {
          console.error(
            `[Overall Report] Error on base ${baseTarget.displayName}:`,
            baseErr
          );
          baseSummaries.push({
            baseName: baseTarget.displayName,
            tableName: baseTarget.preferredTable || "Unknown",
            recordsFetched: 0,
            soldMatched: 0,
            purchaseMatched: 0,
            error: baseErr?.message || "Failed to query base",
          });
        }
      })
    );

    const reportData = Object.values(dailyMap).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    return NextResponse.json({
      success: true,
      month: selectedMonth,
      basesIncluded: baseSummaries,
      stats: {
        totalRecordsFetched,
        soldRecordsMatched,
        purchaseRecordsMatched,
      },
      data: reportData,
    });
  } catch (error: any) {
    console.error("[Overall Sales & Purchase Report Error]:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to generate report" },
      { status: 500 }
    );
  }
}