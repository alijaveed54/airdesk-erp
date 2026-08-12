import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";

type SchemaField = {
  id: string;
  name: string;
  type: string;
  options?: {
    linkedTableId?: string;
  };
};

type SchemaTable = {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: SchemaField[];
};

const schemaCache = new Map<string, SchemaTable[]>();

function getRole(airtable: unknown): string {
  const source = airtable as Record<string, any>;

  return String(
    source?.role ??
      source?.userRole ??
      source?.accountRole ??
      source?.user?.role ??
      source?.session?.role ??
      source?.permissions?.role ??
      ""
  )
    .trim()
    .toLowerCase();
}

function isSupplierRole(airtable: unknown) {
  return getRole(airtable).includes("supplier");
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function text(value: unknown): string {
  const resolved = first(value);

  if (resolved == null) return "";

  if (typeof resolved === "object") {
    const objectValue = resolved as Record<string, unknown>;

    return String(
      objectValue.name ??
        objectValue.value ??
        objectValue.text ??
        ""
    );
  }

  return String(resolved);
}

function escapeFormulaText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function findField(fields: SchemaField[], candidates: string[]) {
  const lookup = new Map(
    fields.map((field) => [
      field.name.trim().toLowerCase(),
      field,
    ])
  );

  for (const candidate of candidates) {
    const found = lookup.get(candidate.trim().toLowerCase());

    if (found) return found;
  }

  return undefined;
}

async function getSchema(baseId: string, token: string) {
  const cached = schemaCache.get(baseId);

  if (cached) return cached;

  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(
      baseId
    )}/tables`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "Unable to load Airtable schema"
    );
  }

  const tables = (data.tables || []) as SchemaTable[];

  schemaCache.set(baseId, tables);

  return tables;
}

function primaryField(table: SchemaTable) {
  return (
    table.fields.find(
      (field) => field.id === table.primaryFieldId
    ) || table.fields[0]
  );
}

async function resolveLinkedCustomerNames({
  baseId,
  token,
  customerTable,
  recordIds,
}: {
  baseId: string;
  token: string;
  customerTable: SchemaTable;
  recordIds: string[];
}) {
  const uniqueIds = Array.from(
    new Set(
      recordIds.filter((recordId) =>
        recordId.startsWith("rec")
      )
    )
  );

  const names = new Map<string, string>();

  if (!uniqueIds.length) return names;

  const customerPrimaryField = primaryField(customerTable);

  if (!customerPrimaryField) return names;

  for (let index = 0; index < uniqueIds.length; index += 40) {
    const batch = uniqueIds.slice(index, index + 40);

    const formula =
      batch.length === 1
        ? `RECORD_ID()='${batch[0]}'`
        : `OR(${batch
            .map(
              (recordId) =>
                `RECORD_ID()='${recordId}'`
            )
            .join(",")})`;

    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: formula,
    });

    const response = await fetch(
      airtableUrl(
        baseId,
        customerTable.name,
        params
      ),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          "Unable to resolve customer names"
      );
    }

    for (const record of data.records || []) {
      names.set(
        String(record.id),
        text(
          record.fields?.[
            customerPrimaryField.name
          ]
        )
      );
    }
  }

  return names;
}

export async function GET(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (isSupplierRole(airtable)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Supplier accounts cannot access Quick Edit",
        },
        { status: 403 }
      );
    }

    if (!airtable.canView) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You do not have permission to search orders",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const query = String(
      searchParams.get("q") || ""
    ).trim();

    if (!query) {
      return NextResponse.json({
        success: true,
        results: [],
      });
    }

    const schema = await getSchema(
      airtable.baseId,
      airtable.token
    );

    const invoiceTableName =
      airtable.tables?.invoice || "BS Invoice";

    const invoiceTable = schema.find(
      (table) => table.name === invoiceTableName
    );

    if (!invoiceTable) {
      return NextResponse.json(
        {
          success: false,
          message: `Invoice table not found: ${invoiceTableName}`,
        },
        { status: 404 }
      );
    }

    const orderField = primaryField(invoiceTable);

    if (!orderField) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Order Number field not found in invoice table",
        },
        { status: 404 }
      );
    }

    const customerField = findField(
      invoiceTable.fields || [],
      [
        "Customer",
        "Customers",
        "Customer Name",
        "Customer Details",
        "Contact No.",
        "Contact No",
        "Consignee",
        "Name",
      ]
    );

    const safeQuery = escapeFormulaText(
      query.toLowerCase()
    );

    const searchParts = [
      `FIND('${safeQuery}',LOWER({${orderField.name}}&''))>0`,
    ];

    if (customerField) {
      searchParts.push(
        `FIND('${safeQuery}',LOWER({${customerField.name}}&''))>0`
      );
    }

    const params = new URLSearchParams({
      pageSize: "15",
      filterByFormula:
        searchParts.length === 1
          ? searchParts[0]
          : `OR(${searchParts.join(",")})`,
    });

    params.set(
      "sort[0][field]",
      orderField.name
    );
    params.set("sort[0][direction]", "desc");

    const response = await fetch(
      airtableUrl(
        airtable.baseId,
        invoiceTable.name,
        params
      ),
      {
        headers: airtableHeaders(
          airtable.token
        ),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            data?.error?.message ||
            "Unable to search orders",
        },
        { status: response.status }
      );
    }

    const records = data.records || [];
    let customerNames = new Map<string, string>();

    if (
      customerField?.type ===
        "multipleRecordLinks" &&
      customerField.options?.linkedTableId
    ) {
      const customerTable = schema.find(
        (table) =>
          table.id ===
          customerField.options?.linkedTableId
      );

      if (customerTable) {
        const customerIds = records.flatMap(
          (record: any) => {
            const raw =
              record.fields?.[
                customerField.name
              ];

            return Array.isArray(raw)
              ? raw
              : raw
                ? [raw]
                : [];
          }
        );

        customerNames =
          await resolveLinkedCustomerNames({
            baseId: airtable.baseId,
            token: airtable.token,
            customerTable,
            recordIds: customerIds,
          });
      }
    }

    const results = records
      .map((record: any) => {
        const rawCustomer = customerField
          ? record.fields?.[
              customerField.name
            ]
          : "";

        const customerId = text(rawCustomer);

        return {
          id: String(record.id),
          orderNo: text(
            record.fields?.[orderField.name]
          ),
          customer:
            customerNames.get(customerId) ||
            text(rawCustomer),
        };
      })
      .filter(
        (item: {
          id: string;
          orderNo: string;
          customer: string;
        }) => Boolean(item.orderNo)
      )
      .slice(0, 15);

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error(
      "Quick Edit order search failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Quick Edit order search failed",
      },
      { status: 500 }
    );
  }
}
