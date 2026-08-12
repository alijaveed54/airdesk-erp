import { NextResponse } from "next/server";
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
    orderStatus: string;
    orderDate?: string;
    createdDate?: string;
  };
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
      orderStatus: "Order Status",
      orderDate: "date",
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
      orderStatus: "Order_status",
      orderDate: "date",
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

function normalizeStatus(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function isAllowedStatus(value: unknown): boolean {
  const status = normalizeStatus(value);
  return status === "" || status === "order received" || status === "processing";
}

function isNotReceived(value: unknown): boolean {
  const received = cleanText(value).toLowerCase();
  return received !== "yes" && received !== "true" && received !== "1" && received !== "received";
}

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function fetchPendingRows(token: string, source: Source) {
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
        f.orderStatus,
        f.orderDate,
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

    const response = await fetch(airtableUrl(source.baseId, source.tableName, params), {
      headers: airtableHeaders(token),
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          `Unable to load ${source.sourceName} pending receive records`,
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records
    .map((record) => {
      const fields = record.fields || {};
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
        orderStatus: cleanText(fields[f.orderStatus]),
        orderDate: f.orderDate ? cleanText(fields[f.orderDate]) : "",
        createdDate: f.createdDate ? cleanText(fields[f.createdDate]) : "",
      };
    })
    .filter(
      (row) =>
        row.supplier &&
        row.billNo &&
        isAllowedStatus(row.orderStatus) &&
        isNotReceived(row.receivedInUae),
    );
}

async function findMatchingPendingRecordIds(
  token: string,
  source: Source,
  supplier: string,
  billNo: string,
) {
  const f = source.fields;
  const formula = `AND(LOWER({${f.supplier}}&'')=LOWER('${escapeAirtableString(
    supplier,
  )}'),LOWER({${f.billNo}}&'')=LOWER('${escapeAirtableString(billNo)}'))`;

  const recordIds: string[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set("filterByFormula", formula);
    params.append("fields[]", f.receivedInUae);
    params.append("fields[]", f.orderStatus);
    if (offset) params.set("offset", offset);

    const response = await fetch(airtableUrl(source.baseId, source.tableName, params), {
      headers: airtableHeaders(token),
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Unable to find pending receive records in ${source.sourceName}`,
      );
    }

    for (const record of data.records || []) {
      const fields = record.fields || {};
      if (
        isAllowedStatus(fields[f.orderStatus]) &&
        isNotReceived(fields[f.receivedInUae])
      ) {
        recordIds.push(record.id);
      }
    }

    offset = data.offset || "";
  } while (offset);

  return recordIds;
}

async function updateReceivedInUae(
  token: string,
  source: Source,
  recordIds: string[],
) {
  let updated = 0;

  for (let index = 0; index < recordIds.length; index += 10) {
    const batch = recordIds.slice(index, index + 10);
    const response = await fetch(airtableUrl(source.baseId, source.tableName), {
      method: "PATCH",
      headers: {
        ...airtableHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        records: batch.map((id) => ({
          id,
          fields: { [source.fields.receivedInUae]: "Yes" },
        })),
        typecast: true,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Unable to update ${source.sourceName} records`,
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
        { success: false, message: "You do not have permission to view reports" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const selectedSupplier = searchParams.get("supplier")?.trim() || "";
    const selectedBillNo = searchParams.get("billNo")?.trim() || "";

    const sourceRows = await Promise.all(
      SOURCES.map((source) => fetchPendingRows(airtable.token, source)),
    );
    const allRows = sourceRows.flat();

    const suppliers = Array.from(new Set(allRows.map((row) => row.supplier))).sort(
      (a, b) => a.localeCompare(b),
    );

    const supplierRows = selectedSupplier
      ? allRows.filter(
          (row) => row.supplier.toLowerCase() === selectedSupplier.toLowerCase(),
        )
      : [];

    const billMap = new Map<string, { billNo: string; pcs: number; lines: number }>();
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

    const bills = Array.from(billMap.values()).sort((a, b) =>
      b.billNo.localeCompare(a.billNo, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    const rows = selectedBillNo
      ? supplierRows
          .filter(
            (row) => row.billNo.toLowerCase() === selectedBillNo.toLowerCase(),
          )
          .sort((a, b) => {
            const first = a.createdDate ? new Date(a.createdDate).getTime() : 0;
            const second = b.createdDate ? new Date(b.createdDate).getTime() : 0;
            return second - first;
          })
      : [];

    const totalPcs = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const totalOrders = new Set(rows.map((row) => row.orderNo).filter(Boolean)).size;

    return NextResponse.json({
      success: true,
      suppliers,
      bills,
      rows,
      summary: {
        totalOrders,
        totalLines: rows.length,
        totalPcs,
      },
    });
  } catch (error) {
    return handleApiError(error, "Supplier pending receive report failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();
    if (!airtable.canReports) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to update this report" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const supplier = String(body?.supplier || "").trim();
    const billNo = String(body?.billNo || "").trim();

    if (!supplier || !billNo) {
      return NextResponse.json(
        { success: false, message: "Supplier and bill number are required" },
        { status: 400 },
      );
    }

    let updatedRecords = 0;
    for (const source of SOURCES) {
      const recordIds = await findMatchingPendingRecordIds(
        airtable.token,
        source,
        supplier,
        billNo,
      );
      if (recordIds.length > 0) {
        updatedRecords += await updateReceivedInUae(
          airtable.token,
          source,
          recordIds,
        );
      }
    }

    if (updatedRecords === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No eligible pending item lines found for this supplier and bill",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      updatedRecords,
      receivedInUae: "Yes",
    });
  } catch (error) {
    return handleApiError(error, "Unable to mark pending supplier bill as received");
  }
}
