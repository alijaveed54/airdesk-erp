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
    receivedInWh1: string;
    orderStatus: string;
    orderDate?: string;
    createdDate?: string;
    image?: string;
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
      receivedInWh1: "received_in_wh_1",
      orderStatus: "Order Status",
      orderDate: "date",
      createdDate: "created Date",
      image: "image",
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
      receivedInWh1: "received_in_wh_1",
      orderStatus: "Order_status",
      orderDate: "date",
      createdDate: "created date",
      image: "image",
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

  return (
    status === "" ||
    status === "order received" ||
    status === "processing"
  );
}

function isNotReceived(value: unknown): boolean {
  const received = cleanText(value).toLowerCase();

  return (
    received !== "yes" &&
    received !== "true" &&
    received !== "1" &&
    received !== "received"
  );
}

function getHoursSinceCreated(createdDateStr: string): number {
  if (!createdDateStr) return Infinity;

  const created = new Date(createdDateStr);
  const now = new Date();

  if (Number.isNaN(created.getTime())) return Infinity;

  const diffMs = now.getTime() - created.getTime();
  return diffMs / (1000 * 60 * 60);
}

function extractImageUrl(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const first = value[0];

    if (!first) return "";

    if (typeof first === "string") {
      return first.trim();
    }

    if (typeof first === "object" && first !== null) {
      const item = first as Record<string, unknown>;

      return (
        cleanText(item.url) ||
        cleanText(item.thumbnails) ||
        cleanText(item.src) ||
        ""
      );
    }
  }

  if (typeof value === "object") {
    const item = value as Record<string, unknown>;

    return cleanText(item.url) || cleanText(item.src) || "";
  }

  return "";
}

async function fetchDelayedRows(token: string, source: Source) {
  const f = source.fields;

  const baseParams = new URLSearchParams();
  baseParams.set("pageSize", "100");
  baseParams.set("filterByFormula", `AND({${f.supplier}}!='')`);

  const requestedFields = Array.from(
    new Set(
      [
        f.orderNo,
        f.itemCode,
        f.quantity,
        f.supplier,
        f.billNo,
        f.receivedInUae,
        f.receivedInWh1,
        f.orderStatus,
        f.orderDate,
        f.createdDate,
        f.image,
      ].filter((field): field is string => Boolean(field)),
    ),
  );

  requestedFields.forEach((field) => baseParams.append("fields[]", field));

  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams(baseParams);

    if (offset) {
      params.set("offset", offset);
    }

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
          `Unable to load ${source.sourceName} records`,
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records
    .map((record) => {
      const fields = record.fields || {};
      const sku = cleanText(fields[f.itemCode]);

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
        sku,
        qty: Number(firstValue(fields[f.quantity]) || 0),
        receivedInUae: cleanText(fields[f.receivedInUae]),
        receivedInWh1: cleanText(fields[f.receivedInWh1]),
        orderStatus: cleanText(fields[f.orderStatus]),
        orderDate: f.orderDate ? cleanText(fields[f.orderDate]) : "",
        createdDate,
        hoursSinceCreated: getHoursSinceCreated(createdDate),
        image: f.image ? extractImageUrl(fields[f.image]) : "",
      };
    })
    .filter(
      (row) =>
        row.supplier &&
        row.orderNo &&
        isAllowedStatus(row.orderStatus) &&
        isNotReceived(row.receivedInWh1) &&
        row.hoursSinceCreated >= 72,
    );
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

    const sourceRows = await Promise.all(
      SOURCES.map((source) => fetchDelayedRows(airtable.token, source)),
    );

    const allRows = sourceRows.flat();

    const rows = allRows;

    rows.sort((a, b) => {
      const aTime = a.createdDate ? new Date(a.createdDate).getTime() : 0;
      const bTime = b.createdDate ? new Date(b.createdDate).getTime() : 0;

      return aTime - bTime;
    });

    const suppliers = Array.from(
      new Set(rows.map((row) => row.supplier).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    const filteredRows = selectedSupplier
      ? rows.filter(
          (row) =>
            row.supplier.toLowerCase() === selectedSupplier.toLowerCase(),
        )
      : rows;

    const totalPcs = filteredRows.reduce(
      (sum, row) => sum + Number(row.qty || 0),
      0,
    );

    const totalOrders = new Set(
      filteredRows.map((row) => row.orderNo).filter(Boolean),
    ).size;

    const totalBills = new Set(
      filteredRows.map((row) => row.billNo).filter(Boolean),
    ).size;

    const totalSuppliers = new Set(
      filteredRows.map((row) => row.supplier).filter(Boolean),
    ).size;

    return NextResponse.json({
      success: true,
      suppliers,
      rows: filteredRows,
      summary: {
        totalOrders,
        totalLines: filteredRows.length,
        totalPcs,
        totalBills,
        totalSuppliers,
      },
    });
  } catch (error) {
    return handleApiError(error, "Supplier delayed orders report failed");
  }
}
