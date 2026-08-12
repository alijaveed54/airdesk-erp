import {
  NextRequest,
  NextResponse,
} from "next/server";
import { getSession } from "@/lib/auth";
import {
  FACEBOOK_BATCH_MAX_IMAGES,
  putBatchMedia,
} from "@/lib/facebook-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_FILE_SIZE =
  20 * 1024 * 1024;

const CONFIGURED_MAX_VIDEO_MB = Number(
  process.env.FACEBOOK_MAX_VIDEO_MB || 100
);

const MAX_VIDEO_FILE_SIZE =
  (Number.isFinite(CONFIGURED_MAX_VIDEO_MB) &&
  CONFIGURED_MAX_VIDEO_MB > 0
    ? CONFIGURED_MAX_VIDEO_MB
    : 100) *
  1024 *
  1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

type SessionLike = {
  role?: string;
  superAdmin?: boolean;
};

function cleanHeader(
  value: string | null,
  maxLength = 500
) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function decodeFileName(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isAllowedRole(session: SessionLike) {
  const role = String(session.role || "")
    .trim()
    .toLowerCase();

  return (
    role === "admin" ||
    role === "manager" ||
    role === "employee" ||
    role === "staff" ||
    Boolean(session.superAdmin)
  );
}

function jsonError(
  message: string,
  status = 400
) {
  return NextResponse.json(
    { success: false, message },
    { status }
  );
}

export async function POST(
  request: NextRequest
) {
  try {
    const session =
      (await getSession()) as
        | SessionLike
        | null;

    if (!session) {
      return jsonError(
        "Not authenticated",
        401
      );
    }

    if (!isAllowedRole(session)) {
      return jsonError(
        "Facebook Batch upload sirf Admin, Manager aur Employee use kar sakte hain.",
        403
      );
    }

    const contentType = cleanHeader(
      request.headers.get("content-type"),
      200
    ).toLowerCase();

    if (
      !contentType.startsWith(
        "application/octet-stream"
      )
    ) {
      return jsonError(
        `Batch media raw binary required hai. Received: ${contentType || "missing"}.`,
        415
      );
    }

    const batchId = cleanHeader(
      request.headers.get(
        "x-facebook-batch-id"
      ),
      100
    );

    const postId = cleanHeader(
      request.headers.get(
        "x-facebook-post-id"
      ),
      100
    );

    const fileName = decodeFileName(
      cleanHeader(
        request.headers.get(
          "x-facebook-file-name"
        ),
        1000
      )
    );

    const fileType = cleanHeader(
      request.headers.get(
        "x-facebook-file-type"
      ),
      200
    ).toLowerCase();

    const declaredSize = Number(
      cleanHeader(
        request.headers.get(
          "x-facebook-file-size"
        ),
        50
      )
    );

    if (!batchId || !postId || !fileName) {
      return jsonError(
        "Batch ID, Post ID aur file name required hain."
      );
    }

    const isImage =
      ALLOWED_IMAGE_TYPES.has(fileType);
    const isVideo =
      ALLOWED_VIDEO_TYPES.has(fileType);

    if (!isImage && !isVideo) {
      return jsonError(
        `${fileName}: sirf JPG, PNG, WebP, MP4, MOV aur WebM allowed hain.`
      );
    }

    const maximumFileSize = isVideo
      ? MAX_VIDEO_FILE_SIZE
      : MAX_IMAGE_FILE_SIZE;

    if (
      Number.isFinite(declaredSize) &&
      declaredSize > maximumFileSize
    ) {
      return jsonError(
        `${fileName}: maximum ${Math.round(
          maximumFileSize / 1024 / 1024
        )} MB allowed hai.`
      );
    }

    const bytes = Buffer.from(
      await request.arrayBuffer()
    );

    if (bytes.length === 0) {
      return jsonError(
        `${fileName}: file empty hai.`
      );
    }

    if (bytes.length > maximumFileSize) {
      return jsonError(
        `${fileName}: maximum ${Math.round(
          maximumFileSize / 1024 / 1024
        )} MB allowed hai.`
      );
    }

    if (
      declaredSize > 0 &&
      declaredSize !== bytes.length
    ) {
      return jsonError(
        `${fileName}: upload size mismatch hua. Dobara try karein.`
      );
    }

    const uploaded = await putBatchMedia({
      batchId,
      postId,
      fileName,
      contentType: fileType,
      bytes,
    });

    return NextResponse.json({
      success: true,
      message: isVideo
        ? "Batch video R2 par upload ho gayi."
        : "Batch image R2 par upload ho gayi.",
      mediaType: isVideo ? "video" : "image",
      fileName,
      fileType,
      fileSize: bytes.length,
      maxImagesPerPost:
        FACEBOOK_BATCH_MAX_IMAGES,
      maxVideoMb: Math.round(
        MAX_VIDEO_FILE_SIZE / 1024 / 1024
      ),
      ...uploaded,
    });
  } catch (error) {
    console.error(
      "Facebook batch media upload failed:",
      error
    );

    return jsonError(
      error instanceof Error
        ? error.message
        : "Facebook batch media upload failed.",
      500
    );
  }
}
