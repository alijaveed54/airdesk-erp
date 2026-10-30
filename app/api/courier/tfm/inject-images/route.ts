import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFImage, rgb } from "pdf-lib";
import { getSession } from "@/lib/auth";
import { getCurrentAirtableBase, airtableHeaders, airtableUrl } from "@/lib/airtable";

export const runtime = "nodejs";

const CONTENT_BOX = {
  x: 44.0,
  y: 276.0,
  width: 506.0,
  height: 78.0,
};

const BORDER_CLEARANCE = 2.0;
const INNER_PADDING = 4.0;
const IMAGE_GAP = 6.0;

function extractAllImageUrls(value: unknown): string[] {
  const urls: string[] = [];
  if (!value) return urls;

  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value.trim())) urls.push(value.trim());
    return urls;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      urls.push(...extractAllImageUrls(item));
    }
    return urls;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    const thumb = obj.thumbnails?.large?.url || obj.thumbnails?.full?.url;
    if (typeof thumb === "string" && thumb) {
      urls.push(thumb);
    } else if (typeof obj.url === "string" && obj.url) {
      urls.push(obj.url);
    }
  }

  return urls;
}

async function resolveProductImagesForOrder(
  baseId: string,
  token: string,
  refNo: string
): Promise<string[]> {
  if (!refNo) return [];
  const collectedUrls = new Set<string>();

  // Aap apne Airtable tables ke sahi naam yahan rakh sakte hain
  const tables = ["BS Order Entry", "FAB Order Entry", "DQ Order Entry", "Orders", "Order Entry"];
  // Possible field names where Ref# or Order Number might be stored in Airtable
  const fieldNames = ["Order Number", "Ref#", "Ref", "Order No", "Order #", "Reference"];

  for (const tableName of tables) {
    for (const fieldName of fieldNames) {
      try {
        const params = new URLSearchParams();
        params.set("pageSize", "10");
        params.set(
          "filterByFormula",
          `FIND(LOWER('${refNo.trim()}'), LOWER({${fieldName}}&'')) > 0`
        );

        const url = airtableUrl(baseId, tableName, params);
        const res = await fetch(url, {
          headers: airtableHeaders(token),
          cache: "no-store",
        });

        if (!res.ok) {
          const errText = await res.text();
          // Status 403 or 422 log kar ke next field/table par move honge
          if (res.status !== 422) {
            console.warn(`[TFM Debug] Table "${tableName}" status ${res.status}: ${errText}`);
          }
          continue;
        }

        const data = await res.json();
        if (data.records && data.records.length > 0) {
          console.log(`[TFM Found!] Match in Table: "${tableName}" using field: "${fieldName}" for Ref#: ${refNo}`);
          for (const record of data.records) {
            const fields = record.fields || {};
            const matchedKey = Object.keys(fields).find((k) =>
              /image|photo|attachment|picture|sku/i.test(k)
            );
            const rawImageField = matchedKey ? fields[matchedKey] : null;
            const urls = extractAllImageUrls(rawImageField);
            urls.forEach((u) => collectedUrls.add(u));
          }

          if (collectedUrls.size > 0) {
            return Array.from(collectedUrls);
          }
        }
      } catch (err) {
        // Ignore and try next
      }
    }
  }

  console.warn(`[TFM Warning] No product images resolved for Ref# ${refNo} across tested tables/fields.`);
  return Array.from(collectedUrls);
}

async function fetchAndEmbedImage(
  pdfDoc: PDFDocument,
  imageUrl: string
): Promise<PDFImage | null> {
  try {
    const res = await fetch(imageUrl, { cache: "no-store" });
    if (!res.ok) return null;

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());

    const isPng =
      contentType.includes("png") ||
      (bytes.length > 4 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47);

    if (isPng) {
      return await pdfDoc.embedPng(bytes);
    }
    return await pdfDoc.embedJpg(bytes);
  } catch (err) {
    console.error(`[TFM Error] Failed embedding image URL ${imageUrl}:`, err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const airtable = await getCurrentAirtableBase();
    const formData = await req.formData();
    const file = formData.get("file");
    const pageRefsRaw = formData.get("pageRefs");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { success: false, message: "Valid PDF file is required" },
        { status: 400 }
      );
    }

    let pageRefs: string[] = [];
    if (typeof pageRefsRaw === "string" && pageRefsRaw) {
      try {
        pageRefs = JSON.parse(pageRefsRaw);
      } catch {
        pageRefs = [];
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const refNo = (pageRefs[i] || "").trim();

      if (!refNo) continue;

      const imageUrls = await resolveProductImagesForOrder(
        airtable.baseId,
        airtable.token,
        refNo
      );

      if (imageUrls.length === 0) continue;

      const embeddedImages: PDFImage[] = [];
      for (const url of imageUrls) {
        const embedded = await fetchAndEmbedImage(pdfDoc, url);
        if (embedded) embeddedImages.push(embedded);
      }

      if (embeddedImages.length === 0) continue;

      // Draw white mask over CONTENT box
      page.drawRectangle({
        x: CONTENT_BOX.x + BORDER_CLEARANCE,
        y: CONTENT_BOX.y + BORDER_CLEARANCE,
        width: CONTENT_BOX.width - BORDER_CLEARANCE * 2,
        height: CONTENT_BOX.height - BORDER_CLEARANCE * 2,
        color: rgb(1, 1, 1),
      });

      const usableX = CONTENT_BOX.x + INNER_PADDING;
      const usableY = CONTENT_BOX.y + INNER_PADDING;
      const usableW = CONTENT_BOX.width - INNER_PADDING * 2;
      const usableH = CONTENT_BOX.height - INNER_PADDING * 2;

      const count = embeddedImages.length;
      const rows = count <= 8 ? 1 : 2;
      const cols = Math.ceil(count / rows);

      const slotWidth = (usableW - IMAGE_GAP * (cols - 1)) / cols;
      const slotHeight = (usableH - IMAGE_GAP * (rows - 1)) / rows;

      embeddedImages.forEach((img, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;

        const scale = Math.min(slotWidth / img.width, slotHeight / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;

        const slotX = usableX + col * (slotWidth + IMAGE_GAP);
        const slotY =
          usableY + (rows - 1 - row) * (slotHeight + IMAGE_GAP);

        const offsetX = slotX + (slotWidth - drawW) / 2;
        const offsetY = slotY + (slotHeight - drawH) / 2;

        page.drawImage(img, {
          x: offsetX,
          y: offsetY,
          width: drawW,
          height: drawH,
        });
      });
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="TFM-With-Product-Images.pdf"',
      },
    });
  } catch (error: any) {
    console.error("[TFM Error] API route crashed:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "PDF processing failed" },
      { status: 500 }
    );
  }
}