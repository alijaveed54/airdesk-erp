import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 300;
const MAX_PAGE_SIZE = 500;
const DEFAULT_FOLDER_PAGE_SIZE = 1000;
const MAX_FOLDER_PAGE_SIZE = 1000;
const MAX_FOLDER_SCAN_PAGES = 20;

type SessionLike = {
  role?: string;
  superAdmin?: boolean;
  selectedBase?: { canDelete?: boolean };
  permissions?: Array<{ canDelete?: boolean }>;
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

async function requireUser() {
  const session = (await getSession()) as SessionLike | null;

  if (!session) {
    throw { status: 401, message: "Not authenticated" };
  }

  return session;
}

function canDelete(session: SessionLike) {
  const role = String(session.role || "")
    .trim()
    .toLowerCase();

  return role === "admin" || Boolean(session.superAdmin);
}

export async function GET(request: Request) {
  try {
    await requireUser();

    const requestUrl = new URL(request.url);
    const folderLimitValue = requestUrl.searchParams.get("folderLimit");
    const folderMode = folderLimitValue !== null;
    const requestedLimit = Number(
      requestUrl.searchParams.get("limit") || DEFAULT_PAGE_SIZE,
    );
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        50,
        Number.isFinite(requestedLimit)
          ? Math.floor(requestedLimit)
          : DEFAULT_PAGE_SIZE,
      ),
    );
    const requestedFolderLimit = Number(
      folderLimitValue || DEFAULT_FOLDER_PAGE_SIZE,
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
    const cursor = requestUrl.searchParams.get("cursor") || "";

    const config = getConfig();
    const client = getClient(config);

    type ListedObject = {
      key: string;
      size: number;
      lastModified: string;
      fabric: string;
      fabricDetail: string;
      price: string;
      sizes: string;
    };

    const objects: ListedObject[] = [];
    let nextCursor = cursor;
    let hasMore = false;

    if (folderMode) {
      const seenFolderKeys = new Set<string>();
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

          objects.push({
            key: object.Key,
            size: Number(object.Size || 0),
            lastModified: object.LastModified?.toISOString() || "",
            fabric: "",
            fabricDetail: "",
            price: "",
            sizes: "",
          });

          const parts = object.Key.split("/");
          const sku = parts[1] || "UNSORTED";
          const currency = (parts[2] || "UNSORTED").toUpperCase();
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
    } else {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: "products/",
          ContinuationToken: cursor || undefined,
          MaxKeys: limit,
        }),
      );

      for (const object of response.Contents || []) {
        if (!object.Key || object.Key.endsWith("/")) continue;

        objects.push({
          key: object.Key,
          size: Number(object.Size || 0),
          lastModified: object.LastModified?.toISOString() || "",
          fabric: "",
          fabricDetail: "",
          price: "",
          sizes: "",
        });
      }

      nextCursor = response.NextContinuationToken || "";
      hasMore = Boolean(response.IsTruncated && nextCursor);

      // Existing clients receive per-image metadata exactly as before.
      const metadataBatchSize = 12;

      for (let index = 0; index < objects.length; index += metadataBatchSize) {
        const batch = objects.slice(index, index + metadataBatchSize);

        await Promise.all(
          batch.map(async (object) => {
            try {
              const head = await client.send(
                new HeadObjectCommand({
                  Bucket: config.bucketName,
                  Key: object.key,
                }),
              );

              const metadata = head.Metadata || {};
              object.fabric = metadata.main_fabric || "";
              object.fabricDetail = metadata.fabric_detail || "";
              object.price = metadata.price || "";
              object.sizes = metadata.sizes || "";
            } catch {
              // A missing metadata record must not block the gallery page.
            }
          }),
        );
      }
    }

    const map = new Map<
      string,
      {
        sku: string;
        currency: string;
        count: number;
        totalSize: number;
        coverUrl: string;
        latestUpload: string;
        images: Array<{
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
        }>;
      }
    >();

    for (const object of objects) {
      const parts = object.key.split("/");
      const sku = parts[1] || "UNSORTED";
      const currency = (parts[2] || "UNSORTED").toUpperCase();
      const fileName = parts.at(-1) || "";
      const imageNumber = fileName.match(/^(\d+)/)?.[1] || "";
      const groupKey = `${sku}:${currency}`;
      const url = `${config.publicUrl}/${object.key}`;

      const group = map.get(groupKey) || {
        sku,
        currency,
        count: 0,
        totalSize: 0,
        coverUrl: url,
        latestUpload: object.lastModified,
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
        fabric: object.fabric,
        fabricDetail: object.fabricDetail,
        price: object.price,
        sizes: object.sizes,
      });

      map.set(groupKey, group);
    }

    if (folderMode) {
      // One representative HEAD request per folder keeps the 1,000-card
      // initial load much lighter than requesting metadata for every image.
      const folderGroups = Array.from(map.values());
      const metadataBatchSize = 24;

      for (
        let index = 0;
        index < folderGroups.length;
        index += metadataBatchSize
      ) {
        const batch = folderGroups.slice(index, index + metadataBatchSize);

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
              const fabric = metadata.main_fabric || "";
              const fabricDetail = metadata.fabric_detail || "";
              const price = metadata.price || "";
              const sizes = metadata.sizes || "";

              for (const image of group.images) {
                image.fabric = fabric;
                image.fabricDetail = fabricDetail;
                image.price = price;
                image.sizes = sizes;
              }
            } catch {
              // A missing metadata record must not block the gallery page.
            }
          }),
        );
      }
    }

    const groups = Array.from(map.values())
      .map((group) => ({
        ...group,
        images: group.images.sort((a, b) => {
          const numberA = Number(a.imageNumber || 999999);
          const numberB = Number(b.imageNumber || 999999);
          if (numberA !== numberB) return numberA - numberB;
          return a.key.localeCompare(b.key);
        }),
      }))
      .sort(
        (a, b) =>
          b.latestUpload.localeCompare(a.latestUpload) ||
          a.sku.localeCompare(b.sku),
      );

    return NextResponse.json(
      {
        success: true,
        groups,
        summary: {
          totalImages: objects.length,
          totalSkus: new Set(groups.map((group) => group.sku)).size,
          totalGroups: groups.length,
          totalSize: objects.reduce((sum, object) => sum + object.size, 0),
        },
        pagination: {
          hasMore,
          nextCursor,
          pageSize: folderMode ? groups.length : objects.length,
          objectCount: objects.length,
          mode: folderMode ? "folders" : "objects",
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    const knownError = error as { status?: number; message?: string };

    return NextResponse.json(
      {
        success: false,
        message: knownError?.message || "Gallery load failed",
      },
      { status: knownError?.status || 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireUser();

    if (!canDelete(session)) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to delete images",
        },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      key?: string;
      keys?: string[];
      prefix?: string;
    };

    const requestedKeys = Array.isArray(body.keys)
      ? body.keys.map((key) => String(key).trim()).filter(Boolean)
      : [];

    const singleKey = String(body.key || "").trim();
    const prefix = String(body.prefix || "").trim();
    const keys: string[] = [...requestedKeys];

    if (singleKey) keys.push(singleKey);

    const config = getConfig();
    const client = getClient(config);

    if (keys.length === 0 && prefix) {
      let continuationToken: string | undefined;

      do {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          }),
        );

        keys.push(
          ...(response.Contents || [])
            .map((object) => object.Key || "")
            .filter(Boolean),
        );

        continuationToken = response.IsTruncated
          ? response.NextContinuationToken
          : undefined;
      } while (continuationToken);
    }

    const uniqueKeys = Array.from(new Set(keys)).filter((key) =>
      key.startsWith("products/"),
    );

    if (uniqueKeys.length === 0) {
      return NextResponse.json(
        { success: false, message: "No valid image selected" },
        { status: 400 },
      );
    }

    for (let index = 0; index < uniqueKeys.length; index += 1000) {
      const batch = uniqueKeys.slice(index, index + 1000);

      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucketName,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }

    return NextResponse.json({
      success: true,
      deletedCount: uniqueKeys.length,
    });
  } catch (error) {
    const knownError = error as { status?: number; message?: string };

    return NextResponse.json(
      {
        success: false,
        message: knownError?.message || "Delete failed",
      },
      { status: knownError?.status || 500 },
    );
  }
}
