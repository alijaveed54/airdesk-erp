import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { after, NextResponse } from "next/server";
import { createProduct, handleApiError } from "@/lib/airtable";

export const runtime = "nodejs";

function getR2Client() {
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
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };
}

async function deleteR2Image(key: string) {
  const cleanKey = String(key || "").trim();

  if (!cleanKey || !cleanKey.startsWith("products/")) {
    throw new Error("Invalid R2 image key");
  }

  const { client, bucketName } = getR2Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: cleanKey,
    }),
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      sku,
      supplierSku,
      supplier,
      cp,
      price,
      imageUrl,
      r2Key,
    } = body;

    const cleanSku = String(sku || "").trim();
    const cleanImageUrl = String(imageUrl || "").trim();
    const cleanR2Key = String(r2Key || "").trim();

    if (!cleanSku) {
      return NextResponse.json(
        {
          success: false,
          message: "SKU is required",
        },
        { status: 400 },
      );
    }

    const record = await createProduct({
      sku: cleanSku,
      supplierSku: String(supplierSku || "").trim(),
      supplier: String(supplier || "").trim(),
      cp: Number(cp) || 0,
      price: Number(price) || Number(cp) || 0,
      imageUrl: cleanImageUrl,
    });

    let cleanupScheduled = false;

    if (cleanR2Key && cleanImageUrl) {
      cleanupScheduled = true;

      after(async () => {
        try {
          // Airtable downloads URL-based attachments asynchronously.
          // Keep the R2 image available long enough for Airtable to ingest it.
          await new Promise((resolve) => setTimeout(resolve, 30_000));
          await deleteR2Image(cleanR2Key);
        } catch (cleanupError) {
          console.error("Product saved, but delayed R2 cleanup failed:", cleanupError);
        }
      });
    }

    return NextResponse.json({
      success: true,
      record,
      cleanupScheduled,
    });
  } catch (error) {
    return handleApiError(error, "Product create failed");
  }
}
