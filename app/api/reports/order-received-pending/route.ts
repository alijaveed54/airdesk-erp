import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";


type AirtableRecord = {
  id: string;
  fields: Record<string, any>;
};


type OrderItem = {
  itemCode: string;
  itemDetail: string;
  quantity: number;
  supplier: string;
  billNo: string;
  receivedWH: string;
  receivedUAE: string;
};


type OrderGroup = {
  orderNo: string;
  customer: string;
  date: string;
  items: OrderItem[];
};


function text(value: any): string {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    return value.map((v) => text(v)).join(", ");
  }

  if (typeof value === "object") {
    return String(
      value.name ??
      value.value ??
      ""
    );
  }

  return String(value);
}


function number(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}


function normalizeDate(value: string) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${String(date.getDate()).padStart(2, "0")}${String(
    date.getMonth() + 1
  ).padStart(2, "0")}${date.getFullYear()}`;
}


function isDateBill(value: string) {
  return /^\d{8}$/.test(value);
}


function isYes(value: any) {
  const v = text(value)
    .trim()
    .toLowerCase();

  return (
    v === "yes" ||
    v === "true" ||
    v === "1" ||
    v === "checked"
  );
}


function getReason(item: OrderItem) {

  const billNo = item.billNo
    .trim();

  const wh =
    isYes(item.receivedWH);

  const uae =
    isYes(item.receivedUAE);


  // Rule 1
  if (!billNo && !wh) {
    return "Supplier has not dispatched yet";
  }


  // Rule 2
  if (!billNo && wh) {
    return "Item Instock";
  }


  // Rule 3
  if (
    billNo.toLowerCase() === "stock out" &&
    wh
  ) {
    return "Item Stock Out";
  }


  // Rule 4
  if (
    isDateBill(billNo) &&
    wh &&
    !uae
  ) {
    return `Supplier Dispatched on ${billNo} — UAE not yet received`;
  }


  // Rule 5
  if (
    isDateBill(billNo) &&
    wh &&
    uae
  ) {
    return `Item received in UAE`;
  }


  return "Processing pending";
}
// ===============================
// Airtable Schema Helpers
// ===============================

async function getTableSchema(
  airtable: any,
  tableName: string
) {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${airtable.baseId}/tables`,
    {
      headers: {
        Authorization: `Bearer ${airtable.token}`,
      },
      cache: "no-store",
    }
  );


  const data = await response.json();


  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Unable to fetch Airtable schema"
    );
  }


  const table = data.tables.find(
    (t: any) =>
      t.name === tableName
  );


  if (!table) {
    throw new Error(
      `${tableName} table not found`
    );
  }


  return table;
}



function findField(
  fields: any[],
  names: string[]
) {

  const map = new Map(
    fields.map((field) => [
      field.name
        .trim()
        .toLowerCase(),
      field.name,
    ])
  );


  for (const name of names) {

    const found =
      map.get(
        name
          .trim()
          .toLowerCase()
      );


    if (found) {
      return found;
    }
  }


  return "";
}



// ===============================
// Airtable Records Fetch
// ===============================

async function fetchOrderRecords(
  airtable: any,
  tableName: string,
  fields: string[]
) {

  const records: AirtableRecord[] = [];

  let offset = "";


  do {

    const params =
      new URLSearchParams();


    params.set(
      "pageSize",
      "100"
    );


 params.set(
  "filterByFormula",
  "FIND('Order Received',{Order_status})"
);

    fields.forEach(
      (field) =>
        params.append(
          "fields[]",
          field
        )
    );


    if (offset) {
      params.set(
        "offset",
        offset
      );
    }


    const response =
      await fetch(
        airtableUrl(
          airtable.baseId,
          tableName,
          params
        ),
        {
          headers:
            airtableHeaders(
              airtable.token
            ),
          cache:
            "no-store",
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data?.error?.message ||
        "Airtable fetch failed"
      );
    }


    records.push(
      ...(data.records || [])
    );


    offset =
      data.offset || "";


  } while(offset);


  return records;
}



// ===============================
// Group Orders With Multiple Items
// ===============================

function groupOrders(
  records: AirtableRecord[],
  fields: any
) {

  const orders =
    new Map<string, OrderGroup>();


  for (const record of records) {

    const f =
      record.fields;


    const orderNo =
  text(
    f[fields.orderNo]
  ).trim();

if (!orderNo) {
  continue;
}


    const item: OrderItem = {

  itemCode:
    text(
      f[fields.itemCode]
    ),

  itemDetail:
    text(
      f[fields.itemDetail]
    ),

  quantity:
    number(
      f[fields.quantity]
    ),

  supplier:
    text(
      f[fields.supplier]
    ),

  billNo:
    text(
      f[fields.billNo]
    ),

  receivedWH:
    text(
      f[fields.receivedWH]
    ),

  receivedUAE:
    text(
      f[fields.receivedUAE]
    ),
};



    if (!orders.has(orderNo)) {

      orders.set(
        orderNo,
        {
          orderNo,
          customer:
            text(
              f[fields.customer]
            ),
          date:
            normalizeDate(
              text(
                f[fields.date]
              )
            ),
          items: [],
        }
      );

    }


    orders
      .get(orderNo)!
      .items
      .push(item);

  }


  return Array.from(
    orders.values()
  );
}
// ===============================
// Create Report Rows
// ===============================

function createReportRows(
  orders: OrderGroup[]
) {

  return orders.map((order) => {

    const itemLines =
  order.items.map((item) => {

    const reason =
      getReason(item);


    const skuText =
      item.itemDetail
        ? `${item.itemCode} | ${item.itemDetail}`
        : item.itemCode;


    return `${skuText}
Status: ${reason}`;

});


    const line =
`${order.orderNo} (${order.customer}) ${order.date}

${itemLines.join("\n\n")}`;



    const copyText =
`${order.orderNo} (${order.customer}) ${order.date}

${order.items
  .map(
    (item) =>
`${item.itemDetail 
 ? `${item.itemCode} | ${item.itemDetail}` 
 : item.itemCode
} - ${getReason(item)}`
  )
  .join("\n")}`;



    return {

      orderNo:
        order.orderNo,

      customer:
        order.customer,

      date:
        order.date,

      items:
        order.items.length,

      reason:
        order.items
          .map(
            (item) =>
              getReason(item)
          )
          .join("\n"),


      copyText,

      line,

    };

  });

} 

  




// ===============================
// Airtable Field Mapping
// ===============================

function getOrderFields(
  table: any
) {

  const fields =
    table.fields || [];


  return {

    orderNo:
  findField(
    fields,
    [
      "Order Number",
      "Order number",
      "order number",
      "Order No.",
      "Order No",
      "order no."
    ]
  ),


    customer:
      findField(
        fields,
        [
          "Customer",
          "Consignee",
          "Consignee Name",
        ]
      ),


    date:
      findField(
        fields,
        [
          "date",
          "Date",
        ]
      ),


    itemCode:
      findField(
        fields,
        [
          "Item Code",
          "SKU",
          "sku",
        ]
      ),

itemDetail:
  findField(
    fields,
    [
      "Color",
      "Colour",
      "Product Description",
      "Product/Service",
    ]
  ),
    quantity:
      findField(
        fields,
        [
          "quantity",
          "Quantity",
          "Qty",
        ]
      ),


    supplier:
      findField(
        fields,
        [
          "Supplier",
        ]
      ),


    billNo:
      findField(
        fields,
        [
          "bill_no",
          "Bill No",
          "Bill No.",
        ]
      ),


    receivedWH:
      findField(
        fields,
        [
          "received_in_wh_1",
          "Received In WH 1",
          "Received in WH 1",
        ]
      ),


    receivedUAE:
      findField(
        fields,
        [
          "Received In UAE",
          "Received in UAE",
        ]
      ),

  };

}
// ===============================
// API GET
// ===============================

export async function GET() {

  try {


    const airtable =
      await getCurrentAirtableBase();



    const schemaResponse = await fetch(
      `https://api.airtable.com/v0/meta/bases/${airtable.baseId}/tables`,
      {
        headers: {
          Authorization: `Bearer ${airtable.token}`,
        },
        cache: "no-store",
      }
    );

    const schemaData = await schemaResponse.json();

    const table =
      schemaData.tables.find(
        (t: any) =>
          t.name === "BS Order Entry" ||
          t.name === "BS Invoice" ||
          t.name === "Invoice"
      );

    if (!table) {
      throw new Error(
        "Order Entry / Invoice table not found"
      );
    }

    const tableName = table.name;



    const fieldMap =
      getOrderFields(table);



    const requiredFields =
      [
        fieldMap.orderNo,
        fieldMap.customer,
        fieldMap.date,
        fieldMap.itemCode,
        fieldMap.quantity,
        fieldMap.supplier,
        fieldMap.billNo,
        fieldMap.receivedWH,
        fieldMap.receivedUAE,
      ].filter(Boolean);



    const records =
      await fetchOrderRecords(
        airtable,
        tableName,
        requiredFields
      );



    const orders =
      groupOrders(
        records,
        fieldMap
      );



    const rows =
  createReportRows(
    orders
  ).sort((a, b) => {

    function convertDate(date:string) {

      const day =
        Number(date.substring(0,2));

      const month =
        Number(date.substring(2,4));

      const year =
        Number(date.substring(4,8));


      return new Date(
        year,
        month - 1,
        day
      ).getTime();

    }


    return convertDate(a.date) - convertDate(b.date);

  });



    return NextResponse.json({

      success:
        true,

      rows,

      count:
        rows.length,

    });


  } catch(error:any) {


    return handleApiError(
      error,
      "Order Received Pending Report Failed"
    );


  }

}