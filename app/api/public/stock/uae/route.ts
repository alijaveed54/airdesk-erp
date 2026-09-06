import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

function getConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("R2 environment variables are missing");
  }

  return {
    bucketName,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

async function readJsonBody() {
  const { client, bucketName } = getConfig();

  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: "Stock/stock-index.json",
    }),
  );

  const text = await result.Body?.transformToString();

  return text ? JSON.parse(text) : [];
}

export async function GET() {
  try {
    const products = await readJsonBody();

    return NextResponse.json({
      success: true,
      market: "UAE",
      currency: "AED",
      products,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Unable to load UAE stock",
      },
      { status: 500 },
    );
  }
}
