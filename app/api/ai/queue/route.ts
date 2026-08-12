import { NextRequest, NextResponse } from "next/server";
import {
  clearCompletedJobs,
  getAIJob,
  getAllAIJobs,
  removeAIJob,
  updateAIJobStatus,
} from "@/lib/ai";

export async function GET(request: NextRequest) {
  const imageKey = request.nextUrl.searchParams.get("imageKey")?.trim();

  if (imageKey) {
    const job = getAIJob(imageKey);

    if (!job) {
      return NextResponse.json(
        {
          success: false,
          error: "AI job not found",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      job,
    });
  }

  const jobs = getAllAIJobs();

  return NextResponse.json({
    success: true,
    summary: {
      total: jobs.length,
      pending: jobs.filter((job) => job.status === "pending").length,
      processing: jobs.filter((job) => job.status === "processing").length,
      completed: jobs.filter((job) => job.status === "completed").length,
      failed: jobs.filter((job) => job.status === "failed").length,
    },
    jobs,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: "retry" | "reset";
      imageKey?: string;
    };

    const imageKey = body.imageKey?.trim();

    if (!imageKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Image key is required",
        },
        { status: 400 },
      );
    }

    const existingJob = getAIJob(imageKey);

    if (!existingJob) {
      return NextResponse.json(
        {
          success: false,
          error: "AI job not found",
        },
        { status: 404 },
      );
    }

    if (body.action === "retry") {
      const job = updateAIJobStatus(imageKey, "pending");

      return NextResponse.json({
        success: true,
        message: "AI job moved back to pending",
        job,
      });
    }

    if (body.action === "reset") {
      removeAIJob(imageKey);

      return NextResponse.json({
        success: true,
        message: "AI job removed from queue",
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: "Supported actions are retry and reset",
      },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected AI queue error",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      imageKey?: string;
      clearCompleted?: boolean;
    };

    if (body.clearCompleted) {
      clearCompletedJobs();

      return NextResponse.json({
        success: true,
        message: "Completed AI jobs cleared",
      });
    }

    const imageKey = body.imageKey?.trim();

    if (!imageKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Image key or clearCompleted flag is required",
        },
        { status: 400 },
      );
    }

    const existingJob = getAIJob(imageKey);

    if (!existingJob) {
      return NextResponse.json(
        {
          success: false,
          error: "AI job not found",
        },
        { status: 404 },
      );
    }

    removeAIJob(imageKey);

    return NextResponse.json({
      success: true,
      message: "AI job removed",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected AI queue delete error",
      },
      { status: 500 },
    );
  }
}
