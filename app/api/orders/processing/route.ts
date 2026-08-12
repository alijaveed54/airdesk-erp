import { NextResponse } from "next/server";
import {
  airtablePaginatedFetch,
  getCurrentAirtableBase,
  handleApiError,
} from "@/lib/airtable";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


const INVOICE_TABLE = "BS Invoice";
const ORDER_TABLE = "BS Order Entry";


function value(v:any){

  if(Array.isArray(v)){
    return v[0] || "";
  }

  return v || "";

}



export async function GET(){

  try{


    const session = await getSession();

    if(!session){

      return NextResponse.json(
        {
          success:false,
          message:"Unauthorized"
        },
        {
          status:401
        }
      );

    }



    const airtable =
      await getCurrentAirtableBase();



    // 1. Get Processing = Yes invoices

    const invoiceParams =
      new URLSearchParams();


    invoiceParams.set(
      "filterByFormula",
      "{Processing}='Yes'"
    );


    invoiceParams.append(
      "fields[]",
      "order_no."
    );



    const invoices =
      await airtablePaginatedFetch({

        baseId:airtable.baseId,

        token:airtable.token,

        table:INVOICE_TABLE,

        params:invoiceParams

      });


console.log(
  "INVOICE COUNT:",
  invoices.length
);

console.log(
  "INVOICE SAMPLE:",
  JSON.stringify(
    invoices[0],
    null,
    2
  )
);


    if(!invoices.length){

      return NextResponse.json({

        success:true,

        orders:{}

      });

    }





    // linked invoice record IDs

    const invoiceIds =
  invoices.map(
    (r:any)=>r.id
  );

const invoiceMap:any = {};

invoices.forEach((inv:any)=>{

  invoiceMap[inv.id] =
    inv.fields["order_no."];

});




    if(!invoiceIds.length){

      return NextResponse.json({

        success:true,

        orders:{}

      });

    }







    // 2. Get BS Order Entry

    const orderParams =
      new URLSearchParams();


    orderParams.set(
      "pageSize",
      "100"
    );


    orderParams.append(
      "fields[]",
      "Item Code"
    );

    orderParams.append(
      "fields[]",
      "image"
    );

    orderParams.append(
      "fields[]",
      "Supplier"
    );

    orderParams.append(
      "fields[]",
      "quantity"
    );

    orderParams.append(
      "fields[]",
      "bill_no"
    );

    orderParams.append(
      "fields[]",
      "Received In UAE DateTime"
    );

    orderParams.append(
      "fields[]",
      "order no."
    );





    const orderRecords =
      await airtablePaginatedFetch({

        baseId:airtable.baseId,

        token:airtable.token,

        table:ORDER_TABLE,

        params:orderParams

      });

console.log(
  "ORDER ENTRY COUNT:",
  orderRecords.length
);

console.log(
  "ORDER SAMPLE:",
  JSON.stringify(
    orderRecords[0],
    null,
    2
  )
);




    const grouped:any = {};





    orderRecords.forEach(
      (record:any)=>{


        const fields =
          record.fields || {};



        const links =
          fields["order no."]
          || [];



        const matched =
          links.some(
            (id:string)=>
              invoiceIds.includes(id)
          );



        if(!matched) return;





        const matchedInvoice =
  invoices.find(
    (inv:any)=>
      links.includes(inv.id)
  );

const orderId =
  matchedInvoice?.fields?.["order_no."]
  || "Unknown";



        if(!grouped[orderId]){

          grouped[orderId]=[];

        }





        grouped[orderId].push({

          id:record.id,

          image:
            fields["image"] || [],

          itemCode:
            value(fields["Item Code"]),

          supplier:
            value(fields["Supplier"]),

          quantity:
            value(fields["quantity"]),

          billNo:
            value(fields["bill_no"]),

          receivedDate:
            value(fields["Received In UAE DateTime"])

        });



      }
    );







    return NextResponse.json({

      success:true,

      orders:grouped

    });





  }
  catch(error){

    return handleApiError(
      error,
      "Processing orders failed"
    );

  }

}
export async function POST(req:Request){

  try{

    const body = await req.json();

    const orderNo = body.orderNo;


    if(!orderNo){

      return NextResponse.json({
        success:false,
        message:"Order number missing"
      });

    }


    const airtable =
      await getCurrentAirtableBase();



    const params = new URLSearchParams();

    params.set(
      "filterByFormula",
      `{order_no.}="${orderNo}"`
    );


    const records =
      await airtablePaginatedFetch({

        baseId:airtable.baseId,

        token:airtable.token,

        table:INVOICE_TABLE,

        params

      });



    if(!records.length){

      return NextResponse.json({

        success:false,

        message:"Invoice not found"

      });

    }



    const response = await fetch(
      `https://api.airtable.com/v0/${airtable.baseId}/${encodeURIComponent(INVOICE_TABLE)}`,
      {

        method:"PATCH",

        headers:{

          Authorization:`Bearer ${airtable.token}`,

          "Content-Type":"application/json"

        },

        body:JSON.stringify({

          records:records.map((r:any)=>({

            id:r.id,

            fields:{

              Processing:null

            }

          }))

        })

      }
    );



    const result = await response.json();



    return NextResponse.json({

      success:true,

      result

    });



  }
  catch(error){

    return handleApiError(
      error,
      "Processing update failed"
    );

  }

}