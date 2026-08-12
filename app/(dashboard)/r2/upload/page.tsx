"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Images,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";

type Currency = "AED" | "QAR";
type UploadGroup = Currency | "PENDING";

type ParsedFile = {
  file: File;
  sku: string;
  currency: UploadGroup;
  price: string;
  imageNumber: string;
  sizes: string[];
  fabricDetail: string;
  mainFabric: string;
  needsManualInfo: boolean;
};

type InvalidFile = {
  file: File;
  reason: string;
};

type UploadResult = {
  success: boolean;
  message?: string;
};

type FileStatus = {
  name: string;
  status: "pending" | "uploading" | "success" | "failed";
  message?: string;
};

type ImageAnalysis = {
  dominantColor: string;
  colorName: string;
  width: number;
  height: number;
  blurScore: number;
  quality: "Good" | "Low Resolution" | "Blurry" | "Needs Review";
};

type BrowserFileSystemHandle = {
  kind: "file" | "directory";
  name: string;
};

type BrowserFileSystemFileHandle = BrowserFileSystemHandle & {
  kind: "file";
  getFile: () => Promise<File>;
};

type BrowserFileSystemDirectoryHandle = BrowserFileSystemHandle & {
  kind: "directory";
  values: () => AsyncIterableIterator<
    BrowserFileSystemFileHandle | BrowserFileSystemDirectoryHandle
  >;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<BrowserFileSystemDirectoryHandle>;
};

function nearestColorName(hex: string) {
  const palette = [
    { name: "Black", rgb: [0, 0, 0] },
    { name: "White", rgb: [255, 255, 255] },
    { name: "Grey", rgb: [128, 128, 128] },
    { name: "Red", rgb: [220, 38, 38] },
    { name: "Pink", rgb: [236, 72, 153] },
    { name: "Orange", rgb: [249, 115, 22] },
    { name: "Yellow", rgb: [234, 179, 8] },
    { name: "Green", rgb: [22, 163, 74] },
    { name: "Blue", rgb: [37, 99, 235] },
    { name: "Navy", rgb: [30, 58, 138] },
    { name: "Purple", rgb: [126, 34, 206] },
    { name: "Brown", rgb: [120, 72, 40] },
    { name: "Beige", rgb: [214, 190, 150] },
    { name: "Cream", rgb: [245, 235, 210] },
  ];

  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);

  return palette.reduce(
    (best, item) => {
      const distance =
        Math.pow(r - item.rgb[0], 2) +
        Math.pow(g - item.rgb[1], 2) +
        Math.pow(b - item.rgb[2], 2);

      return distance < best.distance ? { name: item.name, distance } : best;
    },
    { name: "Unknown", distance: Number.POSITIVE_INFINITY },
  ).name;
}

async function analyzeImage(file: File): Promise<ImageAnalysis> {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image could not be analyzed"));
      element.src = imageUrl;
    });

    const sampleSize = 64;
    const canvas = document.createElement("canvas");
    canvas.width = sampleSize;
    canvas.height = sampleSize;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is not available");

    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;

    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const alpha = pixels[index + 3];

      if (alpha < 150) continue;

      const brightness = (r + g + b) / 3;
      if (brightness > 245 || brightness < 12) continue;

      red += r;
      green += g;
      blue += b;
      count += 1;
    }

    const safeCount = Math.max(count, 1);
    const averageRed = Math.round(red / safeCount);
    const averageGreen = Math.round(green / safeCount);
    const averageBlue = Math.round(blue / safeCount);

    const dominantColor = `#${[averageRed, averageGreen, averageBlue]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;

    const greyValues: number[] = [];
    for (let index = 0; index < pixels.length; index += 4) {
      greyValues.push(
        pixels[index] * 0.299 +
          pixels[index + 1] * 0.587 +
          pixels[index + 2] * 0.114,
      );
    }

    const laplacianValues: number[] = [];
    for (let y = 1; y < sampleSize - 1; y += 1) {
      for (let x = 1; x < sampleSize - 1; x += 1) {
        const current = greyValues[y * sampleSize + x];
        const laplacian =
          greyValues[(y - 1) * sampleSize + x] +
          greyValues[(y + 1) * sampleSize + x] +
          greyValues[y * sampleSize + x - 1] +
          greyValues[y * sampleSize + x + 1] -
          4 * current;

        laplacianValues.push(laplacian);
      }
    }

    const average =
      laplacianValues.reduce((sum, value) => sum + value, 0) /
      Math.max(laplacianValues.length, 1);

    const blurScore =
      laplacianValues.reduce(
        (sum, value) => sum + Math.pow(value - average, 2),
        0,
      ) / Math.max(laplacianValues.length, 1);

    const lowResolution = image.width < 800 || image.height < 800;
    const blurry = blurScore < 35;

    let quality: ImageAnalysis["quality"] = "Good";
    if (lowResolution && blurry) quality = "Needs Review";
    else if (lowResolution) quality = "Low Resolution";
    else if (blurry) quality = "Blurry";

    return {
      dominantColor,
      colorName: nearestColorName(dominantColor),
      width: image.width,
      height: image.height,
      blurScore: Math.round(blurScore),
      quality,
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

const MAX_FILES = 10000;
const CONCURRENCY = 3;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function collectImagesFromDirectory(
  directory: BrowserFileSystemDirectoryHandle,
  output: File[],
) {
  for await (const handle of directory.values()) {
    if (output.length >= MAX_FILES) return;

    if (handle.kind === "directory") {
      await collectImagesFromDirectory(handle, output);
      continue;
    }

    const file = await handle.getFile();

    if (/\.(jpe?g|png|webp)$/i.test(file.name)) {
      output.push(file);
    }
  }
}

const SIZE_ORDER = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
  "7XL",
  "8XL",
];

function stripExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

function normalizeSize(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^XXL$/, "2XL")
    .replace(/^XXXL$/, "3XL")
    .replace(/^XXXXL$/, "4XL");
}

function expandSizes(sizeText: string) {
  const cleaned = sizeText
    .replace(/\s+/g, " ")
    .replace(/\bTO\b/gi, "to")
    .trim();

  const rangeMatch = cleaned.match(
    /^(XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL|7XL|8XL|XXL|XXXL|XXXXL)\s*to\s*(XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL|7XL|8XL|XXL|XXXL|XXXXL)$/i,
  );

  if (rangeMatch) {
    const start = normalizeSize(rangeMatch[1]);
    const end = normalizeSize(rangeMatch[2]);
    const startIndex = SIZE_ORDER.indexOf(start);
    const endIndex = SIZE_ORDER.indexOf(end);

    if (startIndex >= 0 && endIndex >= startIndex) {
      return SIZE_ORDER.slice(startIndex, endIndex + 1);
    }
  }

  return cleaned
    .split(/[,/|]+/)
    .map(normalizeSize)
    .filter((size, index, all) => size && all.indexOf(size) === index);
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

  return (
    knownFabrics.find((fabric) =>
      new RegExp(`\\b${fabric}\\b`, "i").test(fabricDetail),
    ) || fabricDetail.trim()
  );
}

async function convertToWebP(file: File): Promise<File> {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error(`${file.name}: image could not be converted`));
      element.src = imageUrl;
    });

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(`${file.name}: browser image converter is unavailable`);
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error(`${file.name}: WebP conversion failed`));
        },
        "image/webp",
        0.75,
      );
    });

    const webpName = `${stripExtension(file.name)}.webp`;

    return new File([blob], webpName, {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function parseFile(
  file: File,
  allowSkuOnly = false,
): ParsedFile | InvalidFile {
  const validExtension = /\.(jpe?g|png|webp)$/i.test(file.name);

  if (!validExtension) {
    return { file, reason: "Only JPG, PNG and WEBP are allowed" };
  }

  if (file.size > 20 * 1024 * 1024) {
    return { file, reason: "File is larger than 20 MB" };
  }

  const baseName = stripExtension(file.name).trim();
  const coreMatch = baseName.match(
    /^([A-Za-z0-9_-]+)\s*-\s*(AED|QAR)\s+([0-9]+(?:\.[0-9]+)?)\s*\(([^)]+)\)/i,
  );

  if (coreMatch) {
    const sizeMatch = baseName.match(
      /\bSize\s*-\s*(.+?)(?=\s+Fabric\s*-|$)/i,
    );
    const fabricMatch = baseName.match(/\bFabric\s*-\s*(.+)$/i);
    const fabricDetail = fabricMatch?.[1]?.trim() || "";

    return {
      file,
      sku: coreMatch[1].toUpperCase(),
      currency: coreMatch[2].toUpperCase() as Currency,
      price: coreMatch[3],
      imageNumber: coreMatch[4].trim().padStart(2, "0"),
      sizes: sizeMatch ? expandSizes(sizeMatch[1]) : [],
      fabricDetail,
      mainFabric: fabricDetail ? getMainFabric(fabricDetail) : "",
      needsManualInfo: false,
    };
  }

  if (allowSkuOnly) {
    const skuMatch = baseName.match(/^([A-Za-z0-9_-]+)/);

    if (skuMatch) {
      const imageNumberMatch = baseName.match(/\(([^)]+)\)/);

      return {
        file,
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
  }

  return {
    file,
    reason:
      "Expected: SKU - AED/QAR Price (Image No) Size - ... Fabric - ...",
  };
}

function isParsedFile(item: ParsedFile | InvalidFile): item is ParsedFile {
  return "sku" in item;
}

export default function R2BulkUploadPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const uploadLockRef = useRef(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const [message, setMessage] = useState("");
  const [uploadFinished, setUploadFinished] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisBySku, setAnalysisBySku] = useState<
    Record<string, ImageAnalysis>
  >({});
  const [allowSkuOnly, setAllowSkuOnly] = useState(false);
  const [selectingFolder, setSelectingFolder] = useState(false);

  const parsed = useMemo(
    () => selectedFiles.map((file) => parseFile(file, allowSkuOnly)),
    [selectedFiles, allowSkuOnly],
  );

  const validFiles = useMemo(
    () => parsed.filter(isParsedFile),
    [parsed],
  );

  const invalidFiles = useMemo(
    () => parsed.filter((item): item is InvalidFile => !isParsedFile(item)),
    [parsed],
  );

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        sku: string;
        AED: ParsedFile[];
        QAR: ParsedFile[];
        PENDING: ParsedFile[];
      }
    >();

    for (const item of validFiles) {
      if (!map.has(item.sku)) {
        map.set(item.sku, {
          sku: item.sku,
          AED: [],
          QAR: [],
          PENDING: [],
        });
      }

      map.get(item.sku)![item.currency].push(item);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.sku.localeCompare(b.sku),
    );
  }, [validFiles]);

  function addFiles(files: File[]) {
    if (uploading || uploadFinished) return;

    const imageFiles = files.filter((file) =>
      /\.(jpe?g|png|webp)$/i.test(file.name),
    );

    setMessage("");
    setStatuses([]);
    setAnalysisBySku({});

    setSelectedFiles((current) => {
      const seen = new Set(
        current.map(
          (file) => `${file.name}-${file.size}-${file.lastModified}`,
        ),
      );

      let duplicates = 0;

      const unique = imageFiles.filter((file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;

        if (seen.has(key)) {
          duplicates += 1;
          return false;
        }

        seen.add(key);
        return true;
      });

      if (duplicates > 0) {
        setDuplicateCount((count) => count + duplicates);
      }

      const combined = [...current, ...unique];

      if (combined.length > MAX_FILES) {
        setMessage(
          `Maximum ${MAX_FILES} files allowed. Extra files were not added.`,
        );
      }

      return combined.slice(0, MAX_FILES);
    });
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function handleFolderInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  async function selectFolder() {
    if (uploading || uploadFinished || selectingFolder) return;

    const pickerWindow = window as unknown as DirectoryPickerWindow;

    if (!pickerWindow.showDirectoryPicker) {
      folderInputRef.current?.click();
      return;
    }

    setSelectingFolder(true);
    setMessage("");

    try {
      const directory = await pickerWindow.showDirectoryPicker();
      const files: File[] = [];

      await collectImagesFromDirectory(directory, files);

      if (files.length === 0) {
        setMessage(
          "Selected folder aur uske subfolders mein JPG, PNG ya WebP images nahi milin.",
        );
        return;
      }

      addFiles(files);

      if (files.length >= MAX_FILES) {
        setMessage(
          `Maximum ${MAX_FILES} images load ki gayi hain. Extra images skip ho gayi.`,
        );
      }
    } catch (error) {
      const errorName =
        error instanceof DOMException ? error.name : "";

      if (errorName !== "AbortError") {
        setMessage(
          error instanceof Error
            ? `Folder open nahi hua: ${error.message}`
            : "Folder open nahi hua.",
        );
      }
    } finally {
      setSelectingFolder(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files || []));
  }

  function removeFile(file: File) {
    setSelectedFiles((current) =>
      current.filter(
        (item) =>
          !(
            item.name === file.name &&
            item.size === file.size &&
            item.lastModified === file.lastModified
          ),
      ),
    );
  }

  async function uploadOne(item: ParsedFile, index: number) {
    setStatuses((current) =>
      current.map((status, statusIndex) =>
        statusIndex === index
          ? { ...status, status: "uploading" }
          : status,
      ),
    );

    try {
      const webpFile = await convertToWebP(item.file);
      const formData = new FormData();
      formData.append("file", webpFile);
      if (item.needsManualInfo) {
        formData.append("allowSkuOnly", "1");
      }

      const response = await fetch("/api/r2/upload", {
        method: "POST",
        body: formData,
      });

      const result = (await response.json()) as UploadResult;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Upload failed");
      }

      setStatuses((current) =>
        current.map((status, statusIndex) =>
          statusIndex === index
            ? {
                ...status,
                status: "success",
                message: item.needsManualInfo
                  ? `${item.sku}/PENDING/manual info required`
                  : `${item.sku}/${item.currency}/${item.imageNumber}`,
              }
            : status,
        ),
      );

      return true;
    } catch (error) {
      setStatuses((current) =>
        current.map((status, statusIndex) =>
          statusIndex === index
            ? {
                ...status,
                status: "failed",
                message:
                  error instanceof Error ? error.message : "Upload failed",
              }
            : status,
        ),
      );

      return false;
    }
  }

  async function analyzeSelectedProducts() {
    if (groups.length === 0 || analyzing || uploading) return;

    setAnalyzing(true);

    try {
      const results: Record<string, ImageAnalysis> = {};

      for (const group of groups) {
        const representative = group.AED[0] || group.QAR[0];
        if (!representative) continue;

        try {
          results[group.sku] = await analyzeImage(representative.file);
        } catch {
          // Skip unreadable image and continue with the remaining SKUs.
        }
      }

      setAnalysisBySku(results);
    } finally {
      setAnalyzing(false);
    }
  }

  async function startUpload() {
    if (
      validFiles.length === 0 ||
      uploading ||
      uploadFinished ||
      uploadLockRef.current
    ) {
      return;
    }

    uploadLockRef.current = true;
    setUploading(true);
    setUploadFinished(false);
    setMessage("");
    setStatuses(
      validFiles.map((item) => ({
        name: item.file.name,
        status: "pending",
      })),
    );

    let nextIndex = 0;
    let successful = 0;

    async function worker() {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= validFiles.length) return;

        const ok = await uploadOne(validFiles[index], index);
        if (ok) successful += 1;
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, validFiles.length) },
        () => worker(),
      ),
    );

    setUploading(false);
    uploadLockRef.current = false;
    setUploadFinished(true);
    setMessage(
      `${successful} of ${validFiles.length} images uploaded successfully.`,
    );
  }

  const completedCount = statuses.filter(
    (item) => item.status === "success" || item.status === "failed",
  ).length;

  const progress =
    statuses.length > 0
      ? Math.round((completedCount / statuses.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black text-emerald-700">
          Cloudflare R2
        </p>
        <h1 className="mt-1 text-3xl font-black text-slate-950">
          Smart Bulk Upload
        </h1>
        <p className="mt-1 text-sm font-bold text-slate-500">
          Mixed SKU, AED aur QAR images upload karo. ERP har image ko WebP
          mein convert karke SKU, price, image number, sizes aur fabric read karega.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div
          onDragOver={(event) => event.preventDefault()}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && !uploadFinished && inputRef.current?.click()}
          className={[
            "cursor-pointer rounded-3xl border-2 border-dashed p-10 text-center transition",
            dragging
              ? "border-emerald-500 bg-emerald-50"
              : "border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/60",
            uploading || uploadFinished ? "pointer-events-none opacity-60" : "",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            multiple
            className="hidden"
            onChange={handleInput}
          />

          <input
            ref={folderInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            multiple
            {...({
              webkitdirectory: "",
              directory: "",
            } as {
              webkitdirectory: string;
              directory: string;
            })}
            className="hidden"
            onChange={handleFolderInput}
          />

          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CloudUpload size={32} />
          </div>

          <p className="mt-4 text-lg font-black text-slate-900">
            100+ mixed images yahan drop karo
          </p>
          <p className="mt-1 text-sm font-bold text-slate-500">
            JPG, PNG aur WebP sab R2 mein optimized WebP ban kar save honge
          </p>
          <p className="mt-3 text-xs font-black text-slate-400">
            LRN9568 - AED 69 (01) Size - S to 3XL Fabric - Slub Cotton
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              disabled={uploading || uploadFinished}
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current?.click();
              }}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Select Images
            </button>

            <button
              type="button"
              disabled={uploading || uploadFinished || selectingFolder}
              onClick={(event) => {
                event.stopPropagation();
                void selectFolder();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {selectingFolder && (
                <Loader2 size={16} className="animate-spin" />
              )}
              {selectingFolder ? "Opening Folder..." : "Select Folder"}
            </button>
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <input
            type="checkbox"
            checked={allowSkuOnly}
            disabled={uploading || uploadFinished}
            onChange={(event) => setAllowSkuOnly(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block font-black text-amber-900">
              Upload unrecognized files as SKU only
            </span>
            <span className="mt-1 block text-xs font-bold text-amber-700">
              Filename ke start se SKU read hoga. Image PENDING folder mein save
              hogi aur baqi product information gallery mein manual add karni hogi.
            </span>
          </span>
        </label>

        {selectedFiles.length > 0 && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-black uppercase text-slate-400">
                Selected
              </p>
              <p className="mt-1 text-3xl font-black text-slate-950">
                {selectedFiles.length}
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-xs font-black uppercase text-emerald-600">
                Valid
              </p>
              <p className="mt-1 text-3xl font-black text-emerald-900">
                {validFiles.length}
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 p-4">
              <p className="text-xs font-black uppercase text-blue-600">
                SKUs
              </p>
              <p className="mt-1 text-3xl font-black text-blue-900">
                {groups.length}
              </p>
            </div>
            <div className="rounded-2xl bg-red-50 p-4">
              <p className="text-xs font-black uppercase text-red-600">
                Invalid
              </p>
              <p className="mt-1 text-3xl font-black text-red-900">
                {invalidFiles.length}
              </p>
            </div>
          </div>
        )}

        {duplicateCount > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-black text-amber-800">
            {duplicateCount} duplicate file(s) skipped.
          </div>
        )}

        {groups.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-black text-slate-950">
                <Images size={19} />
                Folder Preview
              </h2>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={uploading || analyzing || uploadFinished}
                  onClick={analyzeSelectedProducts}
                  className="inline-flex items-center gap-2 text-sm font-black text-emerald-700 disabled:opacity-40"
                >
                  {analyzing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Images size={16} />
                  )}
                  {analyzing ? "Analyzing..." : "Analyze Images"}
                </button>

                <button
                  type="button"
                  disabled={uploading || uploadFinished}
                  onClick={() => {
                    setSelectedFiles([]);
                    setStatuses([]);
                    setMessage("");
                    setDuplicateCount(0);
                    setAnalysisBySku({});
                  }}
                  className="inline-flex items-center gap-2 text-sm font-black text-red-600 disabled:opacity-40"
                >
                  <Trash2 size={16} />
                  Clear All
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {groups.map((group) => (
                <div
                  key={group.sku}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <p className="text-lg font-black text-slate-950">
                    products/{group.sku}/
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {(["AED", "QAR", "PENDING"] as UploadGroup[]).map((currency) => {
                      const items = group[currency];
                      const first = items[0];

                      return (
                        <div
                          key={currency}
                          className={
                            currency === "AED"
                              ? "rounded-xl bg-emerald-50 p-3"
                              : currency === "QAR"
                                ? "rounded-xl bg-blue-50 p-3"
                                : "rounded-xl border border-amber-200 bg-amber-50 p-3"
                          }
                        >
                          <p
                            className={
                              currency === "AED"
                                ? "font-black text-emerald-800"
                                : currency === "QAR"
                                  ? "font-black text-blue-800"
                                  : "font-black text-amber-800"
                            }
                          >
                            {currency}
                          </p>
                          <p className="text-sm font-bold text-slate-700">
                            {items.length} image(s)
                          </p>
                          {first && (
                            first.needsManualInfo ? (
                              <p className="mt-1 text-xs font-black text-amber-700">
                                Manual information required
                              </p>
                            ) : (
                              <>
                                <p className="mt-1 text-xs font-bold text-slate-600">
                                  Price: {currency} {first.price}
                                </p>
                                <p className="text-xs font-bold text-slate-600">
                                  Sizes: {first.sizes.join(", ") || "Not found"}
                                </p>
                                <p className="text-xs font-bold text-slate-600">
                                  Fabric: {first.mainFabric || "Not found"}
                                </p>
                              </>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {analysisBySku[group.sku] && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-black uppercase text-slate-400">
                        Free Image Analysis
                      </p>

                      <div className="mt-2 grid gap-2 text-xs font-bold text-slate-700 sm:grid-cols-2">
                        <p className="flex items-center gap-2">
                          <span
                            className="h-4 w-4 rounded-full border border-slate-300"
                            style={{
                              backgroundColor:
                                analysisBySku[group.sku].dominantColor,
                            }}
                          />
                          Color: {analysisBySku[group.sku].colorName} (
                          {analysisBySku[group.sku].dominantColor})
                        </p>

                        <p>
                          Resolution: {analysisBySku[group.sku].width} Ã—{" "}
                          {analysisBySku[group.sku].height}
                        </p>

                        <p>
                          Quality: {analysisBySku[group.sku].quality}
                        </p>

                        <p>
                          Sharpness Score: {analysisBySku[group.sku].blurScore}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {invalidFiles.length > 0 && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <h2 className="flex items-center gap-2 font-black text-red-900">
              <AlertTriangle size={19} />
              Unrecognized Files
            </h2>

            <div className="mt-3 space-y-2">
              {invalidFiles.map((item) => (
                <div
                  key={`${item.file.name}-${item.file.lastModified}`}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-900">
                      {item.file.name}
                    </p>
                    <p className="text-xs font-bold text-red-600">
                      {item.reason}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => removeFile(item.file)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-100 text-red-700"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {statuses.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex justify-between text-sm font-black">
              <span className="text-slate-700">
                {uploading ? "Uploading to R2..." : "Upload complete"}
              </span>
              <span className="text-emerald-700">{progress}%</span>
            </div>

            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {message && (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-black text-emerald-800">
            <CheckCircle2 size={20} />
            {message}
          </div>
        )}

        {uploadFinished && (
          <button
            type="button"
            onClick={() => {
              setSelectedFiles([]);
              setStatuses([]);
              setMessage("");
              setUploadFinished(false);
              setDuplicateCount(0);
              setAnalysisBySku({});
              uploadLockRef.current = false;
            }}
            className="mt-4 inline-flex h-12 items-center justify-center rounded-2xl bg-blue-600 px-6 text-sm font-black text-white hover:bg-blue-700"
          >
            New Upload
          </button>
        )}

        <button
          type="button"
          onClick={startUpload}
          disabled={uploading || uploadFinished || validFiles.length === 0}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {uploading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <CloudUpload size={18} />
          )}
          {uploading ? "Uploading..." : `Upload ${validFiles.length} Valid Images`}
        </button>
      </div>

      {validFiles.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="font-black text-slate-950">
            Extracted Product Data
          </h2>

          <div className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto">
            {validFiles.map((item) => (
              <div
                key={`${item.file.name}-${item.file.lastModified}`}
                className="flex flex-col justify-between gap-3 rounded-xl bg-slate-50 p-4 lg:flex-row lg:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-900">
                    {item.file.name}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    SKU: {item.sku} Â· {item.needsManualInfo
                      ? "Pending manual information"
                      : `Currency: ${item.currency} Â· Price: ${item.price} Â· Image: ${item.imageNumber}`}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {item.needsManualInfo
                      ? "This image will be stored separately under PENDING."
                      : `Sizes: ${item.sizes.join(", ") || "Not found"} Â· Fabric Detail: ${item.fabricDetail || "Not found"} Â· Main Fabric: ${item.mainFabric || "Not found"}`}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => removeFile(item.file)}
                  className="self-end text-red-600 disabled:opacity-40 lg:self-auto"
                >
                  <X size={17} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

