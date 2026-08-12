import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  timingSafeEqual,
} from "node:crypto";
import { getSession } from "@/lib/auth";
import {
  processBatchQueue,
} from "@/lib/facebook-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SessionLike = {
  role?: string;
  superAdmin?: boolean;
};

function safeSecretMatch(
  received: string,
  expected: string
) {
  const receivedBuffer =
    Buffer.from(received);
  const expectedBuffer =
    Buffer.from(expected);

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

function isAllowedRole(
  session: SessionLike | null
) {
  if (!session) {
    return false;
  }

  const role =
    String(
      session.role || ""
    )
      .trim()
      .toLowerCase();

  return (
    role === "admin" ||
    role === "manager" ||
    role === "employee" ||
    role === "staff" ||
    Boolean(
      session.superAdmin
    )
  );
}

async function authorizeProcessor(
  request: NextRequest
) {
  const expectedSecret =
    String(
      process.env
        .FACEBOOK_BATCH_WORKER_SECRET ||
        ""
    ).trim();

  const receivedSecret =
    String(
      request.headers.get(
        "x-facebook-batch-secret"
      ) || ""
    ).trim();

  if (
    expectedSecret &&
    receivedSecret &&
    safeSecretMatch(
      receivedSecret,
      expectedSecret
    )
  ) {
    return true;
  }

  const session =
    await getSession() as
      | SessionLike
      | null;

  return isAllowedRole(
    session
  );
}

function jsonError(
  message: string,
  status = 400
) {
  return NextResponse.json(
    {
      success: false,
      message,
    },
    {
      status,
    }
  );
}

export async function GET(
  request: NextRequest
) {
  if (
    !await authorizeProcessor(
      request
    )
  ) {
    return jsonError(
      "Batch processor unauthorized.",
      401
    );
  }

  return NextResponse.json({
    success: true,
    message:
      "Facebook Batch processor ready hai.",
    workerSecretConfigured:
      Boolean(
        process.env
          .FACEBOOK_BATCH_WORKER_SECRET
      ),
  });
}

export async function POST(
  request: NextRequest
) {
  try {
    if (
      !await authorizeProcessor(
        request
      )
    ) {
      return jsonError(
        "Batch processor unauthorized.",
        401
      );
    }

    const body =
      await request
        .json()
        .catch(() => ({}));

    const limit =
      Math.min(
        Math.max(
          Number(
            body.limit || 1
          ) || 1,
          1
        ),
        3
      );

    const result =
      await processBatchQueue(
        limit
      );

    return NextResponse.json({
      success: true,
      message:
        result.busy
          ? "Processor pehle se running hai."
          : `${result.processed} job(s) process hue.`,
      ...result,
    });
  } catch (error) {
    console.error(
      "Facebook Batch processor failed:",
      error
    );

    return jsonError(
      error instanceof Error
        ? error.message
        : "Facebook Batch processor failed.",
      500
    );
  }
}
