import {
  airtableFetch,
  airtablePaginatedFetch,
  apiError,
  apiSuccess,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";

type AirtableField = {
  name: string;
  type?: string;
};

type CodFieldMap = {
  orderNo: string;
  status: string;
  cod: string;
  codReceiveDate: string;
  customer?: string;
  phone?: string;
  store?: string;
  courier?: string;
  deliveredDate?: string;
  amount?: string;
};

function normalize(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function findField(fields: AirtableField[], candidates: string[]) {
  const names = new Map(
    fields.map((field) => [normalize(field.name), field.name]),
  );

  for (const candidate of candidates) {
    const found = names.get(normalize(candidate));
    if (found) return found;
  }

  return "";
}

function stringValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object" && item !== null && "name" in item
          ? String((item as { name?: unknown }).name || "")
          : String(item ?? ""),
      )
      .filter(Boolean)
      .join(", ");
  }

  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name?: unknown }).name || "");
  }

  return String(value ?? "");
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const parsed = Number(
    String(value ?? "")
      .replace(/[^0-9.-]/g, "")
      .trim(),
  );

  return Number.isFinite(parsed) ? parsed : 0;
}

function isDohaBase(baseName: string, invoiceTable: string) {
  const identity = `${baseName} ${invoiceTable}`.toLowerCase();

  return (
    identity.includes("doha") ||
    identity.includes("fab") ||
    identity.includes("dq") ||
    identity.includes("i5q")
  );
}

function isTruthyCod(value: unknown) {
  if (value === true || value === 1) return true;

  const text = normalize(String(value ?? ""));
  return ["yes", "true", "received", "paid", "1"].includes(text);
}

async function getInvoiceSchema(
  baseId: string,
  token: string,
  invoiceTable: string,
) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(
      baseId,
    )}/tables`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Unable to load Airtable invoice schema.",
    );
  }

  const table = (data.tables || []).find(
    (item: { name?: string }) => item.name === invoiceTable,
  );

  if (!table) {
    throw new Error(`Invoice table not found: ${invoiceTable}`);
  }

  return (table.fields || []) as AirtableField[];
}

function buildFieldMap(fields: AirtableField[]): CodFieldMap {
  const map: CodFieldMap = {
    orderNo: findField(fields, [
      "Order No.",
      "Order No",
      "Order Number",
      "Invoice No.",
      "Invoice No",
      "Invoice Number",
      "Order ID",
    ]),
    status: findField(fields, [
      "Order Status",
      "Order_status",
      "order_status",
      "Status",
    ]),
    cod: findField(fields, [
      "cod_status",
      "COD_Status",
      "COD Status",
      "COD",
      "COD Received",
      "COD Receive",
      "COD Paid",
    ]),
    codReceiveDate: findField(fields, [
      "COD Receive Date",
      "COD Received Date",
      "COD Date",
    ]),
    customer: findField(fields, [
      "Customer Name",
      "Customer",
      "Consignee",
      "Name",
    ]),
    phone: findField(fields, [
      "Contact No.",
      "Contact No",
      "Phone",
      "Mobile",
      "Telephone1",
    ]),
    store: findField(fields, [
      "Store",
      "Select Store",
      "Store Name",
      "Sales Channel",
    ]),
    courier: findField(fields, [
      "Courier",
      "Courier Name",
      "Driver",
      "Driver Name",
      "Delivery Partner",
    ]),
    deliveredDate: findField(fields, [
      "Delivered Date",
      "COD Delivered Date",
      "Despatch Date",
      "Dispatch Date",
      "Delivery Date",
      "Date Delivered",
    ]),
    amount: findField(fields, [
      "cod_amount",
      "COD Amount1",
      "COD Amount",
      "COD Amount (AED)",
      "CODAmt",
      "COD Value",
      "Grand Total",
      "Net Total",
      "Order Total",
      "Order_Total",
      "total_order_value",
      "Total Amount",
      "Total",
      "Balance Amount",
      "Amount",
    ]),
  };

  const missing = [
    !map.orderNo ? "Order No." : "",
    !map.status ? "Order Status" : "",
    !map.cod ? "COD" : "",
    !map.codReceiveDate ? "COD Receive Date" : "",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Required Airtable field(s) missing in Invoice table: ${missing.join(
        ", ",
      )}`,
    );
  }

  return map;
}

export async function GET() {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReports) {
      return apiError("You do not have permission to view reports.", 403);
    }

    if (isDohaBase(airtable.baseName, airtable.tables.invoice)) {
      return apiSuccess({
        excluded: true,
        baseName: airtable.baseName,
        orders: [],
      });
    }

    const schema = await getInvoiceSchema(
      airtable.baseId,
      airtable.token,
      airtable.tables.invoice,
    );
    const map = buildFieldMap(schema);

    const params = new URLSearchParams();
    params.set("pageSize", "100");

    const records = await airtablePaginatedFetch({
      baseId: airtable.baseId,
      token: airtable.token,
      table: airtable.tables.invoice,
      params,
    });

    const orders = records
      .filter((record: { fields?: Record<string, unknown> }) => {
        const fields = record.fields || {};
        const status = normalize(stringValue(fields[map.status]));

        return status === "delivered" && !isTruthyCod(fields[map.cod]);
      })
      .map(
        (record: {
          id: string;
          fields?: Record<string, unknown>;
        }) => {
          const fields = record.fields || {};

          return {
            id: record.id,
            orderNo: stringValue(fields[map.orderNo]),
            customer: map.customer
              ? stringValue(fields[map.customer])
              : "",
            phone: map.phone ? stringValue(fields[map.phone]) : "",
            store: map.store ? stringValue(fields[map.store]) : "",
            courier: map.courier
              ? stringValue(fields[map.courier])
              : "",
            deliveredDate: map.deliveredDate
              ? stringValue(fields[map.deliveredDate])
              : "",
            amount: map.amount ? numberValue(fields[map.amount]) : 0,
            baseName: airtable.baseName,
          };
        },
      )
      .sort((a, b) => {
        const aTime = new Date(a.deliveredDate || 0).getTime();
        const bTime = new Date(b.deliveredDate || 0).getTime();
        return bTime - aTime;
      });

    return apiSuccess({
      excluded: false,
      baseName: airtable.baseName,
      orders,
    });
  } catch (error) {
    return handleApiError(error, "Unable to load COD pending report.");
  }
}

export async function PATCH(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReports && !airtable.canFinance && !airtable.canEdit) {
      return apiError("You do not have permission to update COD.", 403);
    }

    if (isDohaBase(airtable.baseName, airtable.tables.invoice)) {
      return apiError(
        "COD update is not required for Doha bases. Delivered already means COD received.",
        400,
      );
    }

    const body = await request.json();
    const recordIds = Array.isArray(body?.recordIds)
      ? body.recordIds
          .map((value: unknown) => String(value || "").trim())
          .filter(Boolean)
      : [];
    const receiveDate = String(body?.receiveDate || "").trim();

    if (recordIds.length === 0) {
      return apiError("Select at least one COD order.", 400);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(receiveDate)) {
      return apiError("A valid COD Receive Date is required.", 400);
    }

    const schema = await getInvoiceSchema(
      airtable.baseId,
      airtable.token,
      airtable.tables.invoice,
    );
    const map = buildFieldMap(schema);

    let updated = 0;

    for (let index = 0; index < recordIds.length; index += 10) {
      const chunk = recordIds.slice(index, index + 10);

      const result = await airtableFetch({
        baseId: airtable.baseId,
        token: airtable.token,
        table: airtable.tables.invoice,
        method: "PATCH",
        fields: {
          records: chunk.map((id: string) => ({
            id,
            fields: {
              [map.cod]: "Yes",
              [map.codReceiveDate]: receiveDate,
            },
          })),
        },
      });

      updated += Array.isArray(result?.records)
        ? result.records.length
        : chunk.length;
    }

    return apiSuccess({
      updated,
      receiveDate,
    });
  } catch (error) {
    return handleApiError(error, "Unable to mark COD as received.");
  }
}
