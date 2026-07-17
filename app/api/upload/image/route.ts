import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;
const publicUrl = process.env.R2_PUBLIC_URL;
if (
  !accountId ||
  !accessKeyId ||
  !secretAccessKey ||
  !bucketName ||
  !publicUrl
) {
  throw new Error(
    "R2 environment variables are missing. Check .env.local"
  );
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
  accessKeyId,
  secretAccessKey,
},
});

export async function POST(request: Request) {
  try {
    if (!bucketName || !publicUrl) {
      return NextResponse.json(
        {
          success: false,
          message: "R2_BUCKET_NAME or R2_PUBLIC_URL missing in .env.local",
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "Image file is required" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const ext = file.name.split(".").pop() || "jpg";
    const key = `products/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: file.type || "image/jpeg",
      })
    );

    return NextResponse.json({
      success: true,
      url: `${publicUrl.replace(/\/$/, "")}/${key}`,
      key,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 }
    );
  }
}