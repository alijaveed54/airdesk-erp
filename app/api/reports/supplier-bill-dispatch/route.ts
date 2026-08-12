import { NextResponse } from "next/server";
import { auditedFetch } from "@/lib/audit-airtable-fetch";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";

type Source = {
  baseId: string;
  tableName: string;
  sourceName: string;
  fields: {
    orderNo: string;
    itemCode: string;
    quantity: string;
    supplier: string;
    billNo: string;
    receivedInUae: string;
    receivedInUaeDateTime?: string;
    orderStatus?: string;
    activity?: string;
    activityDateTime?: string;
    orderDate?: string;
    dispatched?: string;
    dispatchDate?: string;
    createdDate?: string;
  };
};

type MatchingRecord = {
  id: string;
  receivedInUae: string;
  receivedInUaeDateTime: string;
};

type ReceiveAction = "receive" | "undo" | "arq";

type SelectedRecord = {
  source: string;
  recordId: string;
};

const SOURCES: Source[] = [
  {
    baseId: "app2hjpuQoeEL1Rn2",
    tableName: "BS Order Entry",
    sourceName: "BS",
    fields: {
      orderNo: "Order Number",
      itemCode: "Item Code",
      quantity: "quantity",
      supplier: "Supplier",
      billNo: "bill_no",
      receivedInUae: "Received In UAE",
      receivedInUaeDateTime: "Received In UAE DateTime",
      orderStatus: "Order Status",
      activity: "Supplier Activity",
      activityDateTime: "Activity DateTime",
      orderDate: "date",
      dispatched: "Dispatched",
      createdDate: "created Date",
    },
  },
  {
    baseId: "appiz6tozkQO2TQXt",
    tableName: "FAB Order Entry",
    sourceName: "FAB Non-Stock",
    fields: {
      orderNo: "Order Number",
      itemCode: "Item Code",
      quantity: "quantity",
      supplier: "Supplier",
      billNo: "bill_no",
      receivedInUae: "Received In UAE",
      receivedInUaeDateTime: "Received In UAE DateTime",
      orderStatus: "Order_status",
      activity: "Supplier Activity",
      activityDateTime: "Activity DateTime",
      orderDate: "date",
      dispatched: "supplier_status_(dispatched)",
      dispatchDate: "dispatch_date_from_WH1",
      createdDate: "created date",
    },
  },
];

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function cleanText(value: unknown): string {
  return String(firstValue(value) ?? "").trim();
}

function isTruthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;

  const text = cleanText(value).toLowerCase();
  return ["1", "true", "yes", "checked", "dispatched"].includes(text);
}

function isReceived(value: unknown): boolean {
  return cleanText(value).toLowerCase() === "yes";
}

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isBlockedLabel(value: unknown): boolean {
  const label = cleanText(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  return label === "stock out" || label === "sold out";
}

function parseDdMmYyyyBillDate(value: string): number | null {
  const match = String(value || "")
    .trim()
    .match(/^(\d{2})(\d{2})(\d{4})$/);

  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

function compareBillNumbersNewestFirst(
  first: { billNo: string },
  second: { billNo: string },
) {
  const firstDate = parseDdMmYyyyBillDate(first.billNo);
  const secondDate = parseDdMmYyyyBillDate(second.billNo);

  if (firstDate !== null && secondDate !== null) {
    if (firstDate !== secondDate) return secondDate - firstDate;
  } else if (firstDate !== null) {
    return -1;
  } else if (secondDate !== null) {
    return 1;
  }

  return second.billNo.localeCompare(first.billNo, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

async function fetchBillRows(token: string, source: Source) {
  const f = source.fields;
  const baseParams = new URLSearchParams();

  baseParams.set("pageSize", "100");
  baseParams.set(
    "filterByFormula",
    `AND({${f.supplier}}!='',{${f.billNo}}!='')`,
  );

  const requestedFields = Array.from(
    new Set(
      [
        f.orderNo,
        f.itemCode,
        f.quantity,
        f.supplier,
        f.billNo,
        f.receivedInUae,
        f.receivedInUaeDateTime,
        f.orderStatus,
        f.activity,
        f.activityDateTime,
        f.orderDate,
        f.dispatched,
        f.dispatchDate,
        f.createdDate,
      ].filter((field): field is string => Boolean(field)),
    ),
  );

  requestedFields.forEach((field) => baseParams.append("fields[]", field));

  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams(baseParams);
    if (offset) params.set("offset", offset);

    const response = await fetch(
      airtableUrl(source.baseId, source.tableName, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      },
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          `Unable to load ${source.sourceName} supplier bills`,
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records.map((record) => {
    const fields = record.fields || {};
    const activity = f.activity ? cleanText(fields[f.activity]) : "";
    const dispatchedValue = f.dispatched ? fields[f.dispatched] : "";
    const dispatchDate = f.dispatchDate
      ? cleanText(fields[f.dispatchDate])
      : "";
    const activityDateTime = f.activityDateTime
      ? cleanText(fields[f.activityDateTime])
      : "";
    const createdDate = f.createdDate
      ? cleanText(fields[f.createdDate])
      : "";

    return {
      id: `${source.baseId}-${record.id}`,
      recordId: record.id,
      source: source.sourceName,
      supplier: cleanText(fields[f.supplier]),
      billNo: cleanText(fields[f.billNo]),
      orderNo: cleanText(fields[f.orderNo]),
      sku: cleanText(fields[f.itemCode]),
      qty: Number(firstValue(fields[f.quantity]) || 0),
      receivedInUae: cleanText(fields[f.receivedInUae]),
      receivedInUaeDateTime: f.receivedInUaeDateTime
        ? cleanText(fields[f.receivedInUaeDateTime])
        : "",
      orderStatus: f.orderStatus ? cleanText(fields[f.orderStatus]) : "",
      dispatchDateTime: activityDateTime || dispatchDate || createdDate,
      orderDate: f.orderDate ? cleanText(fields[f.orderDate]) : "",
      status:
        activity ||
        (isTruthy(dispatchedValue) || dispatchDate
          ? "Dispatched"
          : "Bill Added"),
    };
  });
}

async function findMatchingRecords(
  token: string,
  source: Source,
  supplier: string,
  billNo: string,
): Promise<MatchingRecord[]> {
  const f = source.fields;
  const formula =
    `AND(` +
    `LOWER({${f.supplier}}&'')=LOWER('${escapeAirtableString(supplier)}'),` +
    `LOWER({${f.billNo}}&'')=LOWER('${escapeAirtableString(billNo)}')` +
    `)`;
  const records: MatchingRecord[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set("filterByFormula", formula);
    params.append("fields[]", f.receivedInUae);

    if (f.receivedInUaeDateTime) {
      params.append("fields[]", f.receivedInUaeDateTime);
    }

    if (offset) params.set("offset", offset);

    const response = await fetch(
      airtableUrl(source.baseId, source.tableName, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      },
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to find bill records in ${source.sourceName}`,
      );
    }

    for (const record of data.records || []) {
      const fields = record.fields || {};

      records.push({
        id: record.id,
        receivedInUae: cleanText(fields[f.receivedInUae]),
        receivedInUaeDateTime: f.receivedInUaeDateTime
          ? cleanText(fields[f.receivedInUaeDateTime])
          : "",
      });
    }

    offset = data.offset || "";
  } while (offset);

  return records;
}

function recordsForAction(
  records: MatchingRecord[],
  action: ReceiveAction,
): MatchingRecord[] {

  if (action === "receive") {
    return records.filter(
      (record) => !isReceived(record.receivedInUae),
    );
  }

  if (action === "arq") {
    return records;
  }

  return records.filter(
    (record) =>
      isReceived(record.receivedInUae) ||
      Boolean(record.receivedInUaeDateTime),
  );
}

async function updateReceivedInUae(
  token: string,
  source: Source,
  records: MatchingRecord[],
  action: ReceiveAction,
  receivedAt: string,
) {
  let updated = 0;

  for (let index = 0; index < records.length; index += 10) {
    const batch = records.slice(index, index + 10);
    const fields: Record<string, string | null> = {
      [source.fields.receivedInUae]: action === "receive" ? "Yes" : null,
    };

    if (source.fields.receivedInUaeDateTime) {
      fields[source.fields.receivedInUaeDateTime] =
        action === "receive" ? receivedAt : null;
    }

    const response = await auditedFetch(
      airtableUrl(source.baseId, source.tableName),
      {
        method: "PATCH",
        headers: {
          ...airtableHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          records: batch.map((record) => ({
            id: record.id,
            fields,
          })),
          typecast: true,
        }),
      },
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to update ${source.sourceName} records`,
      );
    }

    updated += (data.records || []).length;
  }

  return updated;
}
async function updateReceivedQueue(
  token: string,
  source: Source,
  records: MatchingRecord[],
) {
  let updated = 0;

  for (let index = 0; index < records.length; index += 10) {

    const batch = records.slice(index, index + 10);

    const response = await auditedFetch(
      airtableUrl(
        source.baseId,
        source.tableName
      ),
      {
        method: "PATCH",
        headers: {
          ...airtableHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          records: batch.map((record) => ({
            id: record.id,
            fields: {
              "Received Que": "Yes",
            },
          })),
          typecast: true,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        "Unable to update Received Que"
      );
    }

    updated += (data.records || []).length;
  }

  return updated;
}

export async function GET(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReports) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view reports",
        },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const selectedSupplier = searchParams.get("supplier")?.trim() || "";
    const selectedBillNo = searchParams.get("billNo")?.trim() || "";

    const sourceRows = await Promise.all(
      SOURCES.map((source) => fetchBillRows(airtable.token, source)),
    );
    const allRows = sourceRows
      .flat()
      .filter(
        (row) =>
          row.supplier &&
          row.billNo &&
          !isBlockedLabel(row.supplier) &&
          !isBlockedLabel(row.billNo),
      );
    const suppliers = Array.from(
      new Set(allRows.map((row) => row.supplier)),
    ).sort((a, b) => a.localeCompare(b));
    const supplierRows = selectedSupplier
      ? allRows.filter(
          (row) =>
            row.supplier.toLowerCase() === selectedSupplier.toLowerCase(),
        )
      : [];

    const billMap = new Map<
      string,
      { billNo: string; pcs: number; lines: number }
    >();

    for (const row of supplierRows) {
      const key = row.billNo.toLowerCase();
      const current = billMap.get(key) || {
        billNo: row.billNo,
        pcs: 0,
        lines: 0,
      };

      current.pcs += Number(row.qty || 0);
      current.lines += 1;
      billMap.set(key, current);
    }

    const bills = Array.from(billMap.values()).sort(
      compareBillNumbersNewestFirst,
    );

    const rows = selectedBillNo
      ? supplierRows
          .filter(
            (row) =>
              row.billNo.toLowerCase() === selectedBillNo.toLowerCase(),
          )
          .sort((a, b) => {
            const first = a.dispatchDateTime
              ? new Date(a.dispatchDateTime).getTime()
              : 0;
            const second = b.dispatchDateTime
              ? new Date(b.dispatchDateTime).getTime()
              : 0;

            return second - first;
          })
      : [];

    const totalPcs = rows.reduce(
      (sum, row) => sum + Number(row.qty || 0),
      0,
    );
    const totalOrders = new Set(
      rows.map((row) => row.orderNo).filter(Boolean),
    ).size;
    const receivedLines = rows.filter((row) =>
      isReceived(row.receivedInUae),
    ).length;

    return NextResponse.json({
      success: true,
      suppliers,
      bills,
      rows,
      summary: {
        totalOrders,
        totalLines: rows.length,
        totalPcs,
        receivedLines,
      },
    });
  } catch (error) {
    return handleApiError(error, "Supplier bill dispatch report failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReports) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to update this report",
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const supplier = String(body?.supplier || "").trim();
    const billNo = String(body?.billNo || "").trim();
    const action: ReceiveAction =
  body?.action === "undo"
    ? "undo"
    : body?.action === "arq"
      ? "arq"
      : "receive";
    const rawSelections = Array.isArray(body?.selections)
      ? body.selections
      : [];

    const selectionMap = new Map<string, SelectedRecord>();

    for (const rawSelection of rawSelections as unknown[]) {
      const value =
        rawSelection && typeof rawSelection === "object"
          ? (rawSelection as Record<string, unknown>)
          : {};

      const selection: SelectedRecord = {
        source: String(value.source || "").trim(),
        recordId: String(value.recordId || "").trim(),
      };

      if (!selection.source || !selection.recordId) {
        continue;
      }

      selectionMap.set(
        `${selection.source}:${selection.recordId}`,
        selection,
      );
    }

    const selections: SelectedRecord[] = Array.from(
      selectionMap.values(),
    );

    if (!supplier || !billNo) {
      return NextResponse.json(
        {
          success: false,
          message: "Supplier and bill number are required",
        },
        { status: 400 },
      );
    }

    if (selections.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Select at least one item line first",
        },
        { status: 400 },
      );
    }

    if (selections.length > 500) {
      return NextResponse.json(
        {
          success: false,
          message: "Maximum 500 item lines can be updated at one time",
        },
        { status: 400 },
      );
    }

    const receivedAt = new Date().toISOString();
    let selectedRecords = selections.length;
    let matchedRecords = 0;
    let eligibleRecords = 0;
    let updatedRecords = 0;

    for (const source of SOURCES) {
      const selectedIds = new Set(
        selections
          .filter(
            (selection) =>
              selection.source.toLowerCase() ===
              source.sourceName.toLowerCase(),
          )
          .map((selection) => selection.recordId),
      );

      if (selectedIds.size === 0) continue;

      const matchingRecords = await findMatchingRecords(
        airtable.token,
        source,
        supplier,
        billNo,
      );

      // Server-side validation: only selected records that actually belong
      // to the selected supplier and bill are eligible for an update.
      const selectedMatchingRecords = matchingRecords.filter((record) =>
        selectedIds.has(record.id),
      );
      const targetRecords = recordsForAction(
        selectedMatchingRecords,
        action,
      );

      matchedRecords += selectedMatchingRecords.length;
      eligibleRecords += targetRecords.length;

      if (targetRecords.length > 0) {

  if (action === "arq") {

    updatedRecords += await updateReceivedQueue(
      airtable.token,
      source,
      targetRecords,
    );

  } else {

    updatedRecords += await updateReceivedInUae(
      airtable.token,
      source,
      targetRecords,
      action,
      receivedAt,
    );

  }

}
    }

    if (matchedRecords === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "None of the selected item lines belong to this supplier and bill",
        },
        { status: 404 },
      );
    }

    if (eligibleRecords === 0) {
      return NextResponse.json({
        success: true,
        action,
        selectedRecords,
        matchedRecords,
        eligibleRecords,
        updatedRecords: 0,
        message:
          action === "receive"
            ? "The selected item lines are already received"
            : "The selected item lines are not currently received",
      });
    }

    return NextResponse.json({
      success: true,
      action,
      selectedRecords,
      matchedRecords,
      eligibleRecords,
      updatedRecords,
      receivedInUae: action === "receive" ? "Yes" : "",
      receivedInUaeDateTime:
        action === "receive" ? receivedAt : "",
      message:
  action === "receive"
    ? `${updatedRecords} selected item line(s) marked as received`
    : action === "arq"
      ? `${updatedRecords} selected item line(s) added to Received Queue`
      : `${updatedRecords} selected item line(s) receipt removed`,
    });
  } catch (error) {
    return handleApiError(
      error,
      "Unable to update selected supplier bill item lines",
    );
  }
}
