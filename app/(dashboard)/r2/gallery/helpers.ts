import type { GalleryImage } from "./types";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(value: string) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function downloadAsJpg(image: GalleryImage) {
  const response = await fetch(image.url);

  if (!response.ok) {
    throw new Error("Image download failed");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();

      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error("Image conversion failed"));

      element.src = objectUrl;
    });

    const canvas = document.createElement("canvas");

    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Browser image converter is unavailable");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0);

    const jpgBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error("JPG conversion failed"));
          }
        },
        "image/jpeg",
        0.95,
      );
    });

    const jpgUrl = URL.createObjectURL(jpgBlob);

    const link = document.createElement("a");
    const number = image.imageNumber || "image";

    link.href = jpgUrl;
    link.download = `${image.sku}-${image.currency}-${number}.jpg`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(jpgUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}