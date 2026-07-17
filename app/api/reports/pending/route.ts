import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";

function escapeAirtableString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getValue(fields: Record<string, any>, names: string[]) {
  for (const name of names) {
    const value = fields[name];

    if (Array.isArray(value)) return value[0] ?? "";
    if (value !== undefined && value !== null) return value;
  }

  return "";
}

function getPendingDays(fields: Record<string, any>) {
  const dateValue = getValue(fields, ["date", "created Date"]);

  if (!dateValue) return 0;

  const created = new Date(String(dateValue));
  const now = new Date();

  return Math.max(
    0,
    Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
  );
}

function isSoldOutText(value: any) {
  const text = String(value || "").toLowerCase().trim();

  return (
    text === "sold" ||
    text.includes("sold out") ||
    text.includes("stold out") ||
    text.includes("stock out")
  );
}

function getReason(fields: Record<string, any>) {
  const supplier = String(getValue(fields, ["Supplier"]) || "Supplier");
  const billNo = getValue(fields, ["bill_no", "Bill No", "Supplier Status", "supplier_status"]);
  const receivedWh = String(getValue(fields, ["received_in_wh_1"]) || "").toLowerCase();

  if (isSoldOutText(billNo)) {
    return "Supplier Sold Out";
  }

  if (receivedWh !== "yes") {
    return `Pending from ${supplier}`;
  }

  return "Pending";
}

export async function GET(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canReports) {
      return NextResponse.json(
        { success:false, message:"You do not have permission to view reports" },
        { status:403 }
      );
    }

    const { searchParams } = new URL(request.url);

    const month = searchParams.get("month")?.trim() || "";
    const store = searchParams.get("store")?.trim() || "";
    const supplier = searchParams.get("supplier")?.trim() || "";
    const reasonFilter = searchParams.get("reason")?.trim() || "";

    const filters: string[] = [
      `{Item Code}!=''`,
      `OR(
        FIND('Order Received', ARRAYJOIN({Order Status} & '')),
        FIND('Processing', ARRAYJOIN({Order Status} & '')),
        FIND('Order Received', ARRAYJOIN({Order_status} & '')),
        FIND('Processing', ARRAYJOIN({Order_status} & ''))
      )`,
    ];

    if (month) {
      const [year, monthNo] = month.split("-").map(Number);
      const lastDay = new Date(year, monthNo, 0).getDate();

      const dateFrom = `${month}-01`;
      const dateTo = `${month}-${String(lastDay).padStart(2, "0")}`;

      filters.push(
        `DATETIME_FORMAT(SET_TIMEZONE({date}, 'Asia/Karachi'), 'YYYY-MM-DD') >= '${escapeAirtableString(dateFrom)}'`
      );
      filters.push(
        `DATETIME_FORMAT(SET_TIMEZONE({date}, 'Asia/Karachi'), 'YYYY-MM-DD') <= '${escapeAirtableString(dateTo)}'`
      );
    }

    if (store) {
      filters.push(
        `FIND(LOWER('${escapeAirtableString(store)}'), LOWER(ARRAYJOIN({Store} & ''))) > 0`
      );
    }

    if (supplier) {
      filters.push(`LOWER({Supplier} & '')=LOWER('${escapeAirtableString(supplier)}')`);
    }

    let offset = "";
    const records: any[] = [];

    do {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      params.set("sort[0][field]", "created Date");
      params.set("sort[0][direction]", "desc");
      params.set("filterByFormula", `AND(${filters.join(",")})`);

      params.append("fields[]", "Order Number");
      params.append("fields[]", "Number (from order no.)");
      params.append("fields[]", "Customer");
      params.append("fields[]", "Customer Mobile");
      params.append("fields[]", "Mobile Number");
      params.append("fields[]", "Store");
      params.append("fields[]", "Order Status");
      params.append("fields[]", "Order_status");
      params.append("fields[]", "date");
      params.append("fields[]", "created Date");
      params.append("fields[]", "Item Code");
      params.append("fields[]", "quantity");
      params.append("fields[]", "Supplier");
      params.append("fields[]", "received_in_wh_1");
      params.append("fields[]", "bill_no");
      params.append("fields[]", "total_item_price");
      params.append("fields[]", "Total Amount(Including shipping and VAT Reducing Discount)");

      if (offset) params.set("offset", offset);

      const response = await fetch(
        airtableUrl(airtable.baseId, "BS Order Entry", params),
        {
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.log("Pending Report Formula:", `AND(${filters.join(",")})`);
        console.log("Pending Report Error:", data);

        return NextResponse.json(
          {
            success: false,
            message: "Pending report failed",
            error: data,
          },
          { status: response.status }
        );
      }

      records.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);

    let rows = records.map((record) => {
      const fields = record.fields || {};
      const reason = getReason(fields);
      const qty = Number(getValue(fields, ["quantity"]) || 0);
      const itemValue = Number(getValue(fields, ["total_item_price"]) || 0);
      const days = getPendingDays(fields);

      return {
        id: record.id,
        orderNo: String(getValue(fields, ["Order Number"]) || ""),
        orderNumber: Number(getValue(fields, ["Number (from order no.)"]) || 0),
        date: String(getValue(fields, ["date"]) || ""),
        customer: String(getValue(fields, ["Customer"]) || ""),
        phone: String(getValue(fields, ["Customer Mobile", "Mobile Number"]) || ""),
        store: String(getValue(fields, ["Store"]) || ""),
        status: String(getValue(fields, ["Order Status", "Order_status"]) || ""),
        itemCode: String(getValue(fields, ["Item Code"]) || ""),
        supplier: String(getValue(fields, ["Supplier"]) || ""),
        qty,
        value: itemValue,
        receivedWh: String(getValue(fields, ["received_in_wh_1"]) || ""),
        billNo: String(getValue(fields, ["bill_no"]) || ""),
        reason,
        days,
      };
    });

    if (reasonFilter) {
      rows = rows.filter((row) => row.reason === reasonFilter);
    }

    rows.sort((a, b) => b.days - a.days || b.orderNumber - a.orderNumber);

    const orderSet = new Set(rows.map((row) => row.orderNo).filter(Boolean));
    const totalQty = rows.reduce((total, row) => total + row.qty, 0);
    const totalValue = rows.reduce((total, row) => total + row.value, 0);
    const soldOutQty = rows
      .filter((row) => row.reason === "Supplier Sold Out")
      .reduce((total, row) => total + row.qty, 0);
    const supplierPendingQty = rows
      .filter((row) => row.reason.startsWith("Pending from"))
      .reduce((total, row) => total + row.qty, 0);
    const olderThan7Qty = rows
      .filter((row) => row.days > 7)
      .reduce((total, row) => total + row.qty, 0);

    const supplierSummaryMap: Record<string, any> = {};
    const reasonSummaryMap: Record<string, any> = {};

    for (const row of rows) {
      const supplierName = row.supplier || "Unknown";

      if (!supplierSummaryMap[supplierName]) {
        supplierSummaryMap[supplierName] = {
          supplier: supplierName,
          qty: 0,
          orders: new Set<string>(),
          soldOutQty: 0,
          olderThan7Qty: 0,
        };
      }

      supplierSummaryMap[supplierName].qty += row.qty;
      supplierSummaryMap[supplierName].orders.add(row.orderNo);

      if (row.reason === "Supplier Sold Out") {
        supplierSummaryMap[supplierName].soldOutQty += row.qty;
      }

      if (row.days > 7) {
        supplierSummaryMap[supplierName].olderThan7Qty += row.qty;
      }

      if (!reasonSummaryMap[row.reason]) {
        reasonSummaryMap[row.reason] = {
          reason: row.reason,
          qty: 0,
          orders: new Set<string>(),
        };
      }

      reasonSummaryMap[row.reason].qty += row.qty;
      reasonSummaryMap[row.reason].orders.add(row.orderNo);
    }

    const supplierSummary = Object.values(supplierSummaryMap)
      .map((row: any) => ({
        supplier: row.supplier,
        qty: row.qty,
        orders: row.orders.size,
        soldOutQty: row.soldOutQty,
        olderThan7Qty: row.olderThan7Qty,
      }))
      .sort((a: any, b: any) => b.qty - a.qty);

    const reasonSummary = Object.values(reasonSummaryMap)
      .map((row: any) => ({
        reason: row.reason,
        qty: row.qty,
        orders: row.orders.size,
      }))
      .sort((a: any, b: any) => b.qty - a.qty);

    return NextResponse.json({
      success: true,
      summary: {
        totalOrders: orderSet.size,
        totalLines: rows.length,
        totalQty,
        totalValue,
        supplierPendingQty,
        soldOutQty,
        olderThan7Qty,
      },
      supplierSummary,
      reasonSummary,
      rows,
    });
  } catch (error) {
    return handleApiError(error, "Report failed");
  }
}
