import { NextRequest, NextResponse } from "next/server";
import { auditedFetch as fetch } from "@/lib/audit-airtable-fetch";
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

type ApplyRow = {
  recordId?: string;
  orderNo?: string;
  awb?: string;
  status?: string;
  created?: string;
  lastActionDate?: string;
  previousAwbs?: string[];
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return firstValue(value[0]);

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
    if (text && !output.has(key)) output.set(key, text);
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

async function loadSchema(baseId: string, token: string) {
  const response = await globalThis.fetch(
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

async function fetchRecordsByIds({
  baseId,
  token,
  table,
  recordIds,
}: {
  baseId: string;
  token: string;
  table: string;
  recordIds: string[];
}) {
  const ids = unique(recordIds);
  const records: AirtableRecord[] = [];

  for (let index = 0; index < ids.length; index += 40) {
    const chunk = ids.slice(index, index + 40);
    const formula =
      chunk.length === 1
        ? `RECORD_ID()='${escapeFormulaValue(chunk[0])}'`
        : `OR(${chunk
            .map(
              (recordId) =>
                `RECORD_ID()='${escapeFormulaValue(recordId)}'`,
            )
            .join(",")})`;
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

  return new Map(records.map((record) => [record.id, record]));
}

function dateValue(value: string, field?: SchemaField) {
  if (!field || !value.trim()) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  if (field.type === "date") {
    return parsed.toISOString().slice(0, 10);
  }

  return parsed.toISOString();
}

function fieldValue(field: SchemaField, value: string) {
  if (field.type === "number" || field.type === "currency") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }

  return value;
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

    const airtable = await getCurrentAirtableBase();
    const permissions = airtable as typeof airtable & {
      canEdit?: boolean;
      canDispatch?: boolean;
    };

    if (!permissions.canEdit && !permissions.canDispatch) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to update TFM AWBs",
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

    const body = await request.json();
    const inputRows = (Array.isArray(body?.rows)
      ? body.rows
      : []) as ApplyRow[];

    if (!inputRows.length) {
      return NextResponse.json(
        { success: false, message: "No selected AWBs supplied" },
        { status: 400 },
      );
    }

    if (inputRows.length > 500) {
      return NextResponse.json(
        {
          success: false,
          message: "Maximum 500 AWB updates are allowed per import",
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
      throw new Error("Invoice table was not found");
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

    if (!orderNoField || !fieldMap.awb) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Order Number or TFM AWB Number field is missing from the invoice table",
        },
        { status: 400 },
      );
    }

    const rows = inputRows
      .map((row) => ({
        recordId: String(row.recordId || "").trim(),
        orderNo: String(row.orderNo || "").trim(),
        awb: String(row.awb || "").trim(),
        status: String(row.status || "").trim(),
        created: String(row.created || "").trim(),
        lastActionDate: String(row.lastActionDate || "").trim(),
        previousAwbs: unique(
          Array.isArray(row.previousAwbs)
            ? row.previousAwbs.map(String)
            : [],
        ),
      }))
      .filter((row) => row.recordId && row.orderNo && row.awb);

    const currentRecords = await fetchRecordsByIds({
      baseId: airtable.baseId,
      token: airtable.token,
      table: invoiceTable.name,
      recordIds: rows.map((row) => row.recordId),
    });

    const prepared: Array<{
      id: string;
      fields: Record<string, unknown>;
      orderNo: string;
      awb: string;
    }> = [];
    const skipped: Array<{
      orderNo: string;
      awb: string;
      message: string;
    }> = [];

    for (const row of rows) {
      const currentRecord = currentRecords.get(row.recordId);

      if (!currentRecord) {
        skipped.push({
          orderNo: row.orderNo,
          awb: row.awb,
          message: "Airtable record no longer exists",
        });
        continue;
      }

      const actualOrderNo = firstValue(
        currentRecord.fields?.[orderNoField.name],
      );

      if (normalize(actualOrderNo) !== normalize(row.orderNo)) {
        skipped.push({
          orderNo: row.orderNo,
          awb: row.awb,
          message: "Order Number changed after preview",
        });
        continue;
      }

      const currentAwb = firstValue(
        currentRecord.fields?.[fieldMap.awb.name],
      );
      const existingPrevious = fieldMap.previousAwbs
        ? stringList(
            currentRecord.fields?.[fieldMap.previousAwbs.name],
          )
        : [];
      const previousAwbs = unique([
        ...existingPrevious,
        ...(currentAwb && normalize(currentAwb) !== normalize(row.awb)
          ? [currentAwb]
          : []),
        ...row.previousAwbs,
      ]).filter(
        (awb) => normalize(awb) !== normalize(row.awb),
      );

      const updateFields: Record<string, unknown> = {
        [fieldMap.awb.name]: fieldValue(fieldMap.awb, row.awb),
      };

      if (fieldMap.previousAwbs && previousAwbs.length) {
        updateFields[fieldMap.previousAwbs.name] =
          previousAwbs.join(", ");
      }

      if (fieldMap.status && row.status) {
        updateFields[fieldMap.status.name] = row.status;
      }

      const bookingDate = dateValue(
        row.created,
        fieldMap.bookingDate,
      );
      if (fieldMap.bookingDate && bookingDate) {
        updateFields[fieldMap.bookingDate.name] = bookingDate;
      }

      const actionDate = dateValue(
        row.lastActionDate,
        fieldMap.lastActionDate,
      );
      if (fieldMap.lastActionDate && actionDate) {
        updateFields[fieldMap.lastActionDate.name] = actionDate;
      }

      if (fieldMap.lastSync) {
        const syncValue = dateValue(
          new Date().toISOString(),
          fieldMap.lastSync,
        );

        if (syncValue) {
          updateFields[fieldMap.lastSync.name] = syncValue;
        }
      }

      prepared.push({
        id: row.recordId,
        fields: updateFields,
        orderNo: row.orderNo,
        awb: row.awb,
      });
    }

    const updated: Array<{
      orderNo: string;
      awb: string;
      recordId: string;
    }> = [];
    const failed = [...skipped];

    for (let index = 0; index < prepared.length; index += 10) {
      const chunk = prepared.slice(index, index + 10);
      const params = new URLSearchParams({ typecast: "true" });
      const response = await fetch(
        airtableUrl(
          airtable.baseId,
          invoiceTable.name,
          params,
        ),
        {
          method: "PATCH",
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
          body: JSON.stringify({
            records: chunk.map((item) => ({
              id: item.id,
              fields: item.fields,
            })),
          }),
        },
      );

      const responseText = await response.text();
      let data: any = null;

      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message =
          data?.error?.message ||
          data?.error?.error?.message ||
          "Airtable AWB update failed";

        for (const item of chunk) {
          failed.push({
            orderNo: item.orderNo,
            awb: item.awb,
            message,
          });
        }
        continue;
      }

      for (const item of chunk) {
        updated.push({
          orderNo: item.orderNo,
          awb: item.awb,
          recordId: item.id,
        });
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      partial: updated.length > 0 && failed.length > 0,
      message:
        failed.length === 0
          ? `${updated.length} AWBs updated successfully`
          : `${updated.length} updated; ${failed.length} failed or skipped`,
      updated,
      failed,
      fields: {
        awb: fieldMap.awb.name,
        previousAwbs: fieldMap.previousAwbs?.name || "",
        status: fieldMap.status?.name || "",
        bookingDate: fieldMap.bookingDate?.name || "",
        lastActionDate: fieldMap.lastActionDate?.name || "",
        lastSync: fieldMap.lastSync?.name || "",
      },
    });
  } catch (error) {
    return handleApiError(error, "TFM AWBs could not be updated");
  }
}
