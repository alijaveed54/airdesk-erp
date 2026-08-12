import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES_PER_REQUEST = 10;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type SessionLike = {
  role?: string;
  superAdmin?: boolean;
  name?: string;
  email?: string;
};

function getConfig() {
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

  return {
    bucketName,
    publicUrl: publicUrl.replace(/\/$/, ""),
    client: new S3Client({
      region: "auto",
      endpoint:
        `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };
}

async function requireFacebookUser() {
  const session = (await getSession()) as SessionLike | null;

  if (!session) {
    throw { status: 401, message: "Not authenticated" };
  }

  const role = String(session.role || "")
    .trim()
    .toLowerCase();

  const allowed =
    role === "admin" ||
    role === "manager" ||
    role === "staff" ||
    Boolean(session.superAdmin);

  if (!allowed || role === "supplier") {
    throw {
      status: 403,
      message:
        "You do not have permission to upload Facebook images",
    };
  }

  return session;
}

function safeFileName(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  const extension =
    lastDot >= 0
      ? fileName.slice(lastDot + 1).toLowerCase()
      : "jpg";
  const base = (lastDot >= 0
    ? fileName.slice(0, lastDot)
    : fileName
  )
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

  const normalizedExtension =
    extension === "jpeg" ? "jpg" : extension;

  return `${base || "facebook-image"}.${normalizedExtension}`;
}

function monthPath() {
  const now = new Date();

  return [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
  ].join("/");
}

export async function POST(request: Request) {
  try {
    const session = await requireFacebookUser();
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Kam az kam ek image select karein.",
        },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        {
          success: false,
          message: `Maximum ${MAX_FILES_PER_REQUEST} images per upload batch allowed hain.`,
        },
        { status: 400 }
      );
    }

    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            success: false,
            message:
              `${file.name}: only JPG, PNG and WebP images are allowed.`,
          },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            success: false,
            message:
              `${file.name}: maximum image size is 20 MB.`,
          },
          { status: 400 }
        );
      }
    }

    const { client, bucketName, publicUrl } = getConfig();
    const uploadedBy = String(
      session.email || session.name || session.role || "ERP User"
    ).slice(0, 200);

    const uploads = [];

    for (const file of files) {
      const cleanName = safeFileName(file.name);
      const key =
        `facebook-posts/${monthPath()}/` +
        `${crypto.randomUUID()}-${cleanName}`;

      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: Buffer.from(await file.arrayBuffer()),
          ContentType: file.type,
          CacheControl: "public, max-age=31536000, immutable",
          Metadata: {
            source: "mysmar-facebook-post",
            original_file_name: file.name,
            uploaded_by: uploadedBy,
          },
        })
      );

      uploads.push({
        key,
        url: `${publicUrl}/${key}`,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
    }

    return NextResponse.json({
      success: true,
      message:
        `${uploads.length} image(s) Cloudflare R2 par upload ho gayi.`,
      uploads,
    });
  } catch (error) {
    const knownError = error as {
      status?: number;
      message?: string;
    };

    console.error("Facebook media upload failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          knownError?.message || "Facebook image upload failed.",
      },
      { status: knownError?.status || 500 }
    );
  }
}