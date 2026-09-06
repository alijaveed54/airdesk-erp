import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { NextResponse } from "next/server";

function getConfig() {
  const accountId = process.env.R2_ACCOUNT_ID!;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;
  const bucketName = process.env.R2_BUCKET_NAME!;
  const publicUrl = process.env.R2_PUBLIC_URL!;

  return {
    bucketName,
    publicUrl: publicUrl.replace(/\/$/, ""),
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

async function listAllObjects(client: S3Client, bucketName: string) {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: "Stock/",
        ContinuationToken: token,
      }),
    );

    res.Contents?.forEach((x) => {
      if (x.Key) keys.push(x.Key);
    });

    token = res.NextContinuationToken;
  } while (token);

  return keys;
}

function isImage(key: string) {
  return /\.(webp|jpg|jpeg|png)$/i.test(key);
}

async function getMetadata(client: S3Client, bucketName: string, key: string) {
  try {
    const res = await client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );

    return {
      sku: res.Metadata?.sku || "",
      price: Number(res.Metadata?.price || 0),
      currency: res.Metadata?.currency || "AED",
      fabric: res.Metadata?.main_fabric || "",
      size: res.Metadata?.sizes || "",
    };
  } catch {
    return {
      sku: "",
      price: 0,
      currency: "AED",
      fabric: "",
      size: "",
    };
  }
}

async function generateImageIndex() {
  const { client, bucketName, publicUrl } = getConfig();

  const keys = await listAllObjects(client, bucketName);

  const items = [];

  for (const key of keys) {
    if (!isImage(key)) continue;

    const parts = key.split("/");
    if (parts.length < 5) continue;

    const meta = await getMetadata(client, bucketName, key);

    items.push({
      id: crypto.randomUUID(),
      key,
      url: `${publicUrl}/${key}`,
      sku: meta.sku || parts[2],
      price: meta.price,
      currency: meta.currency,
      size: meta.size || parts[1],
      fabric: meta.fabric,
    });
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: "Stock/stock-index.json",
      Body: JSON.stringify(items, null, 2),
      ContentType: "application/json",
      CacheControl: "public, max-age=300",
    }),
  );

  return items.length;
}

export async function GET() {
  try {
    const totalImages = await generateImageIndex();

    return NextResponse.json({
      success: true,
      message: "Image level stock index generated",
      totalImages,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Error",
      },
      { status: 500 },
    );
  }
}
