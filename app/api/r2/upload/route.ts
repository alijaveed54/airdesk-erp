import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseSizes } from "@/lib/sizes";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/webp"]);

type Currency = "AED" | "QAR";
type UploadGroup = Currency | "PENDING";

type ParsedName = {
  sku: string;
  currency: UploadGroup;
  price: string;
  imageNumber: string;
  sizes: string[];
  fabricDetail: string;
  mainFabric: string;
  needsManualInfo: boolean;
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
    throw new Error("R2 environment variables are missing. Check .env.local");
  }

  return {
    bucketName,
    publicUrl: publicUrl.replace(/\/$/, ""),
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

function stripExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

function getMainFabric(fabricDetail: string) {
  const knownFabrics = [
    "Cotton",
    "Silk",
    "Georgette",
    "Organza",
    "Rayon",
    "Viscose",
    "Linen",
    "Chiffon",
    "Crepe",
    "Satin",
    "Velvet",
    "Denim",
    "Polyester",
    "Nylon",
    "Wool",
    "Khadi",
    "Muslin",
    "Jacquard",
  ];

  const found = knownFabrics.find((fabric) =>
    new RegExp(`\\b${fabric}\\b`, "i").test(fabricDetail),
  );

  return found || fabricDetail.trim();
}

function parseFileName(
  fileName: string,
  allowSkuOnly = false,
): ParsedName | null {
  const baseName = stripExtension(fileName).trim();

  const coreMatch = baseName.match(
    /^([A-Za-z0-9_-]+)\s*-\s*(AED|QAR)\s+([0-9]+(?:\.[0-9]+)?)\s*\(([^)]+)\)/i,
  );

  if (coreMatch) {
    const sizeMatch = baseName.match(
      /\bSize\s*-\s*(.+?)(?=\s+Fabric\s*-|$)/i,
    );
    const fabricMatch = baseName.match(/\bFabric\s*-\s*(.+)$/i);

    const fabricDetail = fabricMatch?.[1]?.trim() || "";
    const imageNumber = coreMatch[4].trim().padStart(2, "0");

    return {
      sku: coreMatch[1].toUpperCase(),
      currency: coreMatch[2].toUpperCase() as Currency,
      price: coreMatch[3],
      imageNumber,
      sizes: sizeMatch
        ? (parseSizes(sizeMatch[1]).filter(
            (size) => size !== "FREE SIZE",
          ) as string[])
        : [],
      fabricDetail,
      mainFabric: fabricDetail ? getMainFabric(fabricDetail) : "",
      needsManualInfo: false,
    };
  }

  if (!allowSkuOnly) return null;

  const skuMatch = baseName.match(/^([A-Za-z0-9_-]+)/);
  if (!skuMatch) return null;

  const imageNumberMatch = baseName.match(/\(([^)]+)\)/);

  return {
    sku: skuMatch[1].toUpperCase(),
    currency: "PENDING",
    price: "",
    imageNumber: imageNumberMatch?.[1]?.trim().padStart(2, "0") || "00",
    sizes: [],
    fabricDetail: "",
    mainFabric: "",
    needsManualInfo: true,
  };
}

function safeFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "jpg";
  const base = stripExtension(fileName)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

  return `${base || "image"}.${extension === "jpeg" ? "jpg" : extension}`;
}

export async function POST(request: Request) {
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

    const role = String(session.role || "")
      .trim()
      .toLowerCase();

    if (role === "supplier") {
      return NextResponse.json(
        {
          success: false,
          message:
            "Supplier accounts cannot upload R2 images",
        },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const allowSkuOnly = formData.get("allowSkuOnly") === "1";

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "Image file is required" },
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          success: false,
          message: `${file.name}: image must be converted to WebP before upload`,
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          message: `${file.name}: maximum size is 20 MB`,
        },
        { status: 400 },
      );
    }

    const parsed = parseFileName(file.name, allowSkuOnly);

    if (!parsed) {
      return NextResponse.json(
        {
          success: false,
          message:
            `${file.name}: filename format not recognized. ` +
            "Expected: SKU - AED/QAR Price (Image No) Size - ... Fabric - ...",
        },
        { status: 400 },
      );
    }

    const { client, bucketName, publicUrl } = getConfig();
    const cleanBaseName = stripExtension(safeFileName(file.name));
    const key = parsed.needsManualInfo
      ? `products/${parsed.sku}/PENDING/${crypto.randomUUID()}-${cleanBaseName}.webp`
      : `products/${parsed.sku}/${parsed.currency}/` +
        `${parsed.imageNumber}-${crypto.randomUUID()}-${cleanBaseName}.webp`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: Buffer.from(await file.arrayBuffer()),
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: {
          sku: parsed.sku,
          currency: parsed.currency,
          price: parsed.price || "PENDING",
          image_number: parsed.imageNumber || "00",
          sizes: parsed.sizes.join(",") || "PENDING",
          fabric_detail: parsed.fabricDetail || "PENDING",
          main_fabric: parsed.mainFabric || "PENDING",
          needs_manual_info: parsed.needsManualInfo ? "true" : "false",
          storage_format: "webp",
          original_file_name: file.name,
        },
      }),
    );

    const url = `${publicUrl}/${key}`;

    // Hugging Face/ONNX cannot load in the Vercel runtime because the native
    // libonnxruntime shared library is unavailable there. Keep uploads working
    // on Vercel and only start the local AI job outside Vercel.
    let aiJob: unknown = null;
    let aiQueued = false;

    if (!parsed.needsManualInfo && !process.env.VERCEL) {
      try {
        const { createAIJob } = await import("@/lib/ai");
        aiJob = createAIJob(key, parsed.sku);
        aiQueued = true;
      } catch (aiError) {
        console.error("R2 upload succeeded, but AI queue failed:", aiError);
      }
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      ...parsed,
      key,
      url,
      aiQueued,
      aiJob,
    });
  } catch (error) {
    console.error("R2 bulk upload failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "R2 upload failed",
      },
      { status: 500 },
    );
  }
}
