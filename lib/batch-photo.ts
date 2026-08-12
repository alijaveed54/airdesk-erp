export type BatchPhotoFormat =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export type FitMode =
  | "contain"
  | "cover"
  | "stretch";

export type WatermarkPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type BatchPhotoSettings = {
  width: number;
  height: number;
  fitMode: FitMode;
  backgroundColor: string;
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  sepia: number;
  autoTrim: boolean;
  trimTolerance: number;
  trimPadding: number;
  canvasPadding: number;
  borderWidth: number;
  borderColor: string;
  watermarkText: string;
  watermarkTextColor: string;
  watermarkOpacity: number;
  watermarkTextSize: number;
  watermarkLogoSize: number;
  watermarkMargin: number;
  watermarkPosition: WatermarkPosition;
  format: BatchPhotoFormat;
  quality: number;
  renamePattern: string;
};

export type BatchPhotoSource = {
  id: string;
  file: File;
  name: string;
  objectUrl: string;
  width: number;
  height: number;
  selected: boolean;
};

export type BatchPhotoOutput = {
  id: string;
  sourceId: string;
  name: string;
  blob: Blob;
  objectUrl: string;
  width: number;
  height: number;
  size: number;
};

type ProcessOptions = {
  index: number;
  logoBitmap?: ImageBitmap | null;
  previewMaxSide?: number;
};

export const DEFAULT_BATCH_PHOTO_SETTINGS: BatchPhotoSettings = {
  width: 0,
  height: 0,
  fitMode: "contain",
  backgroundColor: "#ffffff",
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0,
  sepia: 0,
  autoTrim: false,
  trimTolerance: 12,
  trimPadding: 2,
  canvasPadding: 0,
  borderWidth: 0,
  borderColor: "#000000",
  watermarkText: "",
  watermarkTextColor: "#ffffff",
  watermarkOpacity: 75,
  watermarkTextSize: 4,
  watermarkLogoSize: 18,
  watermarkMargin: 3,
  watermarkPosition: "bottom-right",
  format: "image/jpeg",
  quality: 88,
  renamePattern: "{original}",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function extensionForFormat(format: BatchPhotoFormat) {
  if (format === "image/png") return "png";
  if (format === "image/webp") return "webp";
  return "jpg";
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, 180);
}

function dateStamp() {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function outputName({
  source,
  settings,
  index,
  width,
  height,
}: {
  source: BatchPhotoSource;
  settings: BatchPhotoSettings;
  index: number;
  width: number;
  height: number;
}) {
  const original = baseName(source.name);
  const pattern =
    settings.renamePattern.trim() || "{original}";

  const resolved = pattern
    .replaceAll("{original}", original)
    .replaceAll("{index}", String(index).padStart(3, "0"))
    .replaceAll("{date}", dateStamp())
    .replaceAll("{width}", String(width))
    .replaceAll("{height}", String(height));

  const clean = safeFileName(resolved) || original || "image";

  return `${clean}.${extensionForFormat(settings.format)}`;
}

export async function loadBitmap(blob: Blob) {
  return createImageBitmap(blob, {
    imageOrientation: "from-image",
  });
}

export async function createBatchPhotoSource(
  file: File,
): Promise<BatchPhotoSource> {
  const bitmap = await loadBitmap(file);

  try {
    return {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      objectUrl: URL.createObjectURL(file),
      width: bitmap.width,
      height: bitmap.height,
      selected: true,
    };
  } finally {
    bitmap.close();
  }
}

export function releaseBatchPhotoSource(
  source: BatchPhotoSource,
) {
  URL.revokeObjectURL(source.objectUrl);
}

export function releaseBatchPhotoOutput(
  output: BatchPhotoOutput,
) {
  URL.revokeObjectURL(output.objectUrl);
}

function orientedCanvas({
  bitmap,
  settings,
}: {
  bitmap: ImageBitmap;
  settings: BatchPhotoSettings;
}) {
  const quarterTurn =
    settings.rotation === 90 ||
    settings.rotation === 270;

  const canvas = document.createElement("canvas");
  canvas.width = quarterTurn
    ? bitmap.height
    : bitmap.width;
  canvas.height = quarterTurn
    ? bitmap.width
    : bitmap.height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Browser canvas is unavailable");
  }

  context.translate(
    canvas.width / 2,
    canvas.height / 2,
  );
  context.rotate(
    (settings.rotation * Math.PI) / 180,
  );
  context.scale(
    settings.flipHorizontal ? -1 : 1,
    settings.flipVertical ? -1 : 1,
  );
  context.drawImage(
    bitmap,
    -bitmap.width / 2,
    -bitmap.height / 2,
  );

  return canvas;
}


function averageCornerColor(
  imageData: ImageData,
  width: number,
  height: number,
) {
  const patch = Math.max(
    2,
    Math.min(
      12,
      Math.round(Math.min(width, height) * 0.015),
    ),
  );

  const corners = [
    [0, 0],
    [Math.max(0, width - patch), 0],
    [0, Math.max(0, height - patch)],
    [
      Math.max(0, width - patch),
      Math.max(0, height - patch),
    ],
  ];

  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + patch; y += 1) {
      for (let x = startX; x < startX + patch; x += 1) {
        const offset = (y * width + x) * 4;

        red += imageData.data[offset];
        green += imageData.data[offset + 1];
        blue += imageData.data[offset + 2];
        alpha += imageData.data[offset + 3];
        count += 1;
      }
    }
  }

  return {
    red: red / Math.max(1, count),
    green: green / Math.max(1, count),
    blue: blue / Math.max(1, count),
    alpha: alpha / Math.max(1, count),
  };
}

function autoTrimCanvas({
  source,
  tolerance,
  paddingPercent,
}: {
  source: HTMLCanvasElement;
  tolerance: number;
  paddingPercent: number;
}) {
  const maximumDetectionSide = 1600;
  const scale = Math.min(
    1,
    maximumDetectionSide /
      Math.max(source.width, source.height),
  );

  const detection = document.createElement("canvas");
  detection.width = Math.max(
    1,
    Math.round(source.width * scale),
  );
  detection.height = Math.max(
    1,
    Math.round(source.height * scale),
  );

  const context = detection.getContext("2d", {
    willReadFrequently: true,
  });

  if (!context) {
    return source;
  }

  context.drawImage(
    source,
    0,
    0,
    detection.width,
    detection.height,
  );

  let pixels: ImageData;

  try {
    pixels = context.getImageData(
      0,
      0,
      detection.width,
      detection.height,
    );
  } catch {
    return source;
  }

  const background = averageCornerColor(
    pixels,
    detection.width,
    detection.height,
  );

  // 0–100 UI tolerance is mapped to the maximum RGB distance.
  const threshold =
    clamp(tolerance, 0, 100) * 4.42;

  let minimumX = detection.width;
  let minimumY = detection.height;
  let maximumX = -1;
  let maximumY = -1;

  for (let y = 0; y < detection.height; y += 1) {
    for (let x = 0; x < detection.width; x += 1) {
      const offset =
        (y * detection.width + x) * 4;
      const alpha = pixels.data[offset + 3];

      if (alpha <= 5) continue;

      const redDifference =
        pixels.data[offset] - background.red;
      const greenDifference =
        pixels.data[offset + 1] - background.green;
      const blueDifference =
        pixels.data[offset + 2] - background.blue;
      const alphaDifference =
        alpha - background.alpha;

      const distance = Math.sqrt(
        redDifference * redDifference +
          greenDifference * greenDifference +
          blueDifference * blueDifference +
          alphaDifference * alphaDifference * 0.15,
      );

      if (distance <= threshold) continue;

      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }

  if (
    maximumX < minimumX ||
    maximumY < minimumY
  ) {
    return source;
  }

  const detectedWidth =
    maximumX - minimumX + 1;
  const detectedHeight =
    maximumY - minimumY + 1;

  // Avoid tiny/noisy crops and avoid rebuilding when almost nothing changes.
  if (
    detectedWidth < 4 ||
    detectedHeight < 4 ||
    (detectedWidth >= detection.width * 0.985 &&
      detectedHeight >= detection.height * 0.985)
  ) {
    return source;
  }

  const padding = Math.round(
    Math.max(detectedWidth, detectedHeight) *
      (clamp(paddingPercent, 0, 30) / 100),
  );

  minimumX = Math.max(0, minimumX - padding);
  minimumY = Math.max(0, minimumY - padding);
  maximumX = Math.min(
    detection.width - 1,
    maximumX + padding,
  );
  maximumY = Math.min(
    detection.height - 1,
    maximumY + padding,
  );

  const sourceX = Math.max(
    0,
    Math.floor(minimumX / scale),
  );
  const sourceY = Math.max(
    0,
    Math.floor(minimumY / scale),
  );
  const sourceWidth = Math.min(
    source.width - sourceX,
    Math.ceil(
      (maximumX - minimumX + 1) / scale,
    ),
  );
  const sourceHeight = Math.min(
    source.height - sourceY,
    Math.ceil(
      (maximumY - minimumY + 1) / scale,
    ),
  );

  if (sourceWidth < 2 || sourceHeight < 2) {
    return source;
  }

  const trimmed = document.createElement("canvas");
  trimmed.width = sourceWidth;
  trimmed.height = sourceHeight;

  const trimmedContext = trimmed.getContext("2d");

  if (!trimmedContext) {
    return source;
  }

  trimmedContext.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  return trimmed;
}

function resolveOutputSize({
  sourceWidth,
  sourceHeight,
  settings,
  previewMaxSide,
}: {
  sourceWidth: number;
  sourceHeight: number;
  settings: BatchPhotoSettings;
  previewMaxSide?: number;
}) {
  let width =
    settings.width > 0
      ? Math.round(settings.width)
      : sourceWidth;
  let height =
    settings.height > 0
      ? Math.round(settings.height)
      : sourceHeight;

  width = clamp(width, 1, 12000);
  height = clamp(height, 1, 12000);

  if (
    previewMaxSide &&
    Math.max(width, height) > previewMaxSide
  ) {
    const scale =
      previewMaxSide / Math.max(width, height);

    width = Math.max(1, Math.round(width * scale));
    height = Math.max(
      1,
      Math.round(height * scale),
    );
  }

  return { width, height };
}

function drawBaseImage({
  source,
  target,
  settings,
}: {
  source: HTMLCanvasElement;
  target: CanvasRenderingContext2D;
  settings: BatchPhotoSettings;
}) {
  const canvas = target.canvas;
  const reference = Math.min(
    canvas.width,
    canvas.height,
  );
  const borderPixels =
    reference *
    (clamp(settings.borderWidth, 0, 20) / 100);
  const paddingPixels =
    reference *
    (clamp(settings.canvasPadding, 0, 40) / 100);

  const contentX = borderPixels + paddingPixels;
  const contentY = borderPixels + paddingPixels;
  const contentWidth = Math.max(
    1,
    canvas.width -
      2 * (borderPixels + paddingPixels),
  );
  const contentHeight = Math.max(
    1,
    canvas.height -
      2 * (borderPixels + paddingPixels),
  );

  target.save();
  target.fillStyle =
    settings.backgroundColor || "#ffffff";
  target.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  target.beginPath();
  target.rect(
    contentX,
    contentY,
    contentWidth,
    contentHeight,
  );
  target.clip();

  target.filter = [
    `brightness(${clamp(
      settings.brightness,
      0,
      200,
    )}%)`,
    `contrast(${clamp(
      settings.contrast,
      0,
      200,
    )}%)`,
    `saturate(${clamp(
      settings.saturation,
      0,
      200,
    )}%)`,
    `grayscale(${clamp(
      settings.grayscale,
      0,
      100,
    )}%)`,
    `sepia(${clamp(
      settings.sepia,
      0,
      100,
    )}%)`,
  ].join(" ");

  if (settings.fitMode === "stretch") {
    target.drawImage(
      source,
      contentX,
      contentY,
      contentWidth,
      contentHeight,
    );
    target.restore();
    return;
  }

  const scaleX = contentWidth / source.width;
  const scaleY = contentHeight / source.height;
  const scale =
    settings.fitMode === "cover"
      ? Math.max(scaleX, scaleY)
      : Math.min(scaleX, scaleY);

  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  const x =
    contentX + (contentWidth - drawWidth) / 2;
  const y =
    contentY + (contentHeight - drawHeight) / 2;

  target.drawImage(
    source,
    x,
    y,
    drawWidth,
    drawHeight,
  );
  target.restore();
}

function drawCanvasBorder({
  context,
  settings,
}: {
  context: CanvasRenderingContext2D;
  settings: BatchPhotoSettings;
}) {
  const reference = Math.min(
    context.canvas.width,
    context.canvas.height,
  );
  const borderPixels =
    reference *
    (clamp(settings.borderWidth, 0, 20) / 100);

  if (borderPixels <= 0) return;

  context.save();
  context.strokeStyle =
    settings.borderColor || "#000000";
  context.lineWidth = borderPixels;
  context.strokeRect(
    borderPixels / 2,
    borderPixels / 2,
    context.canvas.width - borderPixels,
    context.canvas.height - borderPixels,
  );
  context.restore();
}

function positionFor({
  position,
  canvasWidth,
  canvasHeight,
  itemWidth,
  itemHeight,
  margin,
}: {
  position: WatermarkPosition;
  canvasWidth: number;
  canvasHeight: number;
  itemWidth: number;
  itemHeight: number;
  margin: number;
}) {
  const left = margin;
  const centerX =
    (canvasWidth - itemWidth) / 2;
  const right =
    canvasWidth - itemWidth - margin;

  const top = margin;
  const centerY =
    (canvasHeight - itemHeight) / 2;
  const bottom =
    canvasHeight - itemHeight - margin;

  const horizontal = position.endsWith("left")
    ? left
    : position.endsWith("right")
      ? right
      : centerX;

  const vertical = position.startsWith("top")
    ? top
    : position.startsWith("bottom")
      ? bottom
      : centerY;

  return {
    x: horizontal,
    y: vertical,
  };
}

function drawTextWatermark({
  context,
  settings,
}: {
  context: CanvasRenderingContext2D;
  settings: BatchPhotoSettings;
}) {
  const text = settings.watermarkText.trim();

  if (!text) return;

  const canvas = context.canvas;
  const reference = Math.min(
    canvas.width,
    canvas.height,
  );
  const fontSize = Math.max(
    12,
    Math.round(
      reference *
        (clamp(
          settings.watermarkTextSize,
          1,
          20,
        ) /
          100),
    ),
  );
  const margin =
    reference *
    (clamp(settings.watermarkMargin, 0, 20) /
      100);

  context.save();
  context.globalAlpha =
    clamp(settings.watermarkOpacity, 0, 100) /
    100;
  context.font = `900 ${fontSize}px Arial, sans-serif`;
  context.textBaseline = "top";
  context.fillStyle =
    settings.watermarkTextColor || "#ffffff";
  context.shadowColor = "rgba(0,0,0,0.65)";
  context.shadowBlur = Math.max(
    2,
    Math.round(fontSize * 0.12),
  );
  context.shadowOffsetX = Math.max(
    1,
    Math.round(fontSize * 0.04),
  );
  context.shadowOffsetY = Math.max(
    1,
    Math.round(fontSize * 0.04),
  );

  const metrics = context.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize * 1.15;
  const position = positionFor({
    position: settings.watermarkPosition,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    itemWidth: textWidth,
    itemHeight: textHeight,
    margin,
  });

  context.fillText(
    text,
    position.x,
    position.y,
  );
  context.restore();
}

function drawLogoWatermark({
  context,
  settings,
  logoBitmap,
}: {
  context: CanvasRenderingContext2D;
  settings: BatchPhotoSettings;
  logoBitmap?: ImageBitmap | null;
}) {
  if (!logoBitmap) return;

  const canvas = context.canvas;
  const width =
    canvas.width *
    (clamp(settings.watermarkLogoSize, 2, 80) /
      100);
  const height =
    width *
    (logoBitmap.height / logoBitmap.width);
  const reference = Math.min(
    canvas.width,
    canvas.height,
  );
  const margin =
    reference *
    (clamp(settings.watermarkMargin, 0, 20) /
      100);

  const position = positionFor({
    position: settings.watermarkPosition,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    itemWidth: width,
    itemHeight: height,
    margin,
  });

  context.save();
  context.globalAlpha =
    clamp(settings.watermarkOpacity, 0, 100) /
    100;
  context.drawImage(
    logoBitmap,
    position.x,
    position.y,
    width,
    height,
  );
  context.restore();
}

function canvasToBlob({
  canvas,
  format,
  quality,
}: {
  canvas: HTMLCanvasElement;
  format: BatchPhotoFormat;
  quality: number;
}) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(
            new Error(
              "Browser could not create the processed image",
            ),
          );
        }
      },
      format,
      clamp(quality, 1, 100) / 100,
    );
  });
}

export async function processBatchPhoto({
  source,
  settings,
  options,
}: {
  source: BatchPhotoSource;
  settings: BatchPhotoSettings;
  options: ProcessOptions;
}): Promise<BatchPhotoOutput> {
  const bitmap = await loadBitmap(source.file);

  try {
    const oriented = orientedCanvas({
      bitmap,
      settings,
    });
    const preparedSource = settings.autoTrim
      ? autoTrimCanvas({
          source: oriented,
          tolerance: settings.trimTolerance,
          paddingPercent: settings.trimPadding,
        })
      : oriented;
    const size = resolveOutputSize({
      sourceWidth: preparedSource.width,
      sourceHeight: preparedSource.height,
      settings,
      previewMaxSide:
        options.previewMaxSide,
    });

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error(
        "Browser canvas is unavailable",
      );
    }

    drawBaseImage({
      source: preparedSource,
      target: context,
      settings,
    });

    drawCanvasBorder({
      context,
      settings,
    });

    drawLogoWatermark({
      context,
      settings,
      logoBitmap: options.logoBitmap,
    });

    drawTextWatermark({
      context,
      settings,
    });

    const blob = await canvasToBlob({
      canvas,
      format: settings.format,
      quality: settings.quality,
    });

    const name = outputName({
      source,
      settings,
      index: options.index,
      width: canvas.width,
      height: canvas.height,
    });

    return {
      id: crypto.randomUUID(),
      sourceId: source.id,
      name,
      blob,
      objectUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      size: blob.size,
    };
  } finally {
    bitmap.close();
  }
}

export function downloadBatchPhotoOutput(
  output: BatchPhotoOutput,
) {
  const anchor = document.createElement("a");

  anchor.href = output.objectUrl;
  anchor.download = output.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
