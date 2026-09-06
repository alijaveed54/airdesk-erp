import { NextResponse } from "next/server";

import {
  airtableHeaders,
  airtableUrl,
  handleApiError,
  getCurrentAirtableBase,
} from "@/lib/airtable";

const SOURCE = {
  baseId: "appiz6tozkQO2TQXt",
  tableName: "FAB Order Entry",
};

function cleanText(value: any) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function isYes(value: any) {
  return ["yes", "true", "1"].includes(
    cleanText(value).toLowerCase()
  );
}

async function fetchRecords(token: string) {
  const params = new URLSearchParams();

  [
    "Order Number",
    "Item Code",
    "received_in_wh_1",
    "Received In UAE",
    "Received In UAE DateTime",
    "Dispatch To Doha",
    "Dispatch To Doha DateTime",
    "created date",
    "Order_status",
  ].forEach((field) => {
    params.append("fields[]", field);
  });

  params.set("pageSize", "100");

  const response = await fetch(
    airtableUrl(
      SOURCE.baseId,
      SOURCE.tableName,
      params
    ),
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );

  const data = await response.json();

  return (data.records || [])
    .map((record:any)=>({
      id: record.id,
      orderNo: cleanText(record.fields["Order Number"]),
      sku: cleanText(record.fields["Item Code"]),
      receivedWh: cleanText(record.fields["received_in_wh_1"]),
      receivedInUae: cleanText(record.fields["Received In UAE"]),
      receivedDate: record.fields["Received In UAE DateTime"] || "",
      createdDate: record.fields["created date"] || "",
      orderStatus: cleanText(record.fields["Order_status"]),
      dispatchToDoha: cleanText(record.fields["Dispatch To Doha"]),
    }))
    .filter((item:any)=>
      Boolean(item.orderNo) &&
      Boolean(item.sku) &&
      isYes(item.receivedWh) &&
      isYes(item.receivedInUae) &&
      (
        !item.orderStatus ||
        item.orderStatus === "Processing" ||
        item.orderStatus === "Order Received"
      ) &&
      item.dispatchToDoha.toLowerCase() !== "dispatched"
    );
}

export async function GET() {
  try {
    const { token } = await getCurrentAirtableBase();

    const rows = await fetchRecords(token);

    return NextResponse.json({
      success:true,
      rows,
    });

  } catch(error) {
    return handleApiError(error);
  }
}
