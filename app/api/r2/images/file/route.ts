import {
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type KnownError = {
  status?: number;
  message?: string;
};

function getConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucketName
  ) {
    throw {
      status: 500,
      message:
        "R2 environment variables are missing",
    };
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
  };
}

function getClient(
  config: ReturnType<typeof getConfig>,
) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey:
        config.secretAccessKey,
    },
  });
}

function safeFileName(key: string) {
  return (
    key.split("/").at(-1) || "image.jpg"
  ).replace(/["\r\n]/g, "");
}

export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Not authenticated",
        },
        { status: 401 },
      );
    }

    const requestUrl = new URL(request.url);
    const key = String(
      requestUrl.searchParams.get("key") || "",
    ).trim();

    if (
      !key ||
      !key.startsWith("products/") ||
      key.includes("..") ||
      key.includes("\\")
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid R2 image key",
        },
        { status: 400 },
      );
    }

    const config = getConfig();
    const client = getClient(config);

    const object = await client.send(
      new GetObjectCommand({
        Bucket: config.bucketName,
        Key: key,
      }),
    );

    const contentLength = Number(
      object.ContentLength || 0,
    );

    if (
      contentLength > MAX_IMAGE_BYTES
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "This R2 image is larger than 25 MB",
        },
        { status: 413 },
      );
    }

    if (!object.Body) {
      throw {
        status: 404,
        message: "R2 image body was empty",
      };
    }

    const bytes =
      await object.Body.transformToByteArray();

    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          message:
            "This R2 image is larger than 25 MB",
        },
        { status: 413 },
      );
    }

    // AWS SDK returns Uint8Array<ArrayBufferLike>. Next.js 16's
    // Response BodyInit typing requires a plain ArrayBuffer-backed body.
    const responseBytes = new Uint8Array(
      bytes.byteLength,
    );
    responseBytes.set(bytes);

    return new Response(responseBytes.buffer, {
      status: 200,
      headers: {
        "Content-Type":
          object.ContentType ||
          "application/octet-stream",
        "Content-Length": String(
          bytes.byteLength,
        ),
        "Content-Disposition": `inline; filename="${safeFileName(
          key,
        )}"`,
        "Cache-Control":
          "private, max-age=300",
      },
    });
  } catch (error) {
    const known = error as KnownError;

    return NextResponse.json(
      {
        success: false,
        message:
          known?.message ||
          "R2 image download failed",
      },
      {
        status: known?.status || 500,
      },
    );
  }
}
