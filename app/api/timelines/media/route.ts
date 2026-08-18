import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getGreenApiDownloadFileUrl,
  getGreenApiGroup,
  getGreenApiMessageDownloadUrl,
} from "@/lib/green-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CachedMediaUrl = {
  url: string;
  expiresAt: number;
};

const MEDIA_URL_TTL_MS = 5 * 60 * 1000;
const mediaUrlCache = new Map<string, CachedMediaUrl>();

function isAdminSession(session: Awaited<ReturnType<typeof getSession>>) {
  return Boolean(session && (session.role === "Admin" || session.superAdmin));
}

function safeFileName(value: string) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 140);

  return cleaned || "whatsapp-media";
}

function fallbackExtension(contentType: string) {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-msvideo": "avi",
    "video/x-matroska": "mkv",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/plain": "txt",
  };

  if (known[normalized]) return known[normalized];
  const subtype = normalized.split("/")[1] || "";
  const cleanedSubtype = subtype.replace(/[^a-z0-9]+/gi, "").slice(0, 8);
  return cleanedSubtype || "bin";
}

function isPrivateIpv4(host: string) {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isSafeRemoteMediaUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host) return false;

    if (
      host === "localhost" ||
      host === "localhost.localdomain" ||
      host === "metadata.google.internal" ||
      host.endsWith(".local") ||
      host.endsWith(".localhost") ||
      host === "::1" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      isPrivateIpv4(host)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function resolveMediaUrl(idMessage: string) {
  const cached = mediaUrlCache.get(idMessage);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const chatId = getGreenApiGroup("timelines", "secondary");
  const url = await getGreenApiDownloadFileUrl({
    account: "secondary",
    chatId,
    idMessage,
  });

  mediaUrlCache.set(idMessage, {
    url,
    expiresAt: Date.now() + MEDIA_URL_TTL_MS,
  });

  return url;
}

async function fetchUpstream(initialUrl: string) {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (!isSafeRemoteMediaUrl(currentUrl)) {
      throw new Error("media URL points to a blocked/private host");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "*/*",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = String(response.headers.get("location") || "").trim();
        if (!location) return response;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("too many redirects while fetching media");
}

export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 },
      );
    }

    if (!isAdminSession(session)) {
      return NextResponse.json(
        { success: false, message: "Only Admin can access Timelines media" },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const idMessage = String(url.searchParams.get("idMessage") || "").trim();
    const sourceUrl = String(url.searchParams.get("sourceUrl") || "").trim();
    const requestedName = String(url.searchParams.get("fileName") || "").trim();
    const requestedMimeType = String(url.searchParams.get("mimeType") || "").trim();
    const disposition =
      url.searchParams.get("disposition") === "attachment"
        ? "attachment"
        : "inline";

    if (!idMessage || idMessage.length > 250) {
      return NextResponse.json(
        { success: false, message: "Valid WhatsApp message ID is required" },
        { status: 400 },
      );
    }

    let upstream: Response | null = null;
    let directFailure = "";
    let getMessageFailure = "";
    let fallbackFailure = "";

    // 1) Fast path: use the exact downloadUrl returned by GetChatHistory.
    if (sourceUrl && isSafeRemoteMediaUrl(sourceUrl)) {
      try {
        const direct = await fetchUpstream(sourceUrl);
        if (direct.ok && direct.body) {
          upstream = direct;
        } else {
          directFailure = `history URL HTTP ${direct.status}`;
        }
      } catch (error) {
        directFailure =
          error instanceof Error ? error.message : "history URL fetch failed";
      }
    } else if (sourceUrl) {
      directFailure = "history URL points to a blocked/private host";
    } else {
      directFailure = "history URL missing";
    }

    const chatId = getGreenApiGroup("timelines", "secondary");

    // 2) Ask GREEN-API for this exact message again. This can return a fresh downloadUrl.
    if (!upstream) {
      try {
        const freshUrl = await getGreenApiMessageDownloadUrl({
          account: "secondary",
          chatId,
          idMessage,
        });
        if (!isSafeRemoteMediaUrl(freshUrl)) {
          throw new Error("GetMessage returned a blocked/private media host");
        }
        const fresh = await fetchUpstream(freshUrl);
        if (fresh.ok && fresh.body) {
          upstream = fresh;
        } else {
          getMessageFailure = `GetMessage URL HTTP ${fresh.status}`;
        }
      } catch (error) {
        getMessageFailure =
          error instanceof Error ? error.message : "GetMessage refresh failed";
      }
    }

    // 3) Final fallback: DownloadFile asks GREEN-API to resolve the file by chatId + idMessage.
    if (!upstream) {
      try {
        const fallbackUrl = await resolveMediaUrl(idMessage);
        if (!isSafeRemoteMediaUrl(fallbackUrl)) {
          throw new Error("DownloadFile returned a blocked/private media host");
        }
        const fallback = await fetchUpstream(fallbackUrl);
        if (fallback.ok && fallback.body) {
          upstream = fallback;
        } else {
          mediaUrlCache.delete(idMessage);
          fallbackFailure = `DownloadFile URL HTTP ${fallback.status}`;
        }
      } catch (error) {
        mediaUrlCache.delete(idMessage);
        fallbackFailure =
          error instanceof Error ? error.message : "DownloadFile fallback failed";
      }
    }

    if (!upstream || !upstream.body) {
      const details = [directFailure, getMessageFailure, fallbackFailure]
        .filter(Boolean)
        .join("; ");
      console.error("Timelines media unavailable", { idMessage, details });
      return NextResponse.json(
        {
          success: false,
          message: details
            ? `WhatsApp media unavailable: ${details}`
            : "WhatsApp media is unavailable",
          idMessage,
        },
        { status: 502 },
      );
    }

    const upstreamContentType = String(
      upstream.headers.get("content-type") || "",
    ).trim();
    const safeRequestedMimeType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(
      requestedMimeType,
    )
      ? requestedMimeType
      : "";
    const contentType =
      !upstreamContentType ||
      upstreamContentType.toLowerCase().startsWith("application/octet-stream")
        ? safeRequestedMimeType || "application/octet-stream"
        : upstreamContentType;

    let fileName = safeFileName(requestedName);
    if (!/\.[A-Za-z0-9]{2,8}$/.test(fileName)) {
      fileName = `${fileName}.${fallbackExtension(contentType)}`;
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set(
      "Content-Disposition",
      `${disposition}; filename="${fileName.replace(/\"/g, "")}"`,
    );

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Timelines media proxy failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Timelines media could not be loaded",
      },
      { status: 500 },
    );
  }
}
