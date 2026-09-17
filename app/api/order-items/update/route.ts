import { NextRequest, NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import {
  resolveInvoiceIdsForOrderEntryRecords,
  syncInvoiceInstockStatuses,
} from "@/lib/order-instock-sync";

type AirtableSchemaField = {
  id: string;
  name: string;
  type: string;
};

type AirtableSchemaTable = {
  id: string;
  name: string;
  fields: AirtableSchemaField[];
};

const READ_ONLY_FIELD_TYPES = new Set([
  "formula",
  "rollup",
  "multipleLookupValues",
  "count",
  "createdTime",
  "lastModifiedTime",
  "createdBy",
  "lastModifiedBy",
  "autoNumber",
  "button",
]);

function findWritableField(
  fields: AirtableSchemaField[],
  candidates: string[]
): AirtableSchemaField | undefined {
  const normalized = new Map(
    fields.map((field) => [field.name.trim().toLowerCase(), field])
  );

  for (const candidate of candidates) {
    const field = normalized.get(candidate.trim().toLowerCase());

    if (field && !READ_ONLY_FIELD_TYPES.has(field.type)) {
      return field;
    }
  }

  return undefined;
}

function valueForField(
  field: AirtableSchemaField,
  value: unknown
): unknown {
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "duration" ||
    field.type === "rating"
  ) {
    return Number(value || 0);
  }

  if (field.type === "checkbox") {
    return Boolean(value);
  }

  const text = String(value ?? "").trim();

  if (
    field.type === "singleSelect" ||
    field.type === "multipleSelects"
  ) {
    return text || null;
  }

  return text;
}

function valueForYesField(field: AirtableSchemaField): unknown {
  if (field.type === "checkbox") return true;
  if (field.type === "number" || field.type === "currency" || field.type === "percent") return 1;
  if (field.type === "multipleSelects") return ["Yes"];
  return "Yes";
}

function valueForBlankField(field: AirtableSchemaField): unknown {
  if (field.type === "checkbox") return false;
  if (field.type === "multipleSelects") return [];
  if (field.type === "singleSelect") return null;
  if (field.type === "number" || field.type === "currency" || field.type === "percent") return null;
  return "";
}

function isYesValue(value: unknown) {
  if (value === true || value === 1) return true;

  return ["yes", "true", "1", "checked", "received"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase()
  );
}

async function loadOrderEntrySchema({
  baseId,
  token,
  tableName,
}: {
  baseId: string;
  token: string;
  tableName: string;
}) {
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

  const table = (data.tables || []).find(
    (item: AirtableSchemaTable) => item.name === tableName
  ) as AirtableSchemaTable | undefined;

  if (!table) {
    throw new Error(`Order Entry table not found: ${tableName}`);
  }

  return table.fields || [];
}

function chunkRecords<T>(records: T[], size = 10): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size));
  }

  return chunks;
}


async function recordExistsInTable({
  baseId,
  token,
  tableName,
  recordId,
}: {
  baseId: string;
  token: string;
  tableName: string;
  recordId: string;
}) {
  const response = await fetch(
    `${airtableUrl(baseId, tableName)}/${recordId}`,
    {
      headers: airtableHeaders(token),
      cache: "no-store",
    }
  );

  return response.ok;
}

async function resolveOrderEntryTable({
  baseName,
  configuredTable,
}: {
  baseId: string;
  token: string;
  baseName: string;
  configuredTable: string;
  recordId: string;
}) {
  const normalizedBaseName = String(baseName || "")
    .trim()
    .toLowerCase();

  const isI5qDqBase =
    normalizedBaseName.includes("i5q") ||
    normalizedBaseName.includes("dq") ||
    normalizedBaseName.includes("04-10-2026");

  return isI5qDqBase ? "DQ Order Entry" : configuredTable;
}

export async function PATCH(req: NextRequest) {
  try {
    const airtable = await getCurrentAirtableBase();

    if (!airtable.canEdit) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to update order items",
        },
        { status: 403 }
      );
    }

    const body = await req.json();
    const items = body.items || [];

    const requestBaseId = body.baseId || items[0]?.baseId;
    const requestTableName = body.tableName || items[0]?.tableName;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, message: "Items are required" },
        { status: 400 }
      );
    }

    const invalidItem = items.find(
      (item: any) =>
        !item?.id || !String(item.id).startsWith("rec")
    );

    if (invalidItem) {
      return NextResponse.json(
        {
          success: false,
          message: "A valid Airtable record ID is required for every item",
        },
        { status: 400 }
      );
    }

    const configuredOrderEntryTable =
      airtable.tables.orderEntry || "BS Order Entry";

    const hasDispatchToDohaUpdate = items.some(
      (item: any) => item?.dispatchToDoha !== undefined
    );

    const orderEntryTable = hasDispatchToDohaUpdate
      ? (requestTableName || "FAB Order Entry")
      : await resolveOrderEntryTable({
          baseId: airtable.baseId,
          token: airtable.token,
          baseName: airtable.baseName,
          configuredTable: configuredOrderEntryTable,
          recordId: String(items[0].id),
        });

    const updateBaseId = hasDispatchToDohaUpdate
      ? (requestBaseId || "appiz6tozkQO2TQXt")
      : airtable.baseId;

    const schemaFields = await loadOrderEntrySchema({
      baseId: updateBaseId,
      token: airtable.token,
      tableName: orderEntryTable,
    });

    console.log("========== ORDER ITEMS UPDATE ==========");
    console.log("Base:", airtable.baseName);
    console.log("Configured Table:", configuredOrderEntryTable);
    console.log("Resolved Table:", orderEntryTable);
    console.log("Record IDs:", items.map((item: any) => item.id));

    /*
      Schema-aware field aliases for all registered bases:

      BS / FAB:
        quantity, Supplier, received_in_wh_1, bill_no

      Tatlumput Siyam:
        Quantity

      i5Q / DQ:
        quantity, Size, single price, Pack Price

      Missing/read-only fields are deliberately skipped.
    */
    const fieldMap = {
      quantity: findWritableField(schemaFields, [
        "quantity",
        "Quantity",
        "Qty",
        "QTY",
      ]),
      supplier: findWritableField(schemaFields, [
        "Supplier",
        "Purchase Supplier",
        "supplier",
      ]),
      receivedWh: findWritableField(schemaFields, [
        "received_in_wh_1",
        "Received in WH 1",
        "Received In WH 1",
        "Received WH 1",
        "Warehouse Received",
        "instock",
      ]),
      receivedInUae: findWritableField(schemaFields, [
        "Received In UAE",
        "Received in UAE",
        "received_in_uae",
      ]),
      receivedInUaeDateTime: findWritableField(schemaFields, [
        "Received In UAE DateTime",
        "Received in UAE DateTime",
        "Received In UAE Date Time",
        "received_in_uae_datetime",
      ]),
      dispatchToDoha: findWritableField(schemaFields, [
        "Dispatch To Doha",
        "dispatch_to_doha",
      ]),
      dispatchToDohaDateTime: findWritableField(schemaFields, [
        "Dispatch To Doha DateTime",
        "Dispatch To Doha Date Time",
        "dispatch_to_doha_datetime",
      ]),
      inStock: findWritableField(schemaFields, [
        "instock",
        "In Stock",
        "Instock",
        "InStock",
      ]),
      billNo: findWritableField(schemaFields, [
        "bill_no",
        "Bill No",
        "Bill No.",
        "Bill Number",
      ]),
      size: findWritableField(schemaFields, [
        "Size",
        "size",
      ]),
      singlePrice: findWritableField(schemaFields, [
        "single price",
        "Single Price",
        "single_price",
      ]),
      packPrice: findWritableField(schemaFields, [
        "Pack Price",
        "pack price",
        "pack_price",
      ]),
      offerPrice: findWritableField(schemaFields, [
        "Offer Price",
        "offer price",
      ]),
    };

    const isBsOrderEntry =
      airtable.baseId === "app2hjpuQoeEL1Rn2" &&
      orderEntryTable === "BS Order Entry";

    const hasBsInstockUpdate =
      isBsOrderEntry &&
      items.some(
        (item: any) =>
          item?.receivedWh !== undefined && isYesValue(item.receivedWh)
      );

    if (hasBsInstockUpdate) {
      const missingFields = [
        !fieldMap.receivedWh ? "received_in_wh_1" : "",
        !fieldMap.billNo ? "bill_no" : "",
        !fieldMap.inStock ? "instock" : "",
        !fieldMap.receivedInUae ? "Received In UAE" : "",
      ].filter(Boolean);

      if (missingFields.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: `BS In Stock item fields missing or read-only: ${missingFields.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    if (!fieldMap.quantity) {
      return NextResponse.json(
        {
          success: false,
          message: `Editable quantity field not found in ${orderEntryTable}`,
        },
        { status: 400 }
      );
    }

    const records = items.map((item: any) => {
      const markAsBsInstock =
        isBsOrderEntry &&
        item?.receivedWh !== undefined &&
        isYesValue(item.receivedWh);

      const fields: Record<string, unknown> = {};

      // Only update quantity when it is explicitly provided.
      // Actions like Received In UAE should not overwrite quantity with 0.
      if (item.quantity !== undefined) {
        fields[fieldMap.quantity!.name] = valueForField(
          fieldMap.quantity!,
          item.quantity
        );
      }

      if (fieldMap.supplier && item.supplier !== undefined) {
        fields[fieldMap.supplier.name] = valueForField(
          fieldMap.supplier,
          item.supplier
        );
      }

      if (fieldMap.receivedWh && item.receivedWh !== undefined) {
        fields[fieldMap.receivedWh.name] = valueForField(
          fieldMap.receivedWh,
          item.receivedWh
        );

        if (
          isYesValue(item.receivedWh) &&
          fieldMap.receivedInUae
        ) {
          fields[fieldMap.receivedInUae.name] = valueForYesField(
            fieldMap.receivedInUae
          );
        }

        if (markAsBsInstock) {
          // Locked BS Order Entry In Stock rule:
          // received_in_wh_1 = Yes
          // bill_no = blank
          // instock = Yes
          // Received In UAE = Yes
          fields[fieldMap.inStock!.name] = valueForYesField(fieldMap.inStock!);
          fields[fieldMap.billNo!.name] = valueForBlankField(fieldMap.billNo!);
        }
      }

      if (
        fieldMap.receivedInUae &&
        item.receivedInUae !== undefined
      ) {
        const isReceived = String(item.receivedInUae || "").trim() === "Yes";

        fields[fieldMap.receivedInUae.name] = isReceived
          ? valueForYesField(fieldMap.receivedInUae)
          : valueForBlankField(fieldMap.receivedInUae);

        if (fieldMap.receivedInUaeDateTime) {
          fields[fieldMap.receivedInUaeDateTime.name] = isReceived
            ? new Date().toISOString()
            : null;
        }
      }

      if (
        fieldMap.dispatchToDoha &&
        item.dispatchToDoha !== undefined
      ) {
        const isDispatched =
          String(item.dispatchToDoha || "").trim().toLowerCase() === "dispatched";

        fields[fieldMap.dispatchToDoha.name] = isDispatched
          ? valueForField(fieldMap.dispatchToDoha, "Dispatched")
          : valueForBlankField(fieldMap.dispatchToDoha);

        if (fieldMap.dispatchToDohaDateTime) {
          fields[fieldMap.dispatchToDohaDateTime.name] = isDispatched
            ? new Date().toISOString()
            : null;
        }
      }

      if (
        fieldMap.billNo &&
        item.billNo !== undefined &&
        !markAsBsInstock
      ) {
        fields[fieldMap.billNo.name] = valueForField(
          fieldMap.billNo,
          item.billNo
        );
      }

      if (fieldMap.size && item.size !== undefined) {
        fields[fieldMap.size.name] = valueForField(
          fieldMap.size,
          item.size
        );
      }

      if (fieldMap.singlePrice) {
        const singlePriceValue =
          item.singlePrice ?? item.price;

        if (singlePriceValue !== undefined) {
          fields[fieldMap.singlePrice.name] = valueForField(
            fieldMap.singlePrice,
            singlePriceValue
          );
        }
      }

      if (fieldMap.packPrice && item.packPrice !== undefined) {
        fields[fieldMap.packPrice.name] = valueForField(
          fieldMap.packPrice,
          item.packPrice
        );
      }

      if (fieldMap.offerPrice) {
        const offerPriceValue =
          item.offerPrice ?? item.price;

        if (offerPriceValue !== undefined) {
          fields[fieldMap.offerPrice.name] = valueForField(
            fieldMap.offerPrice,
            offerPriceValue
          );
        }
      }

      return {
        id: item.id,
        fields,
      };
    });

    const updatedRecords: any[] = [];

    // Airtable allows a maximum of 10 records per batch request.
    for (const recordBatch of chunkRecords(records, 10)) {
      const response = await fetch(
        airtableUrl(
          updateBaseId,
          orderEntryTable
        ),
        {
          method: "PATCH",
          headers: airtableHeaders(airtable.token),
          cache: "no-store",
          body: JSON.stringify({
            records: recordBatch,
            typecast: false,
          }),
        }
      );

      const responseText = await response.text();

      let data: any = null;

      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }

      console.log("Order Items Update Response:", data);

      if (!response.ok) {
        console.log("Order Items Update Sent Records:", recordBatch);
        console.log("Order Items Update Error:", data);

        return NextResponse.json(
          {
            success: false,
            message:
              data?.error?.message ||
              data?.error?.error?.message ||
              "Order items update failed",
            error: data,
          },
          { status: response.status }
        );
      }

      updatedRecords.push(...(data?.records || []));
    }

    const invoiceTableName =
      orderEntryTable === "DQ Order Entry"
        ? "DQ Invoice"
        : airtable.tables.invoice || "BS Invoice";

    let instockSync: unknown = null;

    try {
      const invoiceIds =
        await resolveInvoiceIdsForOrderEntryRecords({
          baseId: updateBaseId,
          token: airtable.token,
          orderEntryTableName: orderEntryTable,
          invoiceTableName,
          recordIds: items.map((item: any) =>
            String(item.id || "")
          ),
        });

      instockSync = await syncInvoiceInstockStatuses({
        baseId: airtable.baseId,
        token: airtable.token,
        orderEntryTableName: orderEntryTable,
        invoiceTableName,
        invoiceIds,
      });
    } catch (syncError) {
      console.error("Invoice Instock sync after item update failed:", syncError);
      instockSync = {
        success: false,
        message:
          syncError instanceof Error
            ? syncError.message
            : "Invoice Instock sync failed",
      };
    }

    return NextResponse.json({
      success: true,
      tableName: orderEntryTable,
      updatedFields: {
        quantity: fieldMap.quantity?.name || null,
        supplier: fieldMap.supplier?.name || null,
        receivedWh: fieldMap.receivedWh?.name || null,
        receivedInUae: fieldMap.receivedInUae?.name || null,
        dispatchToDoha: fieldMap.dispatchToDoha?.name || null,
        dispatchToDohaDateTime: fieldMap.dispatchToDohaDateTime?.name || null,
        inStock: fieldMap.inStock?.name || null,
        billNo: fieldMap.billNo?.name || null,
        size: fieldMap.size?.name || null,
        singlePrice: fieldMap.singlePrice?.name || null,
        packPrice: fieldMap.packPrice?.name || null,
        offerPrice: fieldMap.offerPrice?.name || null,
      },
      records: updatedRecords,
      instockSync,
    });
  } catch (error) {
    console.error("Order Items Update Failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown Error",
      },
      { status: 500 }
    );
  }
}
