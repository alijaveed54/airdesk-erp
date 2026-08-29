import { NextRequest, NextResponse } from "next/server";
import {
  getPendingFacebookJobs,
  updateFacebookJobStatus,
} from "@/lib/facebook/queue-store";

export const runtime = "nodejs";


export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Facebook worker is alive",
  });
}


export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    const expectedSecret = process.env.FACEBOOK_WORKER_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        {
          success: false,
          message: "Worker secret missing",
        },
        { status: 500 }
      );
    }


    if (authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }


    const jobs = getPendingFacebookJobs(10);


    if (jobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending Facebook jobs",
        processed: 0,
        failed: 0,
      });
    }


    let processed = 0;
    let failed = 0;


    for (const job of jobs) {

      try {

        updateFacebookJobStatus(
          job.id,
          "processing"
        );


        /*
          Future:

          1. Fetch image from R2
          2. Send to Facebook API
          3. Save Facebook Post ID

        */


        // Temporary success simulation

        updateFacebookJobStatus(
          job.id,
          "posted"
        );


        processed++;


      } catch (error) {

        updateFacebookJobStatus(
          job.id,
          "failed",
          error instanceof Error
            ? error.message
            : "Unknown error"
        );


        failed++;

      }
    }


    return NextResponse.json({
      success: true,
      message: "Facebook worker completed",
      processed,
      failed,
    });


  } catch (error) {

    console.error(
      "Facebook worker error:",
      error
    );


    return NextResponse.json(
      {
        success:false,
        message:"Worker failed",
      },
      {
        status:500,
      }
    );
  }
}