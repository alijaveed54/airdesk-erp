import { NextResponse } from "next/server";
import { processBatchQueue } from "@/lib/facebook-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;


export async function GET(){

  try{

    const result =
      await processBatchQueue(3);


    return NextResponse.json({

      success:true,

      message:
        result.busy
          ? "Already running"
          : `${result.processed} jobs processed`,

      ...result

    });


  }
  catch(error){

    console.error(
      "Facebook cron failed:",
      error
    );


    return NextResponse.json(
      {
        success:false,
        message:"Facebook cron failed"
      },
      {
        status:500
      }
    );

  }

}