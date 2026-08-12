import {
  getCurrentAirtableBase,
  airtableFetch,
  apiError,
  apiSuccess,
  handleApiError,
} from "@/lib/airtable";

import { NextRequest } from "next/server";


// Airtable Fields
const RECEIVED_QUEUE_FIELD = "Received Que";
const RECEIVED_UAE_FIELD = "Received In UAE";
const RECEIVED_UAE_DATE_FIELD = "Received In UAE DateTime";

const SUPPLIER_FIELD = "Supplier";
const BILL_FIELD = "bill_no";


// Multi Base Tables
const RECEIVING_TABLES = [
  {
    name: "BS Order Entry",
    key: "BS",
    baseId: "app2hjpuQoeEL1Rn2",
  },
  {
    name: "FAB Order Entry",
    key: "FAB",
    baseId: "appiz6tozkQO2TQXt",
  },
];


// Permission Check
async function checkAccess() {

  const airtable = await getCurrentAirtableBase();

  if (
    !airtable.canReceive &&
    !airtable.canEdit &&
    !airtable.canReports
  ) {
    throw {
      status: 403,
      message: "You do not have permission for UAE Receiving",
    };
  }

  return airtable;
}



// Fetch Airtable Records
async function getRecords(
  baseId: string,
  token: string,
  table: string,
  formula?: string
) {

  const params = new URLSearchParams();

  params.set(
    "pageSize",
    "100"
  );


  if (formula) {
    params.set(
      "filterByFormula",
      formula
    );
  }


  return airtableFetch({

    baseId,

    token,

    table,

    params,

  });

}



// Update Airtable Records
async function updateRecords(
  baseId: string,
  token: string,
  table: string,
  records: any[]
) {


  if (!records.length) return;


  const batchSize = 25;


  for(
    let i = 0;
    i < records.length;
    i += batchSize
  ){


    const batch =
      records.slice(
        i,
        i + batchSize
      );


    await airtableFetch({

      baseId,

      token,

      table,

      method:"PATCH",

      fields:{
        records: batch,
      },

    });


  }


}
{

}



// Group records by source
function groupRecordsBySource(recordIds:string[]) {

  const grouped:any = {};

  recordIds.forEach((id)=>{

    const [source, recordId] = id.split(":");


    if(!grouped[source]){
      grouped[source] = [];
    }


    grouped[source].push(recordId);

  });


  return grouped;

}
export async function GET(
  request: NextRequest
) {

  try {

    const airtable = await checkAccess();

    const tables = RECEIVING_TABLES;


    const { searchParams } =
      new URL(request.url);


    const action =
      searchParams.get("action");



    // LOAD SUPPLIERS
    if (action === "suppliers") {

      const suppliers = new Set<string>();


      for (const itemTable of tables) {


        const data = await getRecords(
          itemTable.baseId,
          airtable.token,
          itemTable.name,
          `{${RECEIVED_QUEUE_FIELD}}="Yes"`
        );


        (data.records || []).forEach(
          (record:any)=>{

            const supplier =
              record.fields?.[SUPPLIER_FIELD];


            if(supplier){
              suppliers.add(supplier);
            }

          }
        );


      }


      return apiSuccess({

        suppliers:
          Array.from(suppliers).map(
            (name)=>({
              name,
            })
          ),

      });

    }





    // LOAD BILLS
    if(action === "bills") {


      const supplier =
        searchParams.get("supplier");


      if(!supplier){

        return apiError(
          "Supplier is required",
          400
        );

      }


      const billsMap = new Map();



      for(const itemTable of tables){


        const data = await getRecords(
          itemTable.baseId,
          airtable.token,
          itemTable.name,
          `{${SUPPLIER_FIELD}}="${supplier}"`
        );



        (data.records || []).forEach(
          (record:any)=>{


            const billNo =
              String(
                record.fields?.[BILL_FIELD] || ""
              ).trim();



            if(/^\d{8}$/.test(billNo)){


              if(!billsMap.has(billNo)){
                billsMap.set(
                  billNo,
                  0
                );
              }


              billsMap.set(
                billNo,
                billsMap.get(billNo)+1
              );

            }


          }
        );


      }



      return apiSuccess({

        bills:
          Array.from(
            billsMap.entries()
          )
          .map(
            ([billNo,count])=>({
              billNo,
              count,
              supplier,
            })
          ),

      });


    }






    // LOAD RECEIVING QUEUE ITEMS

    const allItems:any[] = [];



    for(const itemTable of tables){


      const data = await getRecords(
        itemTable.baseId,
        airtable.token,
        itemTable.name,
        `{${RECEIVED_QUEUE_FIELD}}="Yes"`
      );



      allItems.push(

        ...(data.records || []).map(
          (record:any)=>({

            id:
              `${itemTable.key}:${record.id}`,

            recordId:
              record.id,

            source:
              itemTable.key,

            table:
              itemTable.name,

            fields:
              record.fields,

          })
        )

      );


    }



    return apiSuccess({

      items: allItems,

    });



  } catch(error){


    return handleApiError(
      error,
      "Unable to load UAE receiving data"
    );


  }

}
export async function POST(
  request: NextRequest
) {

  try {


    const airtable =
      await checkAccess();


    const body =
      await request.json();


    const action =
      body?.action;



    const tables =
      RECEIVING_TABLES;



    if(!action){

      return apiError(
        "Action is required",
        400
      );

    }




    // ADD BILL TO QUEUE

    if(action === "addQueue"){


      const supplier =
        body.supplier;


      const billNos =
        body.billNos || [];



      if(!supplier || !billNos.length){

        return apiError(
          "Supplier and bills required",
          400
        );

      }



      for(const itemTable of tables){


        const formula =
          `AND({${SUPPLIER_FIELD}}="${supplier}",` +
          `OR(${billNos.map(
            (bill:string)=>
              `{${BILL_FIELD}}="${bill}"`
          ).join(",")}))`;



        const data =
          await getRecords(
            itemTable.baseId,
            airtable.token,
            itemTable.name,
            formula
          );



        const records =
          (data.records || [])
          .map((record:any)=>({

            id:record.id,

            fields:{

              [RECEIVED_QUEUE_FIELD]:
                "Yes",

            }

          }));



        await updateRecords(
          itemTable.baseId,
          airtable.token,
          itemTable.name,
          records
        );


      }



      return apiSuccess({

        message:
          "Bills added to UAE receiving queue",

      });


    }







    // REMOVE FROM QUEUE

    if(action === "removeQueue") {


  const recordIds =
    body.recordIds || [];



  if(!recordIds.length){

    return apiError(
      "No records selected",
      400
    );

  }



  const grouped =
    groupRecordsBySource(recordIds);



  for(const itemTable of tables){


    const ids =
      grouped[itemTable.key] || [];



    const records =
      ids.map((id:string)=>({


        id,


        fields:{


          [RECEIVED_QUEUE_FIELD]:
            null,


          [RECEIVED_UAE_FIELD]:
            null,


          [RECEIVED_UAE_DATE_FIELD]:
            null,


        }


      }));




    await updateRecords(

      itemTable.baseId,

      airtable.token,

      itemTable.name,

      records

    );


  }





  return apiSuccess({

    message:
      "Items removed from UAE receiving queue",

  });


}
    
    // RECEIVE ITEMS

    if(action === "receive"){


      const recordIds =
        body.recordIds || [];



      if(!recordIds.length){

        return apiError(
          "No records selected",
          400
        );

      }



      const grouped =
        groupRecordsBySource(recordIds);



      const now =
        new Date().toISOString();



      for(const itemTable of tables){


        const ids =
          grouped[itemTable.key] || [];



        const records =
          ids.map((id:string)=>({

            id,

            fields:{

              [RECEIVED_UAE_FIELD]:
                "Yes",


              [RECEIVED_UAE_DATE_FIELD]:
                now,


              [RECEIVED_QUEUE_FIELD]:
                null,

            }

          }));



        await updateRecords(
          itemTable.baseId,
          airtable.token,
          itemTable.name,
          records
        );


      }



      return apiSuccess({

        message:
          "Items received in UAE successfully",

      });


    }






    return apiError(
      "Invalid action",
      400
    );



  } catch(error){


    return handleApiError(

      error,

      "UAE receiving update failed"

    );


  }


}