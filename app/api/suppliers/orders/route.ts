import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";

const SUPPLIER_BASES = [
  {
    baseName: "BS Order Entry (UAE) (June-26)",
    baseId: "app2hjpuQoeEL1Rn2",
    tableName: "BS Order Entry",
  },
  {
    baseName: "FAB Order Entry (Non Stock Doha)",
    baseId: "appiz6tozkQO2TQXt",
    tableName: "FAB Order Entry",
  },
];

function escapeAirtableString(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function textValue(value: any) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "")).join(" ").trim();
  }
  return String(value ?? "").trim();
}

function firstValue(value: any) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function getCreatedDate(fields: Record<string, any>) {
  return String(
    firstValue(fields["created Date"]) ||
      firstValue(fields["created date"]) ||
      firstValue(fields["Created Date"]) ||
      firstValue(fields["Order Date"]) ||
      firstValue(fields.date) ||
      ""
  );
}

function getOrderNumber(fields: Record<string, any>) {
  return textValue(
    fields["Order Number"] ||
      fields["Order No."] ||
      fields["Order No"] ||
      fields["order no."] ||
      fields["order no"] ||
      fields["order_no"] ||
      fields.order_no ||
      ""
  );
}

function normalizeRecord(record: any, baseId: string, tableName: string) {
  const fields = record.fields || {};

  return {
    ...record,
    _baseId: baseId,
    _tableName: tableName,
    fields: {
      ...fields,
      "Order Number": [getOrderNumber(fields)],
      "created Date": getCreatedDate(fields),
      Order_status:
        fields.Order_status ||
        fields["Order Status"] ||
        fields.order_status ||
        "",
      Supplier:
        fields.Supplier ||
        fields["Purchase Supplier"] ||
        "",
      received_in_wh_1:
        fields.received_in_wh_1 ||
        fields["Received In WH 1"] ||
        "",
      "Item Code":
        fields["Item Code"] ||
        fields.SKU ||
        fields.sku ||
        "",
    },
  };
}

function isPendingRecord(record: any, supplierCode: string) {
  const fields = record.fields || {};

  const supplier = textValue(
    fields.Supplier ||
      fields["Purchase Supplier"] ||
      fields["Supplier Code"] ||
      ""
  ).toLowerCase();

  const requiredSupplier = supplierCode.toLowerCase();
  const showAllSuppliers = requiredSupplier === "all";

  const itemCode = textValue(fields["Item Code"]);
  const orderNumber = textValue(fields["Order Number"]);
  const received = textValue(fields.received_in_wh_1).toLowerCase();
  const status = textValue(fields.Order_status).toLowerCase();

  const supplierMatches =
    showAllSuppliers ||
    supplier === requiredSupplier ||
    supplier.includes(requiredSupplier);

  const statusMatches =
    status === "" ||
    status.includes("order received") ||
    status.includes("processing");

  return (
    supplierMatches &&
    supplier !== "" &&
    itemCode !== "" &&
    orderNumber !== "" &&
    received === "" &&
    statusMatches
  );
}

async function fetchSupplierRecords({
  baseId,
  tableName,
  token,
  supplierCode,
}: {
  baseId: string;
  tableName: string;
  token: string;
  supplierCode: string;
}) {
  const records: any[] = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    if (supplierCode.toLowerCase() === "all") {
      params.set(
        "filterByFormula",
        `AND(
          LEN(TRIM({Supplier} & '')) > 0,
          LEN(TRIM({Item Code} & '')) > 0
        )`
      );
    } else {
      params.set(
        "filterByFormula",
        `AND(
          FIND(
            LOWER('${escapeAirtableString(supplierCode)}'),
            LOWER({Supplier} & '')
          ) > 0,
          LEN(TRIM({Item Code} & '')) > 0
        )`
      );
    }

    if (offset) {
      params.set("offset", offset);
    }

    const response = await fetch(
      airtableUrl(baseId, tableName, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw {
        status: response.status,
        message: `Supplier orders failed for ${tableName}`,
        error: data,
      };
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    const currentAirtable = await getCurrentAirtableBase();
    const { searchParams } = new URL(request.url);

    const supplierFromQuery =
      searchParams.get("supplier")?.trim() || "";

    const supplierCode =
      session.role === "Supplier"
        ? String(
            session.permissions?.find(
              (permission) => permission.supplierCode
            )?.supplierCode || ""
          ).trim()
        : supplierFromQuery;

    if (!supplierCode) {
      return NextResponse.json(
        { success: false, message: "Supplier code is required" },
        { status: 400 }
      );
    }

    const globalToken =
      process.env.AIRTABLE_TOKEN ||
      process.env.AUTH_AIRTABLE_TOKEN ||
      "";

    const mergedRecords: any[] = [];

    for (const base of SUPPLIER_BASES) {
      const permissionForBase = session.permissions?.find(
        (permission: any) => permission.baseId === base.baseId
      );

      const baseToken =
        globalToken ||
        permissionForBase?.airtableToken ||
        currentAirtable.token ||
        "";

      if (!baseToken) {
        throw {
          status: 500,
          message: `Airtable token missing for ${base.baseName}`,
        };
      }

      const rawRecords = await fetchSupplierRecords({
        baseId: base.baseId,
        tableName: base.tableName,
        token: baseToken,
        supplierCode,
      });

      const normalized = rawRecords
        .map((record: any) =>
          normalizeRecord(record, base.baseId, base.tableName)
        )
        .filter((record: any) =>
          isPendingRecord(record, supplierCode)
        );

      mergedRecords.push(...normalized);
    }

    mergedRecords.sort((a, b) => {
      const aDate = getCreatedDate(a.fields || {});
      const bDate = getCreatedDate(b.fields || {});

      const aTime = aDate
        ? new Date(aDate).getTime()
        : Number.MAX_SAFE_INTEGER;

      const bTime = bDate
        ? new Date(bDate).getTime()
        : Number.MAX_SAFE_INTEGER;

      return aTime - bTime;
    });

    return NextResponse.json({
      success: true,
      records: mergedRecords,
      supplierLocked: session.role === "Supplier",
      supplier: supplierCode,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message:
          error?.message ||
          (error instanceof Error
            ? error.message
            : "Unknown error"),
        error: error?.error,
      },
      { status: error?.status || 500 }
    );
  }
}
