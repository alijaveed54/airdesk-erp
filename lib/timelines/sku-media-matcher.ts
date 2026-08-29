export type MediaFile = {
  name: string;
  url: string;
  folder: string;
};

export type SkuMediaResult = {
  sku: string;
  supplier: string;
  found: boolean;
  folder: string;
  images: MediaFile[];
};

function normalizeSku(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^SKU[:\s#-]*/i, "")
    .replace(/\s+/g, "");
}

export function supplierFromSku(sku: string) {
  const clean = normalizeSku(sku);
  const match = clean.match(/^([A-Z]{1,10})(?=[-_]*[0-9])/);
  return match ? match[1] : "";
}

/**
 * Media index format expected:
 *
 * [
 *   {
 *     folder: "FFT1234",
 *     files:[
 *       {name:"image1.jpg",url:"..."}
 *     ]
 *   }
 * ]
 */
export function findMediaBySku(
  sku: string,
  mediaIndex: any[],
): SkuMediaResult {

  const cleanSku = normalizeSku(sku);

  const folder = mediaIndex.find((item) =>
    normalizeSku(item.folder) === cleanSku
  );

  if (!folder) {
    return {
      sku: cleanSku,
      supplier: supplierFromSku(cleanSku),
      found: false,
      folder: "",
      images: [],
    };
  }

  return {
    sku: cleanSku,
    supplier: supplierFromSku(cleanSku),
    found: true,
    folder: folder.folder,
    images: (folder.files || []).map((file:any)=>({
      name:file.name,
      url:file.url,
      folder:folder.folder,
    })),
  };
}

export function matchTimelineSkus(
  skus:string[],
  mediaIndex:any[]
){
  return skus.map((sku)=>findMediaBySku(sku,mediaIndex));
}
