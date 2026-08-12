export type ProductCurrency = "AED" | "QAR";

export type FreeDeliveryBadgeSize =
  | "small"
  | "medium"
  | "large"
  | "xlarge";

export type ProductImageDetails = {
  sku: string;
  size: string;
  fabric: string;
  price: string;
  currencies: ProductCurrency[];
  quality: number;
  freeDeliveryEnabled: boolean;
  freeDeliveryBadgeSize: FreeDeliveryBadgeSize;
  leftBoxColor: string;
  rightBoxColor: string;
  textColor: string;
};

export type ProductImageSource = {
  id: string;
  file: File;
  name: string;
  relativePath: string;
  objectUrl: string;
  width: number;
  height: number;
};

export type ProductImageOutput = {
  id: string;
  sourceId: string;
  currency: ProductCurrency;
  name: string;
  blob: Blob;
  objectUrl: string;
  width: number;
  height: number;
  size: number;
};

export const DEFAULT_PRODUCT_IMAGE_DETAILS: ProductImageDetails = {
  sku: "",
  size: "",
  fabric: "",
  price: "",
  currencies: ["AED", "QAR"],
  quality: 92,
  freeDeliveryEnabled: false,
  freeDeliveryBadgeSize: "medium",
  leftBoxColor: "#f5acbd",
  rightBoxColor: "#c3c3c3",
  textColor: "#000000",
};

function clamp(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function safeFilePart(value: string) {
  return cleanText(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\.+$/g, "")
    .slice(0, 150);
}

function fitFontSize({
  context,
  text,
  maximumWidth,
  initialSize,
  minimumSize,
  weight = 700,
}: {
  context: CanvasRenderingContext2D;
  text: string;
  maximumWidth: number;
  initialSize: number;
  minimumSize: number;
  weight?: number;
}) {
  let size = initialSize;

  while (size > minimumSize) {
    context.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;

    if (
      context.measureText(text).width <=
      maximumWidth
    ) {
      return size;
    }

    size -= 1;
  }

  return minimumSize;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(
          new Error(
            "Browser could not generate the product image.",
          ),
        );
      },
      "image/jpeg",
      clamp(quality, 30, 100) / 100,
    );
  });
}

export async function loadProductBitmap(
  blob: Blob,
) {
  return createImageBitmap(blob, {
    imageOrientation: "from-image",
  });
}

export async function createProductImageSource(
  file: File,
): Promise<ProductImageSource> {
  const bitmap = await loadProductBitmap(file);

  try {
    return {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      relativePath:
        file.webkitRelativePath || file.name,
      objectUrl: URL.createObjectURL(file),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

export function releaseProductImageSource(
  source: ProductImageSource,
) {
  URL.revokeObjectURL(source.objectUrl);
}

export function releaseProductImageOutput(
  output: ProductImageOutput,
) {
  URL.revokeObjectURL(output.objectUrl);
}

function drawSampleStyleOverlay({
  context,
  details,
  currency,
}: {
  context: CanvasRenderingContext2D;
  details: ProductImageDetails;
  currency: ProductCurrency;
}) {
  const canvas = context.canvas;
  const widthScale = canvas.width / 1000;
  const heightScale = canvas.height / 1360;
  const balancedScale = Math.min(
    widthScale,
    heightScale,
  );

  const leftX = 0;
  const leftY = Math.round(
    canvas.height * (30 / 1360),
  );
  const leftWidth = Math.round(
    canvas.width * 0.388,
  );
  const leftHeight = Math.max(
    Math.round(canvas.height * (96 / 1360)),
    Math.round(92 * balancedScale),
  );

  const rightX = Math.round(
    canvas.width * 0.57,
  );
  const rightY = 0;
  const rightWidth = canvas.width - rightX;
  const rightHeight = Math.max(
    Math.round(canvas.height * (106 / 1360)),
    Math.round(102 * balancedScale),
  );

  context.save();

  context.fillStyle =
    details.leftBoxColor || "#f5acbd";
  context.fillRect(
    leftX,
    leftY,
    leftWidth,
    leftHeight,
  );

  context.fillStyle =
    details.rightBoxColor || "#c3c3c3";
  context.fillRect(
    rightX,
    rightY,
    rightWidth,
    rightHeight,
  );

  context.fillStyle =
    details.textColor || "#000000";
  context.textBaseline = "top";

  const leftPadding = Math.max(
    10,
    Math.round(23 * widthScale),
  );
  const leftMaximumWidth =
    leftWidth - leftPadding * 2;

  const headline = `${cleanText(
    details.sku,
  )} - ${currency} ${cleanText(details.price)}`;

  const sizeLine = `Size - ${cleanText(
    details.size,
  )}`;

  const headlineSize = fitFontSize({
    context,
    text: headline,
    maximumWidth: leftMaximumWidth,
    initialSize: Math.max(
      16,
      Math.round(32 * widthScale),
    ),
    minimumSize: Math.max(
      11,
      Math.round(16 * balancedScale),
    ),
    weight: 700,
  });

  context.font = `700 ${headlineSize}px Arial, Helvetica, sans-serif`;
  context.fillText(
    headline,
    leftX + leftPadding,
    leftY +
      Math.max(
        6,
        Math.round(12 * heightScale),
      ),
  );

  const sizeTextSize = fitFontSize({
    context,
    text: sizeLine,
    maximumWidth: leftMaximumWidth,
    initialSize: Math.max(
      16,
      Math.round(31 * widthScale),
    ),
    minimumSize: Math.max(
      11,
      Math.round(16 * balancedScale),
    ),
    weight: 700,
  });

  context.font = `700 ${sizeTextSize}px Arial, Helvetica, sans-serif`;
  context.fillText(
    sizeLine,
    leftX + leftPadding,
    leftY +
      Math.max(
        headlineSize + 12,
        Math.round(61 * heightScale),
      ),
  );

  const fabricLine = `Fabric - ${cleanText(
    details.fabric,
  )}`;

  const rightPadding = Math.max(
    12,
    Math.round(20 * widthScale),
  );

  const fabricSize = fitFontSize({
    context,
    text: fabricLine,
    maximumWidth:
      rightWidth - rightPadding * 2,
    initialSize: Math.max(
      16,
      Math.round(29 * widthScale),
    ),
    minimumSize: Math.max(
      11,
      Math.round(15 * balancedScale),
    ),
    weight: 700,
  });

  context.font = `700 ${fabricSize}px Arial, Helvetica, sans-serif`;
  const fabricWidth =
    context.measureText(fabricLine).width;

  context.fillText(
    fabricLine,
    rightX +
      Math.max(
        rightPadding,
        (rightWidth - fabricWidth) / 2,
      ),
    rightY +
      Math.max(
        8,
        (rightHeight - fabricSize * 1.15) / 2,
      ),
  );

  context.restore();
}

function drawRoundedRectangle({
  context,
  x,
  y,
  width,
  height,
  radius,
  fillStyle,
}: {
  context: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  fillStyle: string;
}) {
  const r = Math.min(
    radius,
    width / 2,
    height / 2,
  );

  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(
    x + width,
    y,
    x + width,
    y + r,
  );
  context.lineTo(
    x + width,
    y + height - r,
  );
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - r,
    y + height,
  );
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(
    x,
    y + height,
    x,
    y + height - r,
  );
  context.lineTo(x, y + r);
  context.quadraticCurveTo(
    x,
    y,
    x + r,
    y,
  );
  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
}

function drawFreeDeliveryBadge({
  context,
  size,
}: {
  context: CanvasRenderingContext2D;
  size: FreeDeliveryBadgeSize;
}) {
  const canvas = context.canvas;
  const widthScale = canvas.width / 1000;
  const heightScale = canvas.height / 1360;

  const sizeMultiplier: Record<
    FreeDeliveryBadgeSize,
    number
  > = {
    small: 0.72,
    medium: 1,
    large: 1.28,
    xlarge: 1.55,
  };

  const scale =
    Math.min(widthScale, heightScale) *
    sizeMultiplier[size];

  const badgeWidth = Math.round(285 * scale);
  const badgeHeight = Math.round(118 * scale);
  const marginX = Math.round(34 * widthScale);
  const marginBottom = Math.round(
    56 * heightScale,
  );
  const badgeX = marginX;
  const badgeY =
    canvas.height - badgeHeight - marginBottom;

  const bodyX = badgeX + Math.round(58 * scale);
  const bodyY = badgeY + Math.round(18 * scale);
  const bodyWidth = Math.round(132 * scale);
  const bodyHeight = Math.round(58 * scale);
  const cabX =
    bodyX + bodyWidth + Math.round(6 * scale);
  const cabY = badgeY + Math.round(34 * scale);
  const cabWidth = Math.round(67 * scale);
  const cabHeight = Math.round(42 * scale);

  const mainRed = "#e1252a";
  const darkRed = "#d9181c";
  const yellow = "#ffe54a";
  const white = "#f7f7f7";

  context.save();
  context.globalAlpha = 0.96;
  context.shadowColor = "rgba(0,0,0,0.22)";
  context.shadowBlur = Math.max(
    5,
    Math.round(10 * scale),
  );
  context.shadowOffsetY = Math.max(
    2,
    Math.round(4 * scale),
  );

  drawRoundedRectangle({
    context,
    x: badgeX,
    y: badgeY + Math.round(28 * scale),
    width: Math.round(72 * scale),
    height: Math.round(12 * scale),
    radius: Math.round(8 * scale),
    fillStyle: mainRed,
  });

  drawRoundedRectangle({
    context,
    x: badgeX + Math.round(7 * scale),
    y: badgeY + Math.round(51 * scale),
    width: Math.round(82 * scale),
    height: Math.round(12 * scale),
    radius: Math.round(8 * scale),
    fillStyle: mainRed,
  });

  drawRoundedRectangle({
    context,
    x: badgeX + Math.round(17 * scale),
    y: badgeY + Math.round(74 * scale),
    width: Math.round(80 * scale),
    height: Math.round(12 * scale),
    radius: Math.round(8 * scale),
    fillStyle: mainRed,
  });

  drawRoundedRectangle({
    context,
    x: bodyX,
    y: bodyY,
    width: bodyWidth,
    height: bodyHeight,
    radius: Math.round(10 * scale),
    fillStyle: mainRed,
  });

  drawRoundedRectangle({
    context,
    x: cabX,
    y: cabY,
    width: cabWidth,
    height: cabHeight,
    radius: Math.round(8 * scale),
    fillStyle: mainRed,
  });

  context.beginPath();
  context.moveTo(
    cabX + Math.round(14 * scale),
    cabY + Math.round(9 * scale),
  );
  context.lineTo(
    cabX + Math.round(44 * scale),
    cabY + Math.round(9 * scale),
  );
  context.lineTo(
    cabX + Math.round(56 * scale),
    cabY + Math.round(26 * scale),
  );
  context.lineTo(
    cabX + Math.round(12 * scale),
    cabY + Math.round(24 * scale),
  );
  context.closePath();
  context.fillStyle = white;
  context.fill();

  const wheelRadius = Math.round(16 * scale);
  const wheelCenters = [
    [
      bodyX + Math.round(42 * scale),
      badgeY + Math.round(82 * scale),
    ],
    [
      cabX + Math.round(33 * scale),
      badgeY + Math.round(82 * scale),
    ],
  ];

  for (const [wheelX, wheelY] of wheelCenters) {
    context.beginPath();
    context.arc(
      wheelX,
      wheelY,
      wheelRadius,
      0,
      Math.PI * 2,
    );
    context.fillStyle = darkRed;
    context.fill();

    context.beginPath();
    context.arc(
      wheelX,
      wheelY,
      Math.round(9.5 * scale),
      0,
      Math.PI * 2,
    );
    context.fillStyle = white;
    context.fill();
  }

  context.shadowColor = "transparent";
  context.fillStyle = yellow;
  context.textBaseline = "top";

  const headline = "FREE";
  const subline = "DELIVERY";

  context.font = `900 ${Math.max(14, Math.round(26 * scale))}px Arial, Helvetica, sans-serif`;
  const headlineWidth =
    context.measureText(headline).width;
  context.fillText(
    headline,
    bodyX + (bodyWidth - headlineWidth) / 2,
    bodyY + Math.round(5 * scale),
  );

  context.font = `900 ${Math.max(10, Math.round(14 * scale))}px Arial, Helvetica, sans-serif`;
  const sublineWidth =
    context.measureText(subline).width;
  context.fillText(
    subline,
    bodyX + (bodyWidth - sublineWidth) / 2,
    bodyY + Math.round(34 * scale),
  );

  context.restore();
}

function outputFileName({
  details,
  currency,
  index,
}: {
  details: ProductImageDetails;
  currency: ProductCurrency;
  index: number;
}) {
  const imageNumber = String(index).padStart(
    2,
    "0",
  );

  const sku = safeFilePart(details.sku);
  const price = safeFilePart(details.price);
  const size = safeFilePart(details.size);
  const fabric = safeFilePart(details.fabric);

  return `${sku} - ${currency} ${price} (${imageNumber}) Size - ${size} Fabric - ${fabric}.jpg`;
}

export async function generateProductImage({
  source,
  details,
  currency,
  index,
  previewMaximumSide,
}: {
  source: ProductImageSource;
  details: ProductImageDetails;
  currency: ProductCurrency;
  index: number;
  previewMaximumSide?: number;
}): Promise<ProductImageOutput> {
  const bitmap = await loadProductBitmap(
    source.file,
  );

  try {
    let outputWidth = bitmap.width;
    let outputHeight = bitmap.height;

    if (
      previewMaximumSide &&
      Math.max(outputWidth, outputHeight) >
        previewMaximumSide
    ) {
      const scale =
        previewMaximumSide /
        Math.max(outputWidth, outputHeight);

      outputWidth = Math.max(
        1,
        Math.round(outputWidth * scale),
      );
      outputHeight = Math.max(
        1,
        Math.round(outputHeight * scale),
      );
    }

    const canvas =
      document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error(
        "Browser canvas is unavailable.",
      );
    }

    context.drawImage(
      bitmap,
      0,
      0,
      outputWidth,
      outputHeight,
    );

    drawSampleStyleOverlay({
      context,
      details,
      currency,
    });

    if (details.freeDeliveryEnabled) {
      drawFreeDeliveryBadge({
        context,
        size: details.freeDeliveryBadgeSize,
      });
    }

    const blob = await canvasToBlob(
      canvas,
      details.quality,
    );

    return {
      id: crypto.randomUUID(),
      sourceId: source.id,
      currency,
      name: outputFileName({
        details,
        currency,
        index,
      }),
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

export function downloadProductImage(
  output: ProductImageOutput,
) {
  const anchor = document.createElement("a");

  anchor.href = output.objectUrl;
  anchor.download = output.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
