import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
  getInvoiceFieldMap,
} from "@/lib/airtable";
import { createAuditLog } from "@/lib/audit";

export async function PATCH(request: Request) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canEdit && !airtable.canDispatch) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to update orders" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { orderId, field, value } = body;

    if (!orderId) {
      return NextResponse.json(
        { success: false, message: "Order ID is required" },
        { status: 400 }
      );
    }

    if (!field) {
      return NextResponse.json(
        { success: false, message: "Field is required" },
        { status: 400 }
      );
    }

    let invoiceTable = airtable.tables.invoice || "BS Invoice";
    let fieldMap;

    try {
      fieldMap = await getInvoiceFieldMap(
        airtable.baseId,
        airtable.token,
        invoiceTable
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Invoice table not found") &&
        invoiceTable !== "BS Invoice"
      ) {
        invoiceTable = "BS Invoice";
        fieldMap = await getInvoiceFieldMap(
          airtable.baseId,
          airtable.token,
          invoiceTable
        );
      } else {
        throw error;
      }
    }

    let airtableField = "";
    if (field === "status") {
      airtableField = fieldMap.status;
    } else if (field === "courier") {
      airtableField = fieldMap.courier || "";
    }

    if (!airtableField) {
      return NextResponse.json(
        { success: false, message: `Field '${field}' is not defined or configured in this active base's schema.` },
        { status: 400 }
      );
    }

    const updateFields: Record<string, any> = {
      [airtableField]: value || null,
    };

    if (field === "status" && value === "Dispatched" && fieldMap.dispatchDate) {
      updateFields[fieldMap.dispatchDate] = new Date().toISOString().slice(0, 10);
    }

    const response = await fetch(
      airtableUrl(airtable.baseId, invoiceTable) + `/${orderId}`,
      {
        method: "PATCH",
        headers: airtableHeaders(airtable.token),
        cache: "no-store",
        body: JSON.stringify({
          fields: updateFields,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          message: "Order update failed",
          error: data,
        },
        { status: response.status }
      );
    }

    const numberField = fieldMap.number;
    const recordLabel = numberField && data.fields?.[numberField]
      ? String(data.fields[numberField])
      : orderId;

    await createAuditLog({
      module: "Orders",
      action: field === "status" ? "Status Change" : "Courier Change",
      recordId: orderId,
      recordLabel: recordLabel,
      newValue: JSON.stringify(updateFields),
    });

    return NextResponse.json({
      success: true,
      record: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}