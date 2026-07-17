import { NextResponse } from "next/server";
import { createCustomer, searchCustomers } from "@/lib/airtable";

type AirtableCustomerRecord = {
  id?: string;
  createdTime?: string;
  fields?: Record<string, unknown>;
};

function firstText(value: unknown): string {
  if (Array.isArray(value)) {
    const firstValue = value[0];

    if (firstValue === undefined || firstValue === null) return "";

    if (typeof firstValue === "object") {
      const linkedValue = firstValue as Record<string, unknown>;
      return String(
        linkedValue.name ??
          linkedValue.value ??
          linkedValue.text ??
          linkedValue.id ??
          ""
      ).trim();
    }

    return String(firstValue).trim();
  }

  if (value === undefined || value === null) return "";

  return String(value).trim();
}

function getField(
  fields: Record<string, unknown>,
  possibleNames: string[]
): string {
  for (const fieldName of possibleNames) {
    const value = firstText(fields[fieldName]);
    if (value) return value;
  }

  return "";
}

function normalizeCustomerRecord(record: AirtableCustomerRecord) {
  const fields = record.fields ?? {};

  // Current Customers table fields are Name, Contact and Address.
  // Older ERP code may still expect customerName/name and contactNo/mobile.
  const name = getField(fields, [
    "Name",
    "Customer Name",
    "Customer",
    "customerName",
  ]);

  const contact = getField(fields, [
    "Contact",
    "Contact No",
    "Contact No.",
    "Contact Number",
    "Mobile",
    "Phone",
  ]);

  const address = getField(fields, [
    "Address",
    "Billing Address Line 1",
    "Customer Address",
  ]);

  const area = getField(fields, [
    "Area Name",
    "Area",
    "Billing Address Area",
  ]);

  const city = getField(fields, [
    "City Name",
    "City",
    "Billing Address City",
  ]);

  return {
    id: record.id ?? "",
    createdTime: record.createdTime ?? "",
    fields,

    // Normalized keys used by different customer-search UIs.
    name,
    customerName: name,
    contact,
    contactNo: contact,
    mobile: contact,
    phone: contact,
    address,
    area,
    areaName: area,
    city,
    cityName: city,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";

    if (!q) {
      return NextResponse.json(
        { success: false, message: "Search query is required" },
        { status: 400 }
      );
    }

    const data = await searchCustomers(q);
    const rawRecords: AirtableCustomerRecord[] = Array.isArray(data?.records)
      ? data.records
      : [];

    return NextResponse.json({
      success: true,
      records: rawRecords.map(normalizeCustomerRecord),
    });
  } catch (error: any) {
    console.error("Customer Search API Error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error?.message ||
          error?.error?.error?.message ||
          error?.error?.message ||
          "Unknown server error",
        details: error?.error || null,
      },
      { status: Number(error?.status) || 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { contactNo, customerName, address, areaName, cityName } = body;

    if (!String(contactNo ?? "").trim() || !String(customerName ?? "").trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Contact No. and Customer Name are required.",
        },
        { status: 400 }
      );
    }

    const customer = await createCustomer({
      contactNo: String(contactNo).trim(),
      customerName: String(customerName).trim(),
      address: String(address ?? "").trim(),
      areaName: String(areaName ?? "").trim(),
      cityName: String(cityName ?? "").trim(),
    });

    return NextResponse.json({
      success: true,
      record: customer,
    });
  } catch (error: any) {
    console.error("Create Customer Error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error?.message ||
          error?.error?.error?.message ||
          error?.error?.message ||
          "Unknown server error",
        details: error?.error || null,
      },
      { status: Number(error?.status) || 500 }
    );
  }
}
