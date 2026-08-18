"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderDown,
  ImageIcon,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  TimelineMappingConfidence,
  TimelineMedia,
  TimelineParseSummary,
  TimelineProduct,
} from "@/lib/timelines-parser";
import { normalizeTimelineFabric } from "@/lib/timelines-parser";

type FetchResponse = {
  success: boolean;
  message?: string;
  fetchedMessages?: number;
  products?: TimelineProduct[];
  summary?: TimelineParseSummary;
};

type ReplyResponse = {
  success: boolean;
  message?: string;
  sku?: string;
  idMessage?: string;
};

type WritableFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob | ArrayBuffer | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type DirectoryHandle = {
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<DirectoryHandle>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<WritableFileHandle>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<DirectoryHandle>;
};

const EMPTY_SUMMARY: TimelineParseSummary = {
  messages: 0,
  products: 0,
  skuMessages: 0,
  mapped: 0,
  pending: 0,
  review: 0,
  mediaMessages: 0,
};

function formatDate(value: number | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function confidenceClass(confidence: TimelineMappingConfidence) {
  if (confidence === "High" || confidence === "Manual") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (confidence === "Medium") return "bg-blue-100 text-blue-800";
  if (confidence === "Needs Review") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilePart(value: string, fallback = "file") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);

  return cleaned || fallback;
}

function isImageMedia(media: TimelineMedia) {
  return (
    media.typeMessage === "imageMessage" ||
    media.typeMessage === "stickerMessage" ||
    String(media.mimeType || "").toLowerCase().startsWith("image/")
  );
}

function isDownloadableMedia(media: TimelineMedia) {
  return Boolean(String(media.idMessage || "").trim());
}

function mediaProxyUrl(media: TimelineMedia, disposition: "inline" | "attachment" = "inline") {
  const params = new URLSearchParams({
    idMessage: media.idMessage,
    disposition,
  });

  if (media.url) params.set("sourceUrl", media.url);
  if (media.fileName) params.set("fileName", media.fileName);
  if (media.mimeType) params.set("mimeType", media.mimeType);
  return `/api/timelines/media?${params.toString()}`;
}

function mediaThumbnailUrl(media: TimelineMedia) {
  const thumbnail = String(media.thumbnail || "").replace(/^data:[^,]+,/, "").trim();
  return thumbnail ? `data:image/jpeg;base64,${thumbnail}` : "";
}

function thumbnailBlob(media: TimelineMedia) {
  const raw = String(media.thumbnail || "")
    .replace(/^data:[^,]+,/, "")
    .replace(/\s+/g, "")
    .trim();
  if (!raw) return null;

  try {
    const binary = window.atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: "image/jpeg" });
  } catch {
    return null;
  }
}

async function responseErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as { message?: unknown };
    const message = String(data?.message || "").trim();
    if (message) return message;
  } catch {
    // Ignore non-JSON responses.
  }
  return `HTTP ${response.status}`;
}

async function fetchMediaBlob(media: TimelineMedia) {
  const response = await fetch(mediaProxyUrl(media, "attachment"), {
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = "";
    try {
      const contentType = String(response.headers.get("content-type") || "");
      if (contentType.includes("application/json")) {
        const data = (await response.json()) as { message?: string };
        detail = String(data?.message || "").trim();
      } else {
        detail = (await response.text()).trim().slice(0, 220);
      }
    } catch {
      // Keep HTTP status fallback below.
    }

    throw new Error(detail || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("Downloaded media file is empty");
  }

  return {
    blob,
    contentType:
      response.headers.get("content-type") ||
      media.mimeType ||
      blob.type ||
      "application/octet-stream",
  };
}

function extensionForMedia(media: TimelineMedia, contentType: string) {
  const fromName = String(media.fileName || "").match(/\.([A-Za-z0-9]{2,8})$/);
  if (fromName) return fromName[1].toLowerCase();

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
  const slash = normalized.split("/");
  if (slash.length === 2 && slash[1]) {
    return slash[1].replace(/[^a-z0-9]+/gi, "").slice(0, 8).toLowerCase() || "bin";
  }
  return "bin";
}

function uniqueFileName(
  media: TimelineMedia,
  sku: string,
  index: number,
  contentType: string,
  usedNames: Set<string>,
) {
  const extension = extensionForMedia(media, contentType);
  const originalBase = String(media.fileName || "").replace(/\.[A-Za-z0-9]{2,8}$/, "");
  const preferredBase = originalBase || `${sku}-${String(index + 1).padStart(2, "0")}`;
  const cleanBase = sanitizeFilePart(preferredBase, `${sku}-${index + 1}`);

  let candidate = `${cleanBase}.${extension}`;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${cleanBase}-${suffix}.${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function supplierFromSku(value: unknown) {
  const compact = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^SKU\s*[:#\-]?\s*/i, "")
    .replace(/\s+/g, "");
  const match = compact.match(/^([A-Z]{1,10})(?=[-_]*[0-9])/);
  return match ? match[1] : "";
}

export default function TimelinesClient() {
  const [products, setProducts] = useState<TimelineProduct[]>([]);
  const [summary, setSummary] = useState<TimelineParseSummary>(EMPTY_SUMMARY);
  const [startAfterSku, setStartAfterSku] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [hideReplied, setHideReplied] = useState(false);
  const [openMedia, setOpenMedia] = useState<Record<string, boolean>>({});
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const [openDescriptions, setOpenDescriptions] = useState<Record<string, boolean>>({});

  const totalMediaItems = useMemo(
    () =>
      products.reduce(
        (total, product) => total + product.media.filter(isDownloadableMedia).length,
        0,
      ),
    [products],
  );

  const suppliers = useMemo(
    () =>
      Array.from(new Set(products.map((product) => product.supplier)))
        .filter(Boolean)
        .sort(),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      if (hideReplied && product.replied) return false;
      if (supplierFilter && product.supplier !== supplierFilter) return false;
      if (!query) return true;

      return [
        product.sku,
        product.supplier,
        product.size,
        product.price,
        product.fabric,
        product.sender,
        product.description,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [products, search, supplierFilter, hideReplied]);

  function updateProduct(id: string, patch: Partial<TimelineProduct>) {
    setProducts((current) =>
      current.map((product) =>
        product.id === id ? { ...product, ...patch } : product,
      ),
    );
  }

  function setAllSections(isOpen: boolean) {
    const ids = filteredProducts.map((product) => product.id);
    setOpenMedia(Object.fromEntries(ids.map((id) => [id, isOpen])));
    setOpenDetails(Object.fromEntries(ids.map((id) => [id, isOpen])));
    setOpenDescriptions(Object.fromEntries(ids.map((id) => [id, isOpen])));
  }

  async function pickFromWhatsApp() {
    if (loading) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/timelines/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAfterSku: startAfterSku.trim().toUpperCase() }),
        cache: "no-store",
      });
      const data = (await response.json()) as FetchResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "WhatsApp history could not be loaded");
      }

      setProducts(data.products || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setOpenMedia({});
      setOpenDetails({});
      setOpenDescriptions({});
      setMessage(
        `${startAfterSku.trim().toUpperCase()} ke baad ${Number(data.fetchedMessages || 0).toLocaleString()} WhatsApp message(s) picked. ${Number(data.summary?.pending || 0).toLocaleString()} product(s) SKU reply ke liye pending hain.`,
      );
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "WhatsApp history could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendSkuReply(product: TimelineProduct) {
    const sku = String(product.sku || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!sku || sendingId || product.replied) return;

    if (
      !window.confirm(
        `Description ke exact WhatsApp reply mein \"SKU: ${sku}\" send karna hai?`,
      )
    ) {
      return;
    }

    setSendingId(product.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/timelines/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descriptionMessageId: product.descriptionMessageId,
          sku,
        }),
      });
      const data = (await response.json()) as ReplyResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "SKU reply could not be sent");
      }

      const savedSku = data.sku || sku;
      updateProduct(product.id, {
        sku: savedSku,
        supplier: supplierFromSku(savedSku) || product.supplier,
        skuMessageId: data.idMessage || "sent",
        confidence: "High",
        replied: true,
      });
      setSummary((current) => ({
        ...current,
        mapped: current.mapped + 1,
        pending: Math.max(0, current.pending - 1),
        review: Math.max(0, current.review - 1),
      }));
      setMessage(`Sent as exact WhatsApp reply: SKU: ${data.sku || sku}`);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "SKU reply could not be sent",
      );
    } finally {
      setSendingId("");
    }
  }

  async function downloadProductMedia(product: TimelineProduct) {
    const sku = sanitizeFilePart(
      String(product.sku || "").trim().toUpperCase().replace(/\s+/g, ""),
      "",
    );
    const mediaItems = product.media.filter(isDownloadableMedia);

    if (!sku) {
      setError("Download se pehle current product ka SKU enter karein.");
      return;
    }

    if (mediaItems.length === 0 || downloadingId || downloadingAll) return;

    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setError(
        "SKU folder download ke liye Chrome ya Microsoft Edge use karein.",
      );
      return;
    }

    setDownloadingId(product.id);
    setError("");
    setMessage("");

    try {
      const parentDirectory = await picker.call(window, { mode: "readwrite" });
      const skuDirectory = await parentDirectory.getDirectoryHandle(sku, {
        create: true,
      });
      const usedNames = new Set<string>();
      let saved = 0;
      const failures: string[] = [];

      for (let index = 0; index < mediaItems.length; index += 1) {
        const media = mediaItems[index];

        try {
          const { blob, contentType } = await fetchMediaBlob(media);
          const fileName = uniqueFileName(
            media,
            sku,
            index,
            contentType,
            usedNames,
          );
          const fileHandle = await skuDirectory.getFileHandle(fileName, {
            create: true,
          });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          saved += 1;
        } catch (mediaError) {
          const fallback = thumbnailBlob(media);
          if (fallback && isImageMedia(media)) {
            try {
              const previewName = uniqueFileName(
                { ...media, fileName: `${sku}-${String(index + 1).padStart(2, "0")}-thumbnail.jpg` },
                sku,
                index,
                "image/jpeg",
                usedNames,
              );
              const fileHandle = await skuDirectory.getFileHandle(previewName, {
                create: true,
              });
              const writable = await fileHandle.createWritable();
              await writable.write(fallback);
              await writable.close();
              saved += 1;
              failures.push(
                `${index + 1}: original unavailable; thumbnail fallback saved`,
              );
              continue;
            } catch {
              // Report the original error below.
            }
          }

          failures.push(
            `${index + 1}: ${
              mediaError instanceof Error ? mediaError.message : "download failed"
            }`,
          );
        }
      }

      if (saved === 0) {
        throw new Error(
          failures.length > 0
            ? `Koi media save nahi hui. ${failures.slice(0, 2).join("; ")}`
            : "Koi media save nahi hui.",
        );
      }

      setMessage(
        failures.length === 0
          ? `${saved} media file(s) folder "${sku}" mein save ho gayi hain.`
          : `${saved}/${mediaItems.length} media file(s) folder "${sku}" mein save hui. ${failures.length} media file(s) unavailable hain.`,
      );
    } catch (downloadError) {
      const errorName =
        downloadError && typeof downloadError === "object" && "name" in downloadError
          ? String((downloadError as { name?: unknown }).name || "")
          : "";

      if (errorName !== "AbortError") {
        setError(
          downloadError instanceof Error
            ? downloadError.message
            : "Media download nahi ho saki.",
        );
      }
    } finally {
      setDownloadingId("");
    }
  }

  async function downloadAllMedia() {
    if (downloadingAll || downloadingId) return;

    const entries = products
      .map((product, productIndex) => ({
        product,
        productIndex,
        mediaItems: product.media.filter(isDownloadableMedia),
      }))
      .filter((entry) => entry.mediaItems.length > 0);

    if (entries.length === 0) {
      setError("Current picked timeline mein koi media available nahi hai.");
      return;
    }

    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setError(
        "Download All Media ke liye Chrome ya Microsoft Edge use karein.",
      );
      return;
    }

    setDownloadingAll(true);
    setError("");
    setMessage("");

    try {
      const parentDirectory = await picker.call(window, { mode: "readwrite" });
      const folderState = new Map<
        string,
        { directory: DirectoryHandle; usedNames: Set<string> }
      >();
      let saved = 0;
      let failed = 0;
      let noSkuProducts = 0;

      for (const entry of entries) {
        const rawSku = String(entry.product.sku || "")
          .trim()
          .toUpperCase()
          .replace(/\s+/g, "");
        const sku = sanitizeFilePart(rawSku, "");
        const folderName = sku || `NO-SKU-${String(entry.productIndex + 1).padStart(3, "0")}`;
        if (!sku) noSkuProducts += 1;

        let state = folderState.get(folderName.toLowerCase());
        if (!state) {
          const directory = await parentDirectory.getDirectoryHandle(folderName, {
            create: true,
          });
          state = { directory, usedNames: new Set<string>() };
          folderState.set(folderName.toLowerCase(), state);
        }

        for (let mediaIndex = 0; mediaIndex < entry.mediaItems.length; mediaIndex += 1) {
          const media = entry.mediaItems[mediaIndex];

          try {
            const { blob, contentType } = await fetchMediaBlob(media);
            const fileName = uniqueFileName(
              media,
              sku || folderName,
              mediaIndex,
              contentType,
              state.usedNames,
            );
            const fileHandle = await state.directory.getFileHandle(fileName, {
              create: true,
            });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            saved += 1;
          } catch (mediaError) {
            const fallback = thumbnailBlob(media);
            if (fallback && isImageMedia(media)) {
              try {
                const previewName = uniqueFileName(
                  {
                    ...media,
                    fileName: `${folderName}-${String(mediaIndex + 1).padStart(2, "0")}-thumbnail.jpg`,
                  },
                  sku || folderName,
                  mediaIndex,
                  "image/jpeg",
                  state.usedNames,
                );
                const fileHandle = await state.directory.getFileHandle(previewName, {
                  create: true,
                });
                const writable = await fileHandle.createWritable();
                await writable.write(fallback);
                await writable.close();
                saved += 1;
                failed += 1;
                continue;
              } catch {
                // Count as a normal failure below.
              }
            }

            failed += 1;
            console.warn(
              "Timeline media download failed",
              media.idMessage,
              mediaError instanceof Error ? mediaError.message : mediaError,
            );
          }
        }
      }

      if (saved === 0) {
        throw new Error(
          failed > 0
            ? `Koi media save nahi hui. ${failed} file(s) GREEN-API se unavailable/fail hain.`
            : "Koi media save nahi hui.",
        );
      }

      const noSkuNote = noSkuProducts
        ? ` ${noSkuProducts} product(s) without SKU ko NO-SKU folders mein save kiya gaya.`
        : "";
      setMessage(
        failed === 0
          ? `${saved} media file(s) download ho gayi hain. Har SKU ka separate folder bana diya gaya.${noSkuNote}`
          : `${saved} media file(s) download hui; ${failed} unavailable media file(s) skip hui.${noSkuNote}`,
      );
    } catch (downloadError) {
      const errorName =
        downloadError && typeof downloadError === "object" && "name" in downloadError
          ? String((downloadError as { name?: unknown }).name || "")
          : "";
      if (errorName !== "AbortError") {
        setError(
          downloadError instanceof Error
            ? downloadError.message
            : "All images download nahi ho sakin.",
        );
      }
    } finally {
      setDownloadingAll(false);
    }
  }

  function exportExcel() {
    if (products.length === 0) return;

    const rows = products.map((product) => [
      product.sku ?? "",
      product.supplier ?? "",
      product.price ?? "",
      product.size ?? "",
      normalizeTimelineFabric(product.fabric ?? ""),
    ]);

    const headerCells = ["SKU", "Supplier", "Price", "Size", "Fabric"]
      .map(
        (value) =>
          `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`,
      )
      .join("");

    const dataRows = rows
      .map((row) => {
        const cells = row
          .map((value, columnIndex) => {
            const isNumericPrice =
              columnIndex === 2 &&
              String(value).trim() !== "" &&
              Number.isFinite(Number(value));
            const type = isNumericPrice ? "Number" : "String";
            return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
          })
          .join("");
        return `<Row>${cells}</Row>`;
      })
      .join("");

    const excelXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F766E" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Products">
  <Table>
   <Column ss:Width="110"/>
   <Column ss:Width="95"/>
   <Column ss:Width="75"/>
   <Column ss:Width="110"/>
   <Column ss:Width="150"/>
   <Row ss:Height="24">${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;

    downloadBlob(
      new Blob(["\uFEFF", excelXml], {
        type: "application/vnd.ms-excel;charset=utf-8",
      }),
      "timelines-whatsapp-products-sku-supplier-price-size-fabric.xls",
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-emerald-700">
            <ShieldCheck size={18} />
            Admin Only
          </div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Timelines
          </h1>
          <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-slate-500">
            WhatsApp Supplier Import ke same product-description, supplier, price,
            size, fabric aur SKU mapping rules use hotay hain. Difference sirf itna
            hai ke TXT export upload nahi karna: history GREEN-API Account 2 se tabhi
            pick hogi jab aap button press karein. Koi auto polling nahi hai.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void downloadAllMedia()}
            disabled={totalMediaItems === 0 || downloadingAll || Boolean(downloadingId)}
            className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {downloadingAll ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <FolderDown size={18} />
            )}
            {downloadingAll
              ? "Downloading All Media..."
              : totalMediaItems === 0
                ? "Media Available After Pick"
                : `Download All Media (${totalMediaItems.toLocaleString()})`}
          </button>

          <button
            type="button"
            onClick={exportExcel}
            disabled={products.length === 0 || downloadingAll}
            className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={18} />
            {products.length === 0
              ? "Excel Available After Pick"
              : "Download Excel (.xls)"}
          </button>
        </div>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
              <MessageCircle size={20} className="text-emerald-600" />
              Pick WhatsApp Timeline
            </h2>
            <p className="mt-1 text-xs font-bold text-slate-500">
              Button click = one GetChatHistory request. Page kholne se khud koi WhatsApp request nahi hoti.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[260px]">
              <span className="block text-[11px] font-black uppercase text-slate-400">
                Start After SKU
              </span>
              <input
                type="text"
                value={startAfterSku}
                onChange={(event) => setStartAfterSku(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && startAfterSku.trim() && !loading && !sendingId) {
                    event.preventDefault();
                    void pickFromWhatsApp();
                  }
                }}
                placeholder="Example: HRT1234"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-black uppercase outline-none focus:border-emerald-500"
              />
              <span className="mt-1 block text-[10px] font-bold text-slate-400">
                Is SKU ki latest exact occurrence tak sab skip hoga.
              </span>
            </label>

            <button
              type="button"
              onClick={pickFromWhatsApp}
              disabled={loading || Boolean(sendingId) || !startAfterSku.trim()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-50"
            >
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
              {loading ? "Picking..." : "Pick from WhatsApp"}
            </button>
          </div>
        </div>
      </section>

      {(message || error) && (
        <div
          className={[
            "rounded-2xl border p-4 text-sm font-black",
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          ].join(" ")}
        >
          {error || message}
        </div>
      )}

      {summary.messages > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            ["Messages", summary.messages],
            ["Products", summary.products],
            ["SKU Replies", summary.skuMessages],
            ["Mapped", summary.mapped],
            ["Pending Reply", summary.pending],
            ["Media", summary.mediaMessages],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-black uppercase text-slate-400">
                {label}
              </p>
              <p className="mt-1 text-2xl font-black text-slate-950">
                {Number(value).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {products.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-950">
                Product Mapping Review
              </h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Start After SKU ke neeche mapped + unmapped sab products default se show hotay hain. Existing quoted SKU replies exact message-ID se map hotay hain; purane unquoted replies ke liye FIFO fallback rehti hai.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAllSections(true)}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-black text-emerald-800"
              >
                Expand All
              </button>
              <button
                type="button"
                onClick={() => setAllSections(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700"
              >
                Collapse All
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <label className="relative block">
              <Search
                size={17}
                className="absolute left-3 top-3.5 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search SKU, supplier or description"
                className="h-11 w-full rounded-xl border border-slate-300 pl-10 pr-3 text-sm font-bold outline-none focus:border-emerald-500"
              />
            </label>

            <select
              value={supplierFilter}
              onChange={(event) => setSupplierFilter(event.target.value)}
              className="h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-emerald-500"
            >
              <option value="">All Suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier} value={supplier}>
                  {supplier}
                </option>
              ))}
            </select>

            <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-700">
              <input
                type="checkbox"
                checked={hideReplied}
                onChange={(event) => setHideReplied(event.target.checked)}
              />
              Hide SKU Given
            </label>
          </div>

          <div className="mt-5 space-y-4">
            {filteredProducts.map((product, visibleIndex) => (
              <article
                key={product.id}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                        #{visibleIndex + 1}
                      </span>
                      {product.sku && (
                        <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-black text-cyan-900">
                          SKU: {product.sku}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${confidenceClass(product.confidence)}`}
                      >
                        {product.confidence}
                      </span>
                      <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">
                        {product.supplier}
                      </span>
                      {product.replied && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
                          <CheckCircle2 size={13} /> Replied
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-500">
                      {formatDate(product.timestamp)} · {product.sender}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <label className="rounded-2xl border-2 border-cyan-200 bg-cyan-50/60 p-3">
                    <span className="text-[11px] font-black uppercase tracking-wide text-cyan-800">
                      SKU — Editable
                    </span>
                    <input
                      value={product.sku}
                      onChange={(event) => {
                        const nextSku = event.target.value.toUpperCase();
                        const nextSupplier = supplierFromSku(nextSku);
                        updateProduct(product.id, {
                          sku: nextSku,
                          ...(nextSupplier ? { supplier: nextSupplier } : {}),
                          confidence: "Manual",
                        });
                      }}
                      className="mt-1 h-11 w-full rounded-xl border border-cyan-300 bg-white px-3 text-sm font-black uppercase text-slate-950 outline-none focus:border-cyan-600"
                      placeholder="e.g. FFT10029"
                    />
                  </label>

                  <label className="rounded-2xl border-2 border-violet-200 bg-violet-50/60 p-3">
                    <span className="text-[11px] font-black uppercase tracking-wide text-violet-800">
                      Supplier — Editable
                    </span>
                    <input
                      value={product.supplier === "UNASSIGNED" ? "" : product.supplier}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          supplier: event.target.value.toUpperCase(),
                          confidence: "Manual",
                        })
                      }
                      className="mt-1 h-11 w-full rounded-xl border border-violet-300 bg-white px-3 text-sm font-black uppercase text-slate-950 outline-none focus:border-violet-600"
                      placeholder="e.g. FFT"
                    />
                    <span className="mt-1 block text-[10px] font-bold text-violet-600">
                      SKU edit par prefix auto-fill hoga; supplier ko manually bhi correct kar sakte hain.
                    </span>
                  </label>

                  <label className="rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Price — Editable
                    </span>
                    <input
                      value={product.price ?? ""}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          price: event.target.value,
                          confidence: "Manual",
                        })
                      }
                      className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-500"
                      placeholder="Price"
                    />
                  </label>

                  <label className="rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Size — Editable
                    </span>
                    <input
                      value={product.size ?? ""}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          size: event.target.value,
                          confidence: "Manual",
                        })
                      }
                      className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-500"
                      placeholder="Size"
                    />
                  </label>

                  <label className="rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Fabric — Editable
                    </span>
                    <input
                      value={product.fabric ?? ""}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          fabric: event.target.value,
                          confidence: "Manual",
                        })
                      }
                      className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-500"
                      placeholder="Fabric"
                    />
                  </label>
                </div>

                {product.media.length > 0 && (
                  <details
                    open={openMedia[product.id] ?? true}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setOpenMedia((current) => ({
                        ...current,
                        [product.id]: isOpen,
                      }));
                    }}
                    className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60"
                  >
                    <summary className="cursor-pointer select-none px-4 py-3 text-sm font-black text-slate-800">
                      <span className="inline-flex items-center gap-2">
                        <ImageIcon size={16} className="text-emerald-600" />
                        Media ({product.media.length.toLocaleString()})
                      </span>
                    </summary>

                    <div className="border-t border-slate-200 p-3">
                      <div className="mb-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => void downloadProductMedia(product)}
                            disabled={!product.sku || Boolean(downloadingId) || downloadingAll}
                            title={
                              product.sku
                                ? `Save all media in folder: ${product.sku}`
                                : "Enter current SKU first"
                            }
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {downloadingId === product.id ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : (
                              <FolderDown size={15} />
                            )}
                            {downloadingId === product.id
                              ? "Saving Media..."
                              : product.sku
                                ? `Download Media → ${product.sku}`
                                : "Enter SKU to Download"}
                          </button>
                        </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                        {product.media.map((media, mediaIndex) => (
                          <a
                            key={`${media.idMessage}-${mediaIndex}`}
                            href={mediaProxyUrl(media)}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
                          >
                            {isImageMedia(media) ? (
                              <div className="relative aspect-square bg-slate-100">
                                <img
                                  src={mediaProxyUrl(media)}
                                  alt={`WhatsApp product image ${mediaIndex + 1}`}
                                  loading="lazy"
                                  decoding="async"
                                  referrerPolicy="no-referrer"
                                  onError={(event) => {
                                    const image = event.currentTarget;
                                    const thumbnail = mediaThumbnailUrl(media);
                                    if (thumbnail && image.dataset.thumbnailFallback !== "1") {
                                      image.dataset.thumbnailFallback = "1";
                                      image.src = thumbnail;
                                    } else {
                                      image.style.display = "none";
                                    }
                                  }}
                                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                />
                                <span className="absolute bottom-1 right-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-black text-white">
                                  {mediaIndex + 1}
                                </span>
                              </div>
                            ) : (
                              <div className="grid aspect-square place-items-center p-3 text-center text-xs font-black text-slate-500">
                                {media.fileName || media.mimeType || media.typeMessage || "Media"}
                              </div>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>
                  </details>
                )}

                <details
                  open={openDetails[product.id] ?? !product.replied}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setOpenDetails((current) => ({
                      ...current,
                      [product.id]: isOpen,
                    }));
                  }}
                  className="mt-4 rounded-2xl border border-slate-200 bg-white"
                >
                  <summary className="cursor-pointer select-none px-4 py-3 text-sm font-black text-slate-800">
                    SKU Reply / Actions
                  </summary>
                  <div className="border-t border-slate-100 px-4 pb-4">
                    <p className="mt-4 text-xs font-bold text-slate-500">
                      SKU, Supplier, Price, Size aur Fabric upar directly editable hain. Manual changes Excel aur image download mein use hongi.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!product.sku || product.replied || Boolean(sendingId)}
                        onClick={() => void sendSkuReply(product)}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"
                      >
                        {sendingId === product.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Send size={15} />
                        )}
                        {product.replied
                          ? `Replied: SKU: ${product.sku}`
                          : sendingId === product.id
                            ? "Sending..."
                            : "Send SKU as Description Reply"}
                      </button>

                      {!product.replied && !product.sku && (
                        <span className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-xs font-black text-amber-800">
                          <AlertTriangle size={15} />
                          Enter SKU first
                        </span>
                      )}
                    </div>
                  </div>
                </details>

                <details
                  open={openDescriptions[product.id] ?? false}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setOpenDescriptions((current) => ({
                      ...current,
                      [product.id]: isOpen,
                    }));
                  }}
                  className="mt-3 rounded-xl bg-slate-50 p-3"
                >
                  <summary className="cursor-pointer text-sm font-black text-slate-800">
                    Product Description
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-xs font-bold leading-6 text-slate-700">
                    {product.description}
                  </pre>
                </details>
              </article>
            ))}

            {filteredProducts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm font-black text-slate-500">
                {hideReplied
                  ? "No pending products match current filters. Hide SKU Given off karein to mapped products bhi nazar aayenge."
                  : "No products match current filters."}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

