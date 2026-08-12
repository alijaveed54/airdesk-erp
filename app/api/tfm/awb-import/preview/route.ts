import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtablePaginatedFetch,
  airtableUrl,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import { getSession } from "@/lib/auth";
import {
  getTfmSupportedBase,
  isTfmSupportedBase,
} from "@/lib/tfm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SchemaField = {
  id: string;
  name: string;
  type: string;
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: SchemaField[];
};

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type ReportRow = {
  rowKey?: string;
  orderNo?: string;
  awb?: string;
  created?: string;
  status?: string;
  lastActionDate?: string;
  previousReportAwbs?: string[];
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function firstValue(value: unknown): string {
  if (Array.isArray(value)) {
    return firstValue(value[0]);
  }

  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return String(
      item.name ?? item.value ?? item.text ?? item.id ?? "",
    ).trim();
  }

  return String(value ?? "").trim();
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringList(item));
  }

  const text = firstValue(value);

  if (!text) return [];

  return text
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]) {
  const output = new Map<string, string>();

  for (const value of values) {
    const text = String(value || "").trim();
    const key = normalize(text);

    if (text && !output.has(key)) {
      output.set(key, text);
    }
  }

  return Array.from(output.values());
}

function findField(
  fields: SchemaField[],
  candidates: string[],
) {
  const names = new Set(candidates.map(normalize));
  return fields.find((field) => names.has(normalize(field.name)));
}

function escapeFormulaValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function textEqualsFormula(field: string, value: string) {
  return `LOWER(TRIM({${field}}&''))='${escapeFormulaValue(
    value.toLowerCase(),
  )}'`;
}

async function loadSchema(baseId: string, token: string) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(
      baseId,
    )}/tables`,
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Unable to load Airtable schema",
    );
  }

  return (data.tables || []) as SchemaTable[];
}

async function fetchOrderRecords({
  baseId,
  token,
  table,
  orderNoField,
  orderNumbers,
}: {
  baseId: string;
  token: string;
  table: string;
  orderNoField: string;
  orderNumbers: string[];
}) {
  const values = unique(orderNumbers);
  const records: AirtableRecord[] = [];

  for (let index = 0; index < values.length; index += 20) {
    const chunk = values.slice(index, index + 20);
    const formulas = chunk.map((orderNo) =>
      textEqualsFormula(orderNoField, orderNo),
    );
    const formula =
      formulas.length === 1
        ? formulas[0]
        : `OR(${formulas.join(",")})`;
    const params = new URLSearchParams({
      filterByFormula: formula,
      pageSize: "100",
    });

    const chunkRecords = (await airtablePaginatedFetch({
      baseId,
      token,
      table,
      params,
    })) as AirtableRecord[];

    records.push(...chunkRecords);
  }

  return records;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (session.role === "Supplier") {
      return NextResponse.json(
        { success: false, message: "Supplier access is not allowed" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const reportRows = (Array.isArray(body?.rows)
      ? body.rows
      : []) as ReportRow[];

    if (!reportRows.length) {
      return NextResponse.json(
        { success: false, message: "No AWB report rows supplied" },
        { status: 400 },
      );
    }

    if (reportRows.length > 2000) {
      return NextResponse.json(
        {
          success: false,
          message: "Maximum 2,000 unique order rows are allowed per preview",
        },
        { status: 400 },
      );
    }

    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view invoice records",
        },
        { status: 403 },
      );
    }

    if (!isTfmSupportedBase(airtable.baseId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "TFM AWB import is available only for BS Order Entry and Tatlumput Siyam Order Entry",
        },
        { status: 400 },
      );
    }

    const supportedBase = getTfmSupportedBase(airtable.baseId);
    const schema = await loadSchema(
      airtable.baseId,
      airtable.token,
    );
    const invoiceTable =
      schema.find(
        (table) => table.name === airtable.tables.invoice,
      ) ||
      schema.find(
        (table) => table.name === supportedBase?.invoiceTable,
      );

    if (!invoiceTable) {
      throw new Error(
        `Invoice table not found: ${
          airtable.tables.invoice || supportedBase?.invoiceTable
        }`,
      );
    }

    const fields = invoiceTable.fields || [];
    const orderNoField =
      findField(fields, [
        "Order No.",
        "Order No",
        "order_no.",
        "order no.",
        "Order Number",
        "Invoice No.",
        "Invoice No",
      ]) ||
      fields.find(
        (field) => field.id === invoiceTable.primaryFieldId,
      );

    const fieldMap = {
      awb: findField(fields, [
        "TFM AWB Number",
        "TFM AWB",
        "AWB Number",
        "AWB",
        "Tracking Number",
        "tracking_code",
      ]),
      previousAwbs: findField(fields, [
        "TFM Previous AWBs",
        "Previous AWBs",
        "TFM AWB History",
        "AWB History",
      ]),
      status: findField(fields, [
        "TFM Status",
        "Courier Status",
        "Tracking Status",
      ]),
      bookingDate: findField(fields, [
        "TFM Booking Date",
        "TFM Created",
        "Courier Booking Date",
        "AWB Created",
      ]),
      lastActionDate: findField(fields, [
        "TFM Last Action Date",
        "Courier Last Action Date",
        "TFM Status Date",
      ]),
      lastSync: findField(fields, [
        "TFM Last Sync",
        "Courier Last Sync",
        "Tracking Last Sync",
      ]),
    };

    if (!orderNoField) {
      throw new Error("Order Number field was not found");
    }

    const awbField = fieldMap.awb;

    if (!awbField) {
      return NextResponse.json(
        {
          success: false,
          message:
            "No editable TFM AWB field was found. Add a field named TFM AWB Number to the invoice table.",
          base: {
            baseId: airtable.baseId,
            baseName: airtable.baseName,
            invoiceTable: invoiceTable.name,
          },
        },
        { status: 400 },
      );
    }

    const sanitizedRows = reportRows
      .map((row, index) => ({
        rowKey: String(row.rowKey || `${index + 1}`),
        orderNo: String(row.orderNo || "").trim(),
        awb: String(row.awb || "").trim(),
        created: String(row.created || "").trim(),
        status: String(row.status || "").trim(),
        lastActionDate: String(row.lastActionDate || "").trim(),
        previousReportAwbs: unique(
          Array.isArray(row.previousReportAwbs)
            ? row.previousReportAwbs.map(String)
            : [],
        ),
      }))
      .filter((row) => row.orderNo || row.awb);

    const records = await fetchOrderRecords({
      baseId: airtable.baseId,
      token: airtable.token,
      table: invoiceTable.name,
      orderNoField: orderNoField.name,
      orderNumbers: sanitizedRows
        .map((row) => row.orderNo)
        .filter(Boolean),
    });

    const recordsByOrder = new Map<string, AirtableRecord[]>();

    for (const record of records) {
      const orderNo = firstValue(
        record.fields?.[orderNoField.name],
      );
      const key = normalize(orderNo);
      const current = recordsByOrder.get(key) || [];
      current.push(record);
      recordsByOrder.set(key, current);
    }

    const rows = sanitizedRows.map((row) => {
      const warnings: string[] = [];
      const errors: string[] = [];

      if (!row.orderNo) {
        errors.push("SHIPPER REF # / Order Number is missing");
      }

      if (!row.awb) {
        errors.push("AWB is missing");
      } else if (!/^\d{6,20}$/.test(row.awb)) {
        warnings.push("AWB format is unusual; review before updating");
      }

      const matches = recordsByOrder.get(normalize(row.orderNo)) || [];
      const record = matches.length === 1 ? matches[0] : undefined;

      if (matches.length === 0 && row.orderNo) {
        errors.push(
          "Order Number was not found in the currently selected base",
        );
      }

      if (matches.length > 1) {
        errors.push(
          `Multiple Airtable records (${matches.length}) have this Order Number`,
        );
      }

      const currentAwb = record
        ? firstValue(record.fields?.[awbField.name])
        : "";
      const existingPreviousAwbs = record && fieldMap.previousAwbs
        ? stringList(
            record.fields?.[fieldMap.previousAwbs.name],
          )
        : [];
      const currentStatus = record && fieldMap.status
        ? firstValue(record.fields?.[fieldMap.status.name])
        : "";

      if (row.previousReportAwbs.length) {
        warnings.push(
          `TFM report contains ${
            row.previousReportAwbs.length + 1
          } AWBs for this Order Number`,
        );
      }

      let action: "update" | "replace" | "same" | "invalid" =
        "update";

      if (errors.length) {
        action = "invalid";
      } else if (normalize(currentAwb) === normalize(row.awb)) {
        action = "same";
      } else if (currentAwb) {
        action = "replace";
        warnings.push(
          `Current Airtable AWB ${currentAwb} will move to history and ${row.awb} will become current`,
        );
      }

      const previousAwbs = unique([
        ...existingPreviousAwbs,
        ...(currentAwb && normalize(currentAwb) !== normalize(row.awb)
          ? [currentAwb]
          : []),
        ...row.previousReportAwbs,
      ]).filter(
        (awb) => normalize(awb) !== normalize(row.awb),
      );

      if (
        previousAwbs.length &&
        !fieldMap.previousAwbs
      ) {
        warnings.push(
          "TFM Previous AWBs field is not present; previous values remain recoverable through ERP audit history",
        );
      }

      return {
        ...row,
        recordId: record?.id || "",
        currentAwb,
        previousAwbs,
        currentStatus,
        action,
        selectable: errors.length === 0,
        warnings,
        errors,
      };
    });

    return NextResponse.json({
      success: true,
      base: {
        baseId: airtable.baseId,
        baseName: airtable.baseName,
        invoiceTable: invoiceTable.name,
      },
      fields: {
        orderNo: orderNoField.name,
        awb: awbField.name,
        previousAwbs: fieldMap.previousAwbs?.name || "",
        status: fieldMap.status?.name || "",
        bookingDate: fieldMap.bookingDate?.name || "",
        lastActionDate: fieldMap.lastActionDate?.name || "",
        lastSync: fieldMap.lastSync?.name || "",
      },
      summary: {
        total: rows.length,
        matched: rows.filter((row) => row.selectable).length,
        notFound: rows.filter((row) =>
          row.errors.some((error) => error.includes("not found")),
        ).length,
        multipleMatches: rows.filter((row) =>
          row.errors.some((error) => error.includes("Multiple Airtable")),
        ).length,
        same: rows.filter((row) => row.action === "same").length,
        update: rows.filter((row) => row.action === "update").length,
        replace: rows.filter((row) => row.action === "replace").length,
      },
      rows,
    });
  } catch (error) {
    return handleApiError(error, "TFM AWB preview could not load");
  }
}

