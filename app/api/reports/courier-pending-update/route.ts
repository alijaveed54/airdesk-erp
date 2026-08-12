import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type SessionBase = {
  baseName: string;
  baseId: string;
  airtableToken?: string;
  invoiceTable?: string;
  canReports?: boolean;
};

type SchemaField = {
  id: string;
  name: string;
  type?: string;
};

type SchemaTable = {
  id: string;
  name: string;
  fields?: SchemaField[];
};

type PendingRow = {
  id: string;
  recordId: string;
  baseId: string;
  baseName: string;
  orderNo: string;
  store: string;
  customer: string;
  phone: string;
  courier: string;
  deliveryFieldLabel: "Courier" | "Driver";
  status: string;
  value: number;
  despatchDate: string;
  days: number;
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function firstValue(value: any) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function numberValue(value: any) {
  const parsed = Number(firstValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFieldName(fields: SchemaField[], candidates: string[]) {
  const map = new Map(
    fields.map((field) => [normalize(field.name), field.name]),
  );

  for (const candidate of candidates) {
    const found = map.get(normalize(candidate));
    if (found) return found;
  }

  return "";
}

function isOperationalBase(base: SessionBase) {
  const name = normalize(base.baseName);
  return Boolean(base.baseId) && !name.includes("admin");
}

function resolveToken(base: SessionBase) {
  return (
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    base.airtableToken ||
    ""
  );
}

async function getSchema(baseId: string, token: string) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Schema load failed for ${baseId}`,
    );
  }

  return (data.tables || []) as SchemaTable[];
}

function findInvoiceTable(
  tables: SchemaTable[],
  base: SessionBase,
) {
  const configured = normalize(base.invoiceTable);

  if (configured) {
    const exact = tables.find(
      (table) => normalize(table.name) === configured,
    );
    if (exact) return exact;
  }

  const baseName = normalize(base.baseName);
  const preferred =
    baseName.includes("dq") || baseName.includes("i5q")
      ? ["DQ Invoice"]
      : baseName.includes("fab")
        ? ["FAB Invoice"]
        : baseName.includes("tat")
          ? ["TAT Invoice", "BS Invoice", "Invoice"]
          : ["BS Invoice", "Invoice"];

  for (const name of preferred) {
    const found = tables.find(
      (table) => normalize(table.name) === normalize(name),
    );
    if (found) return found;
  }

  return tables.find((table) =>
    normalize(table.name).includes("invoice"),
  );
}

async function fetchAllRecords({
  baseId,
  token,
  tableName,
  fields,
}: {
  baseId: string;
  token: string;
  tableName: string;
  fields: string[];
}) {
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    for (const field of fields) {
      if (field) params.append("fields[]", field);
    }

    if (offset) params.set("offset", offset);

    const response = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Pending courier fetch failed for ${tableName}`,
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

function dateMatchesMonth(value: unknown, month: string) {
  if (!month) return true;

  const raw = firstValue(value);
  if (!raw) return false;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return false;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` === month;
}

function pendingDays(value: unknown) {
  const raw = firstValue(value);
  if (!raw) return 0;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 0;

  return Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 86400000),
  );
}

function buildBsOrderNumber({
  store,
  number,
  resend,
}: {
  store: unknown;
  number: unknown;
  resend: unknown;
}) {
  const storeName = String(firstValue(store) || "").trim();
  const rawNumber = String(firstValue(number) || "").trim();
  const resendValue = String(firstValue(resend) || "").trim();

  if (!rawNumber) return "";

  const prefixByStore: Record<string, string> = {
  "live store": "BLS",
  "bestshop.ae": "BBS",
  "fab ethnic uae": "BFEU",
  rushnas: "BSH",
  ethnofash: "BEF",
  "clarance store": "BCLR",
  "sooper deals": "BSD",
  "u5store.com": "BUS",
  ef: "BEF",
  "rushna boutique": "BSM",
  "fab uae": "BFAB",
  styleshop: "BSS",
  desiluxe: "BDL",
  "test store": "BTS",
};

  const prefix = prefixByStore[normalize(storeName)] || "";
  const baseOrderNo = `${prefix}${rawNumber}`;

  return resendValue ? `${baseOrderNo}${resendValue}` : baseOrderNo;
}

function isPendingCourierStatus(value: unknown) {
  const status = normalize(firstValue(value));

  if (!status) return false;

  const terminal =
    status.includes("deliver") ||
    status.includes("return") ||
    status.includes("cancel") ||
    status === "order received";

  return !terminal;
}

async function updateRecords({
  baseId,
  token,
  tableName,
  statusField,
  recordIds,
  status,
}: {
  baseId: string;
  token: string;
  tableName: string;
  statusField: string;
  recordIds: string[];
  status: "Delivered" | "Returned";
}) {
  let updated = 0;

  for (let index = 0; index < recordIds.length; index += 10) {
    const batch = recordIds.slice(index, index + 10);

    const response = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          records: batch.map((recordId) => ({
            id: recordId,
            fields: {
              [statusField]: status,
            },
          })),
          typecast: true,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Unable to update ${tableName}`,
      );
    }

    updated += (data.records || []).length;
  }

  return updated;
}

async function getAllowedBases() {
  const session = await getSession();

  if (!session) {
    return {
      error: NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      ),
    };
  }

  const permissions = (
    session.availableBases?.length
      ? session.availableBases
      : session.permissions || []
  ) as SessionBase[];

  const allowedBases = permissions.filter(
    (base) => isOperationalBase(base) && base.canReports !== false,
  );

  const role = normalize(session.role);
  const showAllAllowedBases =
    role === "admin" ||
    role === "manager" ||
    Boolean(session.superAdmin);

  const selectedBaseId = session.selectedBase?.baseId || "";

const selectedBase =
  allowedBases.find((base) => base.baseId === selectedBaseId) ||
  allowedBases[0];

return {
  session,
  bases: allowedBases,
};
}

export async function GET(request: Request) {
  try {
    const access = await getAllowedBases();
    if ("error" in access) return access.error;

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || "";
const courierFilter = normalize(searchParams.get("courier"));
const storeFilter = normalize(searchParams.get("store"));
const baseFilter = searchParams.get("baseId") || "";

    const rows: PendingRow[] = [];
    console.log("BASE FILTER", baseFilter);
console.log("MONTH", month);
console.log("COURIER", courierFilter);
console.log("STORE", storeFilter);
    const warnings: Array<{ baseName: string; message: string }> = [];
const filteredBases = baseFilter
  ? (access.bases || []).filter(
      (base) => base.baseId === baseFilter
    )
  : access.bases || [];
    for (const base of filteredBases) {
      try {
        const token = resolveToken(base);
        if (!token) throw new Error("Airtable token missing");

        const tables = await getSchema(base.baseId, token);
        const invoiceTable = findInvoiceTable(tables, base);

        if (!invoiceTable) {
          throw new Error("Invoice table not found");
        }

        const fields = invoiceTable.fields || [];
        const baseName = normalize(base.baseName);

        const useDriver =
          baseName.includes("fab") ||
          baseName.includes("dq") ||
          baseName.includes("i5q");

        const deliveryField = getFieldName(
          fields,
          useDriver
            ? ["Driver Name", "Driver", "Courier"]
            : ["Courier", "Courier Name", "Driver Name"],
        );

        const statusField = getFieldName(fields, [
          "order_status",
          "Order_status",
          "Order Status",
          "Status",
        ]);

        const dispatchDateField = getFieldName(fields, [
          "Despatch Date",
          "Dispatch Date 2",
          "Dispatch Date",
          "Delivery Date",
        ]);

        const storeField = getFieldName(fields, [
          "Select Store",
          "Store",
        ]);

        const valueField = getFieldName(fields, [
          "total_order_value",
          "Total Order Value",
          "Total Amount(Including shipping and VAT Reducing Discount)",
          "Grand Total",
          "Bill Value",
          "COD Amount",
          "Total",
        ]);

        const orderNoField = getFieldName(fields, [
          "order_no",
          "Order Number",
          "Order No.",
          "Order No",
          "Invoice No.",
          "Number",
        ]);

        const numberField = getFieldName(fields, [
          "Number",
          "Autonumber",
          "Auto Number",
        ]);

        const resendField = getFieldName(fields, [
          "Resend",
          "Re-send",
          "Re Send",
        ]);

        const customerField = getFieldName(fields, [
          "Consignee",
          "Customer Name",
          "Name (from Contact No.)",
          "Name",
        ]);

        const phoneField = getFieldName(fields, [
          "Telephone1",
          "Contact No.",
          "Contact No",
          "Phone",
          "Mobile",
        ]);

        if (!deliveryField || !statusField || !dispatchDateField) {
          throw new Error(
            `Required Courier/Driver, Status or Despatch Date field missing in ${invoiceTable.name}`,
          );
        }

        const records = await fetchAllRecords({
          baseId: base.baseId,
          token,
          tableName: invoiceTable.name,
          fields: [
            deliveryField,
            statusField,
            dispatchDateField,
            storeField,
            valueField,
            orderNoField,
            numberField,
            resendField,
            customerField,
            phoneField,
          ].filter(Boolean),
        });

        for (const record of records) {
          const recordFields = record.fields || {};
          const courier = String(
            firstValue(recordFields[deliveryField]) || "",
          ).trim();

          if (!courier || normalize(courier) === "bill created") continue;
          if (!isPendingCourierStatus(recordFields[statusField])) continue;
          if (!dateMatchesMonth(recordFields[dispatchDateField], month)) continue;

          const store = storeField
            ? String(firstValue(recordFields[storeField]) || "")
            : "";

          if (
            courierFilter &&
            !normalize(courier).includes(courierFilter)
          ) {
            continue;
          }

          if (
            storeFilter &&
            !normalize(store).includes(storeFilter)
          ) {
            continue;
          }

          const isBsOrderBase =
            baseName.includes("bs") &&
            !baseName.includes("fab") &&
            !baseName.includes("tat") &&
            !baseName.includes("dq") &&
            !baseName.includes("i5q");

          const orderNo = isBsOrderBase
            ? buildBsOrderNumber({
                store: storeField ? recordFields[storeField] : "",
                number: numberField ? recordFields[numberField] : "",
                resend: resendField ? recordFields[resendField] : "",
              }) ||
              (orderNoField
                ? String(firstValue(recordFields[orderNoField]) || "")
                : "")
            : orderNoField
              ? String(firstValue(recordFields[orderNoField]) || "")
              : "";

          rows.push({
            id: `${base.baseId}-${record.id}`,
            recordId: record.id,
            baseId: base.baseId,
            baseName: base.baseName,
            orderNo,
            store,
            customer: customerField
              ? String(firstValue(recordFields[customerField]) || "")
              : "",
            phone: phoneField
              ? String(firstValue(recordFields[phoneField]) || "")
              : "",
            courier,
            deliveryFieldLabel: useDriver ? "Driver" : "Courier",
            status: String(firstValue(recordFields[statusField]) || ""),
            value: valueField
              ? numberValue(recordFields[valueField])
              : 0,
            despatchDate: String(
              firstValue(recordFields[dispatchDateField]) || "",
            ),
            days: pendingDays(recordFields[dispatchDateField]),
          });
        }
      } catch (error) {
        warnings.push({
          baseName: base.baseName,
          message:
            error instanceof Error ? error.message : "Report failed",
        });
      }
    }

    rows.sort((a, b) => {
      if (b.days !== a.days) return b.days - a.days;
      return a.orderNo.localeCompare(b.orderNo, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    return NextResponse.json({
      success: true,
      rows,
      warnings,
      summary: {
        totalOrders: rows.length,
        totalValue: rows.reduce(
          (total, row) => total + Number(row.value || 0),
          0,
        ),
        olderThan7: rows.filter((row) => row.days > 7).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Courier pending report failed",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await getAllowedBases();
    if ("error" in access) return access.error;

    const body = await request.json();
    const status = String(body?.status || "").trim();
    const selections = Array.isArray(body?.selections)
      ? body.selections
      : [];

    if (status !== "Delivered" && status !== "Returned") {
      return NextResponse.json(
        {
          success: false,
          message: "Status must be Delivered or Returned",
        },
        { status: 400 },
      );
    }

    if (selections.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Select at least one order",
        },
        { status: 400 },
      );
    }

    const allowedBaseMap = new Map(
      (access.bases || []).map((base) => [base.baseId, base]),
    );

    const grouped = new Map<string, string[]>();

    for (const item of selections) {
      const baseId = String(item?.baseId || "");
      const recordId = String(item?.recordId || "");

      if (!allowedBaseMap.has(baseId) || !recordId) continue;

      if (!grouped.has(baseId)) grouped.set(baseId, []);
      grouped.get(baseId)!.push(recordId);
    }

    if (grouped.size === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No permitted orders selected",
        },
        { status: 403 },
      );
    }

    let updatedRecords = 0;

    for (const [baseId, recordIds] of grouped.entries()) {
      const base = allowedBaseMap.get(baseId)!;
      const token = resolveToken(base);
      if (!token) throw new Error(`Airtable token missing for ${base.baseName}`);

      const tables = await getSchema(baseId, token);
      const invoiceTable = findInvoiceTable(tables, base);

      if (!invoiceTable) {
        throw new Error(`Invoice table not found for ${base.baseName}`);
      }

      const statusField = getFieldName(
        invoiceTable.fields || [],
        ["order_status", "Order_status", "Order Status", "Status"],
      );

      if (!statusField) {
        throw new Error(
          `Order Status field missing in ${invoiceTable.name}`,
        );
      }

      updatedRecords += await updateRecords({
        baseId,
        token,
        tableName: invoiceTable.name,
        statusField,
        recordIds: Array.from(new Set(recordIds)),
        status: status as "Delivered" | "Returned",
      });
    }

    return NextResponse.json({
      success: true,
      updatedRecords,
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Courier bulk update failed",
      },
      { status: 500 },
    );
  }
}
