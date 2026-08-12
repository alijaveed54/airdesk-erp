import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_FOLDER_PAGE_SIZE = 300;
const MAX_FOLDER_PAGE_SIZE = 500;
const MAX_FOLDER_SCAN_PAGES = 20;

type PublicImage = {
  key: string;
  url: string;
  sku: string;
  currency: string;
  size: number;
  lastModified: string;
  imageNumber: string;
  fabric: string;
  fabricDetail: string;
  price: string;
  sizes: string;
};

type PublicGroup = {
  sku: string;
  currency: string;
  count: number;
  totalSize: number;
  coverUrl: string;
  latestUpload: string;
  fabric: string;
  fabricDetail: string;
  price: string;
  sizes: string;
  images: PublicImage[];
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
    throw new Error("R2 environment variables are missing");
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl: publicUrl.replace(/\/$/, ""),
  };
}

function getClient(config: ReturnType<typeof getConfig>) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);

    const requestedFolderLimit = Number(
      requestUrl.searchParams.get("folderLimit") ||
        DEFAULT_FOLDER_PAGE_SIZE,
    );

    const folderLimit = Math.min(
      MAX_FOLDER_PAGE_SIZE,
      Math.max(
        1,
        Number.isFinite(requestedFolderLimit)
          ? Math.floor(requestedFolderLimit)
          : DEFAULT_FOLDER_PAGE_SIZE,
      ),
    );

    const cursor = String(
      requestUrl.searchParams.get("cursor") || "",
    ).trim();

    const config = getConfig();
    const client = getClient(config);

    type ListedObject = {
      key: string;
      size: number;
      lastModified: string;
    };

    const objects: ListedObject[] = [];
    const seenFolderKeys = new Set<string>();
    let nextCursor = cursor;
    let hasMore = false;
    let scannedPages = 0;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: "products/",
          ContinuationToken: nextCursor || undefined,
          MaxKeys: 1000,
        }),
      );

      for (const object of response.Contents || []) {
        if (!object.Key || object.Key.endsWith("/")) continue;

        const parts = object.Key.split("/");
        const sku = parts[1] || "UNSORTED";
        const currency = (parts[2] || "UNSORTED").toUpperCase();

        objects.push({
          key: object.Key,
          size: Number(object.Size || 0),
          lastModified: object.LastModified?.toISOString() || "",
        });

        seenFolderKeys.add(`${sku}:${currency}`);
      }

      scannedPages += 1;
      nextCursor = response.NextContinuationToken || "";
      hasMore = Boolean(response.IsTruncated && nextCursor);
    } while (
      seenFolderKeys.size < folderLimit &&
      hasMore &&
      nextCursor &&
      scannedPages < MAX_FOLDER_SCAN_PAGES
    );

    const map = new Map<string, PublicGroup>();

    for (const object of objects) {
      const parts = object.key.split("/");
      const sku = parts[1] || "UNSORTED";
      const currency = (parts[2] || "UNSORTED").toUpperCase();

      // Keep incomplete/manual-upload folders private until they are classified.
      if (currency === "PENDING" || currency === "UNSORTED") {
        continue;
      }

      const fileName = parts.at(-1) || "";
      const imageNumber = fileName.match(/^(\d+)/)?.[1] || "";
      const groupKey = `${sku}:${currency}`;
      const url = `${config.publicUrl}/${object.key}`;

      const group =
        map.get(groupKey) ||
        {
          sku,
          currency,
          count: 0,
          totalSize: 0,
          coverUrl: url,
          latestUpload: object.lastModified,
          fabric: "",
          fabricDetail: "",
          price: "",
          sizes: "",
          images: [],
        };

      group.count += 1;
      group.totalSize += object.size;

      if (object.lastModified > group.latestUpload) {
        group.latestUpload = object.lastModified;
        group.coverUrl = url;
      }

      group.images.push({
        key: object.key,
        url,
        sku,
        currency,
        size: object.size,
        lastModified: object.lastModified,
        imageNumber,
        fabric: "",
        fabricDetail: "",
        price: "",
        sizes: "",
      });

      map.set(groupKey, group);
    }

    const groups = Array.from(map.values());

    // One HEAD request per public folder: enough for price/fabric/size while
    // keeping public gallery loading substantially lighter than per-image HEADs.
    const metadataBatchSize = 20;

    for (let index = 0; index < groups.length; index += metadataBatchSize) {
      const batch = groups.slice(index, index + metadataBatchSize);

      await Promise.all(
        batch.map(async (group) => {
          let representative = group.images[0];
          if (!representative) return;

          for (const image of group.images) {
            if (image.lastModified > representative.lastModified) {
              representative = image;
            }
          }

          try {
            const head = await client.send(
              new HeadObjectCommand({
                Bucket: config.bucketName,
                Key: representative.key,
              }),
            );

            const metadata = head.Metadata || {};

            group.fabric = metadata.main_fabric || "";
            group.fabricDetail = metadata.fabric_detail || "";
            group.price =
              metadata.price && metadata.price !== "PENDING"
                ? metadata.price
                : "";
            group.sizes =
              metadata.sizes && metadata.sizes !== "PENDING"
                ? metadata.sizes
                : "";

            for (const image of group.images) {
              image.fabric = group.fabric;
              image.fabricDetail = group.fabricDetail;
              image.price = group.price;
              image.sizes = group.sizes;
            }
          } catch {
            // Missing metadata must not block the public gallery.
          }
        }),
      );
    }

    const orderedGroups = groups
      .map((group) => ({
        ...group,
        images: group.images.sort((a, b) => {
          const aNo = Number(a.imageNumber || 999999);
          const bNo = Number(b.imageNumber || 999999);
          return aNo !== bNo
            ? aNo - bNo
            : a.key.localeCompare(b.key);
        }),
      }))
      .sort(
        (a, b) =>
          b.latestUpload.localeCompare(a.latestUpload) ||
          a.sku.localeCompare(b.sku, undefined, { numeric: true }),
      );

    return NextResponse.json(
      {
        success: true,
        groups: orderedGroups,
        summary: {
          totalImages: orderedGroups.reduce(
            (sum, group) => sum + group.images.length,
            0,
          ),
          totalSkus: new Set(
            orderedGroups.map((group) => group.sku),
          ).size,
          totalGroups: orderedGroups.length,
          totalSize: orderedGroups.reduce(
            (sum, group) => sum + group.totalSize,
            0,
          ),
        },
        pagination: {
          hasMore,
          nextCursor,
          pageSize: orderedGroups.length,
          objectCount: objects.length,
          mode: "folders",
        },
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    console.error("Public R2 gallery error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Public R2 gallery load failed",
      },
      { status: 500 },
    );
  }
}
