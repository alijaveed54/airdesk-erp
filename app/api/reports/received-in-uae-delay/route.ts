import { NextResponse } from "next/server";
import {
  airtableHeaders,
  airtableUrl,
  handleApiError,
  getCurrentAirtableBase,
} from "@/lib/airtable";
import { getSession } from "@/lib/auth";


type Source = {
  baseId: string;
  tableName: string;
  sourceName: string;
  fields: {
    orderNo: string;
    itemCode: string;
    quantity: string;
    supplier: string;
    billNo: string;
    receivedInUae: string;
    dispatchField: string;
  };
};


const SOURCES: Source[] = [
  {
    baseId: "app2hjpuQoeEL1Rn2",
    tableName: "BS Order Entry",
    sourceName: "BS",
    fields: {
      orderNo: "Order Number",
      itemCode: "Item Code",
      quantity: "quantity",
      supplier: "Supplier",
      billNo: "bill_no",
      receivedInUae: "Received In UAE",
      dispatchField: "Dispatched",
    },
  },
  {
    baseId: "appiz6tozkQO2TQXt",
    tableName: "FAB Order Entry",
    sourceName: "FAB",
    fields: {
      orderNo: "Order Number",
      itemCode: "Item Code",
      quantity: "quantity",
      supplier: "Supplier",
      billNo: "bill_no",
      receivedInUae: "Received In UAE",
      dispatchField: "supplier_status_(dispatched)",
    },
  },
];


function firstValue(value: unknown) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}


function cleanText(value: unknown) {
  return String(firstValue(value) ?? "").trim();
}


function isYes(value: unknown) {
  const text = cleanText(value).toLowerCase();

  return [
    "yes",
    "true",
    "1",
    "dispatched",
  ].includes(text);
}


/**
 * Bill No format:
 * DDMMYYYY
 *
 * Example:
 * 25082026
 * = 25 Aug 2026
 */
function parseBillDate(
  billNo: string
): Date | null {

  const match = billNo
    .trim()
    .match(
      /^(\d{2})(\d{2})(\d{4})$/
    );


  if (!match) {
    return null;
  }


  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);


  const date = new Date(
    year,
    month,
    day
  );


  if (
    date.getDate() !== day ||
    date.getMonth() !== month ||
    date.getFullYear() !== year
  ) {
    return null;
  }


  return date;
}


function calculateDays(
  oldDate: Date
) {

  const today = new Date();

  const difference =
    today.getTime() -
    oldDate.getTime();


  return Math.floor(
    difference /
    (1000 * 60 * 60 * 24)
  );
}
async function fetchSourceRecords(
  source: Source,
  token: string
) {

  const params = new URLSearchParams();

  params.set(
    "pageSize",
    "100"
  );


  const fields = [
    source.fields.orderNo,
    source.fields.itemCode,
    source.fields.quantity,
    source.fields.supplier,
    source.fields.billNo,
    source.fields.receivedInUae,
    source.fields.dispatchField,
  ];


  fields.forEach((field) => {
    params.append(
      "fields[]",
      field
    );
  });


  const records: any[] = [];

  let offset = "";


  do {

    const requestParams =
      new URLSearchParams(params);


    if (offset) {
      requestParams.set(
        "offset",
        offset
      );
    }


    const response =
      await fetch(
        airtableUrl(
          source.baseId,
          source.tableName,
          requestParams
        ),
        {
          headers:
            airtableHeaders(token),
          cache:
            "no-store",
        }
      );


    const data =
      await response.json();


    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        "Unable to load Airtable records"
      );
    }


    records.push(
      ...(data.records || [])
    );


    offset =
      data.offset || "";


  } while(offset);



  const mappedRows = records
  .map((record)=>{

    const fields =
      record.fields || {};


    const billNo =
      cleanText(
        fields[
          source.fields.billNo
        ]
      );


    const billDate =
      parseBillDate(
        billNo
      );


    if (!billDate) {
      return null;
    }


    const received =
      cleanText(
        fields[
          source.fields.receivedInUae
        ]
      );


    const dispatch =
      cleanText(
        fields[
          source.fields.dispatchField
        ]
      );


    return {

      id: record.id,

      source: source.sourceName,

      supplier:
        cleanText(
          fields[
            source.fields.supplier
          ]
        ),

      billNo,

      billDate:
        billDate.toISOString(),

      daysPending:
        calculateDays(
          billDate
        ),

      orderNo:
        cleanText(
          fields[
            source.fields.orderNo
          ]
        ),

      sku:
        cleanText(
          fields[
            source.fields.itemCode
          ]
        ),

      qty:
        Number(
          firstValue(
            fields[
              source.fields.quantity
            ]
          ) || 0
        ),

      dispatchStatus:
        dispatch,

      receivedInUae:
        received,

    };

  })
  .filter(Boolean);


return mappedRows
  .filter((row: any) => {
    return (
      row.receivedInUae.toLowerCase() !== "yes" &&
      row.daysPending >= 7
    );
  });

}
export async function GET(
  request: Request
) {

  try {

    const session =
      await getSession();


    if (!session) {

      return NextResponse.json(
        {
          success: false,
          message:
            "Not authenticated",
        },
        {
          status: 401,
        }
      );

    }


    // Supplier users should not see this internal report
    const role =
      String(
        session.role || ""
      )
      .toLowerCase();


    if (
      role === "supplier"
    ) {

      return NextResponse.json(
        {
          success: false,
          message:
            "Access denied",
        },
        {
          status: 403,
        }
      );

    }



    const { searchParams } =
      new URL(request.url);


    const supplierFilter =
      String(
        searchParams.get(
          "supplier"
        ) || ""
      )
      .trim()
      .toLowerCase();



    const { token } = await getCurrentAirtableBase();

    if (!token) {
      throw new Error("Airtable token missing");
    }



    const allRows:any[] = [];



    for (
      const source of SOURCES
    ) {

      const rows =
        await fetchSourceRecords(
          source,
          token
        );


      allRows.push(
        ...rows
      );

    }



    let rows =
      allRows;



    if (
      supplierFilter
    ) {

      rows =
        rows.filter(
          (row)=> 
            String(
              row.supplier
            )
            .toLowerCase()
            .includes(
              supplierFilter
            )
        );

    }



    rows.sort(
      (a,b)=>
        b.daysPending -
        a.daysPending
    );



    const suppliers =
      Array.from(
        new Set(
          allRows.map(
            (row)=>
              row.supplier
          )
          .filter(Boolean)
        )
      )
      .sort();



    const summary = {

      totalOrders:
        new Set(
          rows.map(
            row=>
              row.orderNo
          )
        )
        .size,


      totalLines:
        rows.length,


      totalPcs:
        rows.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.qty || 0
            ),
          0
        ),


      totalSuppliers:
        new Set(
          rows.map(
            row=>
              row.supplier
          )
        )
        .size,

    };



    return NextResponse.json({

      success:true,

      rows,

      suppliers,

      summary,

    });



  } catch(error) {


    return handleApiError(
      error
    );


  }

}