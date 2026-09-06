import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;
const INDEX_KEY = "Stock/stock-index.json";

async function readIndex() {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: INDEX_KEY,
      }),
    );

    const text = await result.Body?.transformToString();
    return text ? JSON.parse(text) : [];
  } catch {
    return [];
  }
}

async function saveIndex(items: any[]) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: INDEX_KEY,
      Body: JSON.stringify(items, null, 2),
      ContentType: "application/json",
      CacheControl: "public, max-age=300",
    }),
  );
}

export async function GET() {
  const items = await readIndex();

  const images = items.flatMap((item: any) =>
    (item.images || []).map((url: string) => ({
  id: item.id,
  key: url.split(".com/")[1] || "",
  url,
  sku: item.sku,
  size: item.size || "",
  price: item.price || "",
  fabric: item.fabric || "",
}))
  );

  return NextResponse.json({ items: images });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, price, size, fabric } = body;

  const items = await readIndex();
  const item = items.find((x: any) => x.id === id);

  if (!item) {
    return NextResponse.json(
      { success: false, message: "Item not found" },
      { status: 404 },
    );
  }

  if (price !== undefined) item.price = Number(price);
  if (size !== undefined) item.size = size;
  if (fabric !== undefined) item.fabric = fabric;

  await saveIndex(items);

  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const { key } = await req.json();

  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );

  const items = await readIndex();

  const updated = items
    .map((item: any) => ({
      ...item,
      images: (item.images || []).filter(
        (url: string) => !url.endsWith(key),
      ),
      balanceStock: (item.images || []).filter(
        (url: string) => !url.endsWith(key),
      ).length,
    }))
    .filter((item: any) => item.images.length > 0);

  await saveIndex(updated);

  return NextResponse.json({ success: true });
}
