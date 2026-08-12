import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES_PER_REQUEST = 100;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MARKET_BY_CURRENCY: Record<
  string,
  { market: string; folder: string }
> = {
  AED: { market: "UAE", folder: "UAE" },
  QAR: { market: "Qatar", folder: "Qatar" },
  MUR: { market: "Mauritius", folder: "Mauritius" },
  SAR: { market: "Saudi Arabia", folder: "Saudi-Arabia" },
  OMR: { market: "Oman", folder: "Oman" },
  KWD: { market: "Kuwait", folder: "Kuwait" },
  BHD: { market: "Bahrain", folder: "Bahrain" },
  USD: { market: "International", folder: "International" },
};

type ParsedImageName = {
  sku: string;
  currency: string;
  market: string;
  marketFolder: string;
  sequence: string;
  extension: string;
  originalName: string;
};

function getR2Config() {
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
      "R2 environment variables are missing. Check Vercel Production Environment Variables."
    );
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl: publicUrl.replace(/\/$/, ""),
  };
}

function createR2Client(config: ReturnType<typeof getR2Config>) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function sanitizePathPart(value: string) {
  return value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function parseImageName(fileName: string): ParsedImageName {
  const extensionMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
  const extension = (extensionMatch?.[1] || "jpg").toLowerCase();
  const withoutExtension = fileName.replace(/\.[^.]+$/, "").trim();

  const currencyMatch = withoutExtension.match(
    /\b(AED|QAR|MUR|SAR|OMR|KWD|BHD|USD)\b/i
  );
  const currency = currencyMatch?.[1]?.toUpperCase() || "UNSORTED";
  const marketInfo = MARKET_BY_CURRENCY[currency] || {
    market: "Unsorted",
    folder: "Unsorted",
  };

  const beforeCurrency = currencyMatch
    ? withoutExtension.slice(0, currencyMatch.index).trim()
    : withoutExtension;

  const skuToken =
    beforeCurrency.match(/[a-zA-Z]+[a-zA-Z0-9_-]*\d+[a-zA-Z0-9_-]*/)?.[0] ||
    beforeCurrency.split(/\s+/)[0] ||
    "UNSORTED";

  const sku = sanitizePathPart(skuToken).toUpperCase() || "UNSORTED";

  const sequenceMatch =
    withoutExtension.match(/\((\d+)\)\s*$/) ||
    withoutExtension.match(/(?:^|[\s_-])(\d+)\s*$/);

  const sequence = sequenceMatch?.[1]
    ? String(Number(sequenceMatch[1])).padStart(3, "0")
    : "";

  return {
    sku,
    currency,
    market: marketInfo.market,
    marketFolder: marketInfo.folder,
    sequence,
    extension,
    originalName: fileName,
  };
}

async function objectExists(
  client: S3Client,
  bucketName: string,
  key: string
) {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );

    return true;
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;

    if (status === 404 || error?.name === "NotFound") {
      return false;
    }

    throw error;
  }
}

async function createUniqueKey({
  client,
  bucketName,
  parsed,
}: {
  client: S3Client;
  bucketName: string;
  parsed: ParsedImageName;
}) {
  const folder = `products/${parsed.sku}/${parsed.marketFolder}`;
  const preferredBase =
    parsed.sequence || `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  let attempt = 0;

  while (attempt < 1000) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const key = `${folder}/${preferredBase}${suffix}.${parsed.extension}`;

    if (!(await objectExists(client, bucketName, key))) {
      return key;
    }

    attempt += 1;
  }

  throw new Error(`Unable to create a unique filename for ${parsed.originalName}`);
}

function collectFiles(formData: FormData) {
  const candidates = [
    ...formData.getAll("files"),
    ...formData.getAll("file"),
  ];

  return candidates.filter(
    (value): value is File => value instanceof File && value.size > 0
  );
}

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    const permission = session.selectedBase || session.permissions?.[0];
    const canUpload =
      session.role === "Admin" ||
      Boolean(session.superAdmin) ||
      Boolean(permission?.canInventory) ||
      Boolean(permission?.canEdit);

    if (!canUpload) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to upload product images",
        },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const files = collectFiles(formData);

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, message: "At least one image file is required" },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        {
          success: false,
          message: `Maximum ${MAX_FILES_PER_REQUEST} images are allowed per upload`,
        },
        { status: 400 }
      );
    }

    const config = getR2Config();
    const client = createR2Client(config);

    const uploaded: Array<{
      originalName: string;
      sku: string;
      currency: string;
      market: string;
      key: string;
      url: string;
      size: number;
      contentType: string;
    }> = [];

    const failed: Array<{
      originalName: string;
      message: string;
    }> = [];

    for (const file of files) {
      try {
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
          throw new Error("Only JPG, PNG, WEBP and GIF images are allowed");
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new Error("Image size cannot exceed 15 MB");
        }

        const parsed = parseImageName(file.name);
        const key = await createUniqueKey({
          client,
          bucketName: config.bucketName,
          parsed,
        });

        const buffer = Buffer.from(await file.arrayBuffer());

        await client.send(
          new PutObjectCommand({
            Bucket: config.bucketName,
            Key: key,
            Body: buffer,
            ContentType: file.type || "image/jpeg",
            CacheControl: "public, max-age=31536000, immutable",
            Metadata: {
              sku: parsed.sku,
              currency: parsed.currency,
              market: parsed.market,
              originalname: encodeURIComponent(parsed.originalName),
              uploadedby: session.username,
              uploadedat: new Date().toISOString(),
            },
          })
        );

        uploaded.push({
          originalName: parsed.originalName,
          sku: parsed.sku,
          currency: parsed.currency,
          market: parsed.market,
          key,
          url: `${config.publicUrl}/${key}`,
          size: file.size,
          contentType: file.type,
        });
      } catch (error) {
        failed.push({
          originalName: file.name,
          message:
            error instanceof Error ? error.message : "Image upload failed",
        });
      }
    }

    const skuSummary = Array.from(
      uploaded.reduce((map, item) => {
        const summaryKey = `${item.sku}:${item.market}`;
        const current = map.get(summaryKey) || {
          sku: item.sku,
          currency: item.currency,
          market: item.market,
          uploaded: 0,
          folder: item.key.split("/").slice(0, -1).join("/"),
        };

        current.uploaded += 1;
        map.set(summaryKey, current);
        return map;
      }, new Map<string, {
        sku: string;
        currency: string;
        market: string;
        uploaded: number;
        folder: string;
      }>())
    ).map(([, value]) => value);

    const success = uploaded.length > 0;

    return NextResponse.json(
      {
        success,
        message: success
          ? `${uploaded.length} image(s) uploaded successfully`
          : "No images were uploaded",
        uploadedCount: uploaded.length,
        failedCount: failed.length,
        uploaded,
        failed,
        skuSummary,
        // Backward compatibility for existing single-image forms.
        url: uploaded[0]?.url || "",
        key: uploaded[0]?.key || "",
      },
      { status: success ? 200 : 400 }
    );
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
