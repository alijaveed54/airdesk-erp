import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";

const BS_BASE = {
  baseName: "BS Order Entry (UAE) (June-26)",
  baseId: "app2hjpuQoeEL1Rn2",
  tableName: "BS Order Entry",
};

function textValue(value: any): string {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textValue(item);
      if (text) return text;
    }
    return "";
  }

  if (typeof value === "object") {
    return String(
      value.name ??
        value.value ??
        value.text ??
        value.label ??
        value.title ??
        ""
    ).trim();
  }

  return String(value).trim();
}

function firstValue(value: any) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
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

function isPhoneNumber(val: string): boolean {
  const cleaned = val.replace(/[\s\+\-\(\)]/g, "");
  // Agar majority numbers hon to wo phone number hai
  return /^\d{7,}$/.test(cleaned);
}

function getCustomerName(fields: Record<string, any>) {
  // Pehle specific name fields check karein
  const directFields = [
    fields["Customer Name"],
    fields["customer name"],
    fields["Consignee Name"],
    fields["consignee name"],
    fields["Consignee"],
    fields["consignee"],
    fields["Client Name"],
    fields["Name"],
  ];

  for (const fieldVal of directFields) {
    const val = textValue(fieldVal);
    if (val && !isPhoneNumber(val)) {
      return val;
    }
  }

  // Agar 'Customer' field me multi-value array ho (jaise [phone, name] ya [name, phone])
  const customerVal = fields["Customer"] || fields["customer"];
  if (Array.isArray(customerVal)) {
    for (const item of customerVal) {
      const str = textValue(item);
      if (str && !isPhoneNumber(str)) {
        return str;
      }
    }
  } else {
    const str = textValue(customerVal);
    if (str && !isPhoneNumber(str)) {
      return str;
    }
  }

  // Fallback: Kisi bhi field me jisme name ho
  for (const [key, val] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      (lowerKey.includes("name") || lowerKey.includes("customer")) &&
      !lowerKey.includes("item") &&
      !lowerKey.includes("supplier") &&
      !lowerKey.includes("file")
    ) {
      const extracted = textValue(val);
      if (extracted && !isPhoneNumber(extracted)) {
        return extracted;
      }
    }
  }

  return "";
}

function normalizeRecord(record: any, baseId: string, tableName: string) {
  const fields = record.fields || {};

  return {
    id: record.id,
    _baseId: baseId,
    _tableName: tableName,
    orderNo: getOrderNumber(fields),
    customerName: getCustomerName(fields),
    sku: textValue(fields["Item Code"] || fields.SKU || fields.sku || ""),
    quantity: Number(fields.quantity || fields.Qty || fields.qty || 1),
    orderStatus: textValue(
      fields.Order_status ||
        fields["Order Status"] ||
        fields.order_status ||
        "Processing"
    ),
    imageUrl:
      Array.isArray(fields.image) && fields.image[0]
        ? Array.isArray(fields.image[0])
          ? fields.image[0][0]?.url
          : fields.image[0]?.url
        : fields.image?.url || "",
    supplier: textValue(fields.Supplier || fields["Supplier Code"] || "-"),
    createdDate: String(
      firstValue(fields["created Date"]) ||
        firstValue(fields["Created Date"]) ||
        firstValue(fields.date) ||
        ""
    ),
  };
}

async function fetchBSInstockRecords({
  baseId,
  tableName,
  token,
}: {
  baseId: string;
  tableName: string;
  token: string;
}) {
  const records: any[] = [];
  let offset = "";

  const formula = `AND(
    LOWER({received_in_wh_1} & '') = 'yes',
    LOWER({instock} & '') = 'yes',
    LEN(TRIM({bill_no} & '')) = 0,
    LOWER({Sold Out} & '') != 'yes',
    LEN(TRIM({Item Code} & '')) > 0
  )`;

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set("filterByFormula", formula);

    if (offset) {
      params.set("offset", offset);
    }

    const response = await fetch(airtableUrl(baseId, tableName, params), {
      headers: airtableHeaders(token),
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || `Airtable fetch failed for ${tableName}`
      );
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    const currentAirtable = await getCurrentAirtableBase();
    const globalToken =
      process.env.AIRTABLE_TOKEN || process.env.AUTH_AIRTABLE_TOKEN || "";

    const permissionForBase = session.permissions?.find(
      (permission: any) => permission.baseId === BS_BASE.baseId
    );

    const baseToken =
      globalToken ||
      permissionForBase?.airtableToken ||
      currentAirtable.token ||
      "";

    if (!baseToken) {
      return NextResponse.json(
        { success: false, message: "Airtable token missing for BS base" },
        { status: 500 }
      );
    }

    const rawRecords = await fetchBSInstockRecords({
      baseId: BS_BASE.baseId,
      tableName: BS_BASE.tableName,
      token: baseToken,
    });

    const records = rawRecords
      .map((r) => normalizeRecord(r, BS_BASE.baseId, BS_BASE.tableName))
      .filter((r) => r.orderNo && r.sku);

    records.sort((a, b) => {
      const aTime = a.createdDate ? new Date(a.createdDate).getTime() : 0;
      const bTime = b.createdDate ? new Date(b.createdDate).getTime() : 0;
      return bTime - aTime;
    });

    return NextResponse.json({
      success: true,
      records,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to load in-stock items" },
      { status: 500 }
    );
  }
}