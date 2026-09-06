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


function cleanText(value:any){

  if(Array.isArray(value)){
    return String(value[0] || "").trim();
  }

  return String(value || "").trim();

}



function isYes(value:any){

  return [
    "yes",
    "true",
    "1",
  ].includes(
    cleanText(value).toLowerCase()
  );

}



function formatDate(value:string){

  if(!value)
    return "";


  return value;

}
async function fetchRecords(token:string){

  const params = new URLSearchParams();


  [
    "Order Number",
    "Item Code",
    "Supplier",
    "quantity",
    "Dispatch To Doha",
    "Dispatch To Doha DateTime",
    "Doha Received",
    "Doha Received DateTime",
  ].forEach((field)=>{

    params.append(
      "fields[]",
      field
    );

  });


  params.set(
    "pageSize",
    "100"
  );



  const response = await fetch(

    airtableUrl(
      SOURCE.baseId,
      SOURCE.tableName,
      params
    ),

    {
      headers:
        airtableHeaders(token),

      cache:"no-store",
    }

  );



  const data =
    await response.json();



  if(!response.ok){

    throw new Error(
      data?.error?.message ||
      "Unable to fetch records"
    );

  }



  return (data.records || [])
    .map((record:any)=>{


      const fields =
        record.fields || {};



      return {

        id:
          record.id,


        orderNo:
          cleanText(
            fields["Order Number"]
          ),


        sku:
          cleanText(
            fields["Item Code"]
          ),


        supplier:
          cleanText(
            fields["Supplier"]
          ),


        qty:
          Number(
            fields["quantity"] || 0
          ),


        dispatchDate:
          fields["Dispatch To Doha DateTime"] || "",


        dispatchToDoha:
          cleanText(
            fields["Dispatch To Doha"]
          ),


        dohaReceived:
          cleanText(
            fields["Doha Received"]
          ),


      };


    })

    .filter((item:any)=>

      item.dispatchToDoha
        .toLowerCase() === "dispatched"

      &&

      !isYes(item.dohaReceived)

    );

}
export async function GET(){

  try{


    const {
      token
    } = await getCurrentAirtableBase();



    const rows =
      await fetchRecords(token);



    const grouped:any = {};



    rows.forEach((item:any)=>{


      const date =
        item.dispatchDate
        ? new Date(
            item.dispatchDate
          )
          .toISOString()
          .split("T")[0]
        : "No Date";



      if(!grouped[date]){

        grouped[date] = [];

      }


      grouped[date].push(item);


    });



    const groups =
      Object.keys(grouped)
      .sort(
        (a,b)=>
          new Date(b).getTime()
          -
          new Date(a).getTime()
      )
      .map((date)=>({

        date,

        items:
          grouped[date],

      }));



    return NextResponse.json({

      success:true,

      groups,

      total:
        rows.length,

    });



  }catch(error){


    return handleApiError(
      error
    );


  }

}
