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
};

type SchemaTable = {
  id: string;
  name: string;
  fields: SchemaField[];
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function findField(fields: SchemaField[], candidates: string[]) {
  const byName = new Map(
    fields.map((field) => [normalize(field.name), field])
  );

  for (const candidate of candidates) {
    const match = byName.get(normalize(candidate));
    if (match) return match;
  }

  return undefined;
}

async function loadSchema(baseId: string, token: string) {
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
        data?.error?.error?.message ||
        "Unable to load Airtable schema"
    );
  }

  return (data.tables || []) as SchemaTable[];
}

function getImageUrl(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  const image = value[0] as any;

  return (
    image?.thumbnails?.large?.url ||
    image?.thumbnails?.full?.url ||
    image?.url ||
    ""
  );
}

async function loadAllRecords({
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

    fields.forEach((field) => {
      params.append("fields[]", field);
    });

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
      throw new Error(
        data?.error?.message ||
          data?.error?.error?.message ||
          "Inventory load failed"
      );
    }

    records.push(...(data.records || []));
    offset = String(data.offset || "");
  } while (offset);

  return records;
}

export async function GET(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canView && !airtable.canInventory) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to view inventory",
        },
        { status: 403 }
      );
    }

    const type = String(
      new URL(req.url).searchParams.get("type") || "dq"
    )
      .trim()
      .toLowerCase();

    if (!["dq", "fab-stock"].includes(type)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid inventory type",
        },
        { status: 400 }
      );
    }

    const baseName = normalize(airtable.baseName);
    const isDQBase =
      baseName.includes("dq") || baseName.includes("i5q");
    const isFabStockBase =
      baseName.includes("fab") &&
      baseName.includes("stock") &&
      !baseName.includes("non stock") &&
      !baseName.includes("non-stock");

    if (type === "dq" && !isDQBase) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Please select the i5Q/DQ base before opening Inventory List DQ",
        },
        { status: 400 }
      );
    }

    if (type === "fab-stock" && !isFabStockBase) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Please select the FAB Doha Stock base before opening Inventory List FAB",
        },
        { status: 400 }
      );
    }

    const schema = await loadSchema(
      airtable.baseId,
      airtable.token
    );

    const expectedTableName =
      type === "dq" ? "Products" : "Product";

    const table =
      schema.find(
        (item) =>
          normalize(item.name) === normalize(expectedTableName)
      ) ||
      schema.find((item) =>
        ["product", "products"].includes(normalize(item.name))
      );

    if (!table) {
      throw new Error(`Table not found: "${expectedTableName}"`);
    }

    const skuField = findField(table.fields, [
      "SKU",
      "Product SKU",
      "Item Code",
      "Product Code",
    ]);

    const imageField =
      findField(table.fields, [
        "Image",
        "Images",
        "Product Image",
        "Photo",
        "Photos",
        "DQ Image",
        "DQ Image 2",
      ]) ||
      table.fields.find(
        (field) => field.type === "multipleAttachments"
      );

    const quantityField = findField(table.fields, [
      "Balance Stock",
      "Stock",
      "Available Stock",
      "Current Stock",
    ]);

    const totalValueField = findField(table.fields, [
      "Total Value",
      "Stock Value",
      "Total Stock Value",
      "Inventory Value",
    ]);

    const priceField =
      type === "fab-stock"
        ? findField(table.fields, [
            "Doha Price",
            "Price",
            "Selling Price",
            "Sale Price",
            "Qatar Price",
          ])
        : undefined;

    if (!skuField) {
      throw new Error(`SKU field not found in ${table.name}`);
    }

    if (!quantityField) {
      throw new Error(
        `Balance Stock field not found in ${table.name}`
      );
    }

    if (!totalValueField) {
      throw new Error(
        `Total Value field not found in ${table.name}`
      );
    }

    if (type === "fab-stock" && !priceField) {
      throw new Error(
        `Doha Price field not found in ${table.name}`
      );
    }

    const requestedFields = [
      skuField.name,
      quantityField.name,
      totalValueField.name,
    ];

    if (imageField) {
      requestedFields.push(imageField.name);
    }

    if (priceField) {
      requestedFields.push(priceField.name);
    }

    const records = await loadAllRecords({
      baseId: airtable.baseId,
      token: airtable.token,
      tableName: table.name,
      fields: requestedFields,
    });

    const items = records
      .map((record) => {
        const quantity = Number(
          record.fields?.[quantityField.name] || 0
        );

        return {
          id: record.id,
          sku: String(
            record.fields?.[skuField.name] || ""
          ).trim(),
          imageUrl: imageField
            ? getImageUrl(record.fields?.[imageField.name])
            : "",
          quantity,
          price: priceField
            ? Number(record.fields?.[priceField.name] || 0)
            : null,
          totalValue: Number(
            record.fields?.[totalValueField.name] || 0
          ),
        };
      })
      .filter((item) => item.sku && item.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);

    return NextResponse.json({
      success: true,
      type,
      baseName: airtable.baseName,
      tableName: table.name,
      currency: type === "fab-stock" ? "QAR" : "",
      totalProducts: items.length,
      totalQuantity: items.reduce(
        (total, item) => total + item.quantity,
        0
      ),
      totalStockValue: items.reduce(
        (total, item) => total + item.totalValue,
        0
      ),
      items,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Inventory load failed",
      },
      { status: 500 }
    );
  }
}
