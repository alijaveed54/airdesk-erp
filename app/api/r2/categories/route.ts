import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CATEGORIES = [
  "Saree",
  "Lehenga",
  "Suits",
  "Kurta/Kurti",
  "Co-ord Sets",
  "Dresses",
  "Tops",
  "Bottoms",
  "Western Wear",
  "Ethnic Wear",
  "Modest Wear",
  "Night/Lounge Wear",
  "Outerwear",
  "Accessories",
  "Unstitched",
  "Other",
];

function client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const key = "categories/women-apparel.json";

async function getCategories() {
  try {
    const result = await client().send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      }),
    );

    const text = await result.Body?.transformToString();
    const json = text ? JSON.parse(text) : {};

    return Array.isArray(json.categories)
      ? json.categories
      : DEFAULT_CATEGORIES;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

export async function GET() {
  await getSession();

  return NextResponse.json({
    success: true,
    categories: await getCategories(),
  });
}

export async function POST(request: Request) {
  await getSession();

  const body = await request.json();
  const name = String(body.name || "").trim();

  if (!name) {
    return NextResponse.json(
      { success: false, message: "Category required" },
      { status: 400 },
    );
  }

  const categories = await getCategories();

  if (!categories.includes(name)) {
    categories.push(name);
  }

  await client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: JSON.stringify({ categories }, null, 2),
      ContentType: "application/json",
    }),
  );

  return NextResponse.json({
    success: true,
    categories,
  });
}
