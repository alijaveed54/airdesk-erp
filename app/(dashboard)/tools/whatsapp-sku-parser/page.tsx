'use client';

import React, { useState } from 'react';
import * as XLSX from 'xlsx';

interface ParsedProduct {
  id: string;
  sku: string;
  salePrice: string;
  costPrice: string;
  size: string;
  material: string;
  workType: string;
  supplierCode: string;
  mediaFiles: string[];
  selectedMedia: string[];
  rawDescription: string;
  messageDate?: Date | null;
}

const SIZE_NUM_MAP: Record<string, number> = {
  'XS': 34,
  'S': 36,
  'M': 38,
  'L': 40,
  'XL': 42,
  '2XL': 44,
  'XXL': 44,
  '3XL': 46,
  'XXXL': 46,
  '4XL': 48,
  'XXXXL': 48,
  '5XL': 50,
};

function formatSizeRange(minNum: number, maxNum: number): string {
  if (minNum === maxNum) return `${minNum}`;
  return `${minNum} to ${maxNum}`;
}

function parseSizeString(text: string): string {
  const hasMargin = /margin|\+\s*margin/i.test(text);

  const rangeMatch = text.match(/(XS|S|M|L|XL|XXL|2XL|3XL|XXXL|4XL|5XL)\s*(?:TO|-)\s*(XS|S|M|L|XL|XXL|2XL|3XL|XXXL|4XL|5XL)/i);
  if (rangeMatch) {
    const start = rangeMatch[1].toUpperCase();
    const end = rangeMatch[2].toUpperCase();
    let startVal = SIZE_NUM_MAP[start] || 38;
    let endVal = SIZE_NUM_MAP[end] || 44;

    if (hasMargin) {
      endVal += 2;
    }
    return formatSizeRange(startVal, endVal);
  }

  const matchedTokens = text.match(/\b(XS|S|M|L|XL|XXL|2XL|3XL|XXXL|4XL|5XL)\b/gi);
  if (matchedTokens && matchedTokens.length > 0) {
    const nums = Array.from(new Set(matchedTokens.map(t => SIZE_NUM_MAP[t.toUpperCase()]).filter(Boolean))) as number[];
    nums.sort((a, b) => a - b);
    if (nums.length > 0) {
      const minVal = nums[0];
      let maxVal = nums[nums.length - 1];
      if (hasMargin) {
        maxVal += 2;
      }
      return formatSizeRange(minVal, maxVal);
    }
  }

  const directNumbers = text.match(/\b(34|36|38|40|42|44|46|48|50|52)\b/g);
  if (directNumbers && directNumbers.length > 1) {
    const nums = Array.from(new Set(directNumbers.map(n => parseInt(n, 10)))).sort((a, b) => a - b);
    if (nums.length > 1) {
      const minVal = nums[0];
      let maxVal = nums[nums.length - 1];
      if (hasMargin) {
        maxVal += 2;
      }
      return formatSizeRange(minVal, maxVal);
    }
  }

  const inchMatch = text.match(/(?:upto|size[:\s]*)\s*(\d{2})/i);
  if (inchMatch) {
    let val = parseInt(inchMatch[1], 10);
    if (hasMargin) val += 2;
    return `${val}`;
  }

  return 'Free Size';
}

function parseFabricMaterial(text: string): string {
  const patterns = [
    /(?:fabric|saree fabric|saree|top fabric|material)\s*[:\-*]*\s*([^\n\r*]+)/i,
    /(?:pure|soft|heavy)\s+([a-zA-Z\s]{4,25}(?:silk|cotton|georgette|chiffon|crepe|linen|organza|satin))/i
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const cleaned = m[1].replace(/[*_~]/g, '').trim();
      if (cleaned.length > 2 && cleaned.length < 50) {
        return cleaned;
      }
    }
  }
  return 'Silk';
}

function parseEmbroideryDetails(text: string, isKts: boolean): string {
  if (!isKts) return '';

  const isEmbroidery = /embroider|embrodary|embroidery|chikan\s*kari|thread\s*work|cording|zari/i.test(text);
  if (!isEmbroidery) return '';

  const workMatch = text.match(/(?:work|pattern)\s*[:\-*]*\s*([^\n\r*]+)/i);
  if (workMatch && workMatch[1]) {
    return workMatch[1].replace(/[*_~]/g, '').trim();
  }

  const genericMatch = text.match(/([^\n\r*]*(?:embroidery|sequence|thread\s*work|zari)[^\n\r*]*)/i);
  if (genericMatch && genericMatch[1]) {
    return genericMatch[1].replace(/[*_~]/g, '').trim();
  }

  return 'Embroidery Work';
}

function isProductSeparator(line: string): boolean {
  if (/(\+{4,}|-{4,}|={4,})/.test(line)) return true;
  if (/STK-[0-9\-]+-WA[0-9]+\.webp/i.test(line)) return true;
  if (/\bnext\b/i.test(line) && (line.includes('sticker') || line.length < 25)) return true;
  return false;
}

function extractDateFromLine(line: string): Date | null {
  const m = line.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return null;
  const p1 = parseInt(m[1], 10);
  const p2 = parseInt(m[2], 10);
  const p3 = parseInt(m[3], 10);

  let year = p3 < 100 ? 2000 + p3 : p3;
  let month = p1 - 1;
  let day = p2;

  if (p1 > 12 && p2 <= 12) {
    day = p1;
    month = p2 - 1;
  }

  const d = new Date(year, month, day);
  return isNaN(d.getTime()) ? null : d;
}

async function createWatermarkedImageBlob(
  fileBlob: Blob,
  currency: 'AED' | 'QAR',
  product: ParsedProduct
): Promise<Blob> {
  const safeBlob = fileBlob.type ? fileBlob : new Blob([fileBlob], { type: 'image/jpeg' });

  let imageSource: ImageBitmap | HTMLImageElement;
  let width = 0;
  let height = 0;

  if ('createImageBitmap' in window) {
    try {
      imageSource = await createImageBitmap(safeBlob);
      width = imageSource.width;
      height = imageSource.height;
    } catch {
      imageSource = await loadStandardImage(safeBlob);
      width = imageSource.naturalWidth || imageSource.width;
      height = imageSource.naturalHeight || imageSource.height;
    }
  } else {
    imageSource = await loadStandardImage(safeBlob);
    width = imageSource.naturalWidth || imageSource.width;
    height = imageSource.naturalHeight || imageSource.height;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  ctx.drawImage(imageSource, 0, 0, width, height);

  if ('close' in imageSource && typeof imageSource.close === 'function') {
    imageSource.close();
  }

  const baseFontSize = Math.max(16, Math.round(width * 0.034));
  const badgePadX = Math.round(width * 0.025);
  const badgePadY = Math.round(height * 0.012);

  // Top-Left Pink Badge
  const line1 = `${product.sku} - ${currency} ${product.salePrice}`.trim();
  const line2 = `Size - ${product.size}`.trim();

  ctx.font = `bold ${baseFontSize}px Arial, sans-serif`;
  const wLine1 = ctx.measureText(line1).width;
  ctx.font = `bold ${Math.round(baseFontSize * 0.9)}px Arial, sans-serif`;
  const wLine2 = ctx.measureText(line2).width;

  const badgeWidth = Math.max(wLine1, wLine2) + badgePadX * 2;
  const badgeHeight = baseFontSize * 2.5 + badgePadY * 2;

  ctx.fillStyle = '#f69cb2';
  ctx.fillRect(0, 0, badgeWidth, badgeHeight);

  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${baseFontSize}px Arial, sans-serif`;
  ctx.fillText(line1, badgePadX, badgePadY);

  ctx.font = `bold ${Math.round(baseFontSize * 0.9)}px Arial, sans-serif`;
  ctx.fillText(line2, badgePadX, badgePadY + baseFontSize * 1.3);

  // Top-Right Fabric text
  if (product.material) {
    const matText = `Fabric - ${product.material}`;
    ctx.font = `bold ${Math.round(baseFontSize * 0.85)}px Arial, sans-serif`;
    const matWidth = ctx.measureText(matText).width;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(width - matWidth - badgePadX * 1.5, badgePadY * 0.5, matWidth + badgePadX, baseFontSize * 1.4);

    ctx.fillStyle = '#000000';
    ctx.fillText(matText, width - matWidth - badgePadX, badgePadY);
  }

  // Bottom full-width white bar
  if (product.workType) {
    const bottomBarHeight = Math.round(baseFontSize * 2.2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, height - bottomBarHeight, width, bottomBarHeight);

    ctx.fillStyle = '#000000';
    ctx.font = `bold ${Math.round(baseFontSize * 0.9)}px Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    const workDetailText = `DETAILS: ${product.workType.toUpperCase()}`;
    ctx.fillText(workDetailText, badgePadX, height - bottomBarHeight / 2);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas export to blob failed'));
    }, 'image/jpeg', 0.92);
  });
}

function loadStandardImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image decoding failed in fallback Image element'));
    };
    img.src = url;
  });
}

export default function WhatsAppSkuParserPage() {
  const [products, setProducts] = useState<ParsedProduct[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [isProcessingFiles, setIsProcessingFiles] = useState<boolean>(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterStartSku, setFilterStartSku] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [dirHandle, setDirHandle] = useState<any>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const processChat = async (fileToProcess?: File) => {
    const file = fileToProcess || selectedFile;
    if (!file) {
      alert('Pehle WhatsApp .txt file upload karein.');
      return;
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/);

    let startLineIndex = 0;
    if (filterStartSku.trim()) {
      const searchSku = filterStartSku.trim().toUpperCase();
      const targetIdx = lines.findIndex(l => l.toUpperCase().includes(searchSku));
      if (targetIdx !== -1) {
        startLineIndex = targetIdx + 1;
      } else {
        alert(`SKU "${searchSku}" chat mein nahi mila. Shuru se process ho raha hai.`);
      }
    }

    const filterDateObj = filterStartDate ? new Date(filterStartDate) : null;
    if (filterDateObj) {
      filterDateObj.setHours(0, 0, 0, 0);
    }

    const skuList: string[] = [];
    const rawBlocks: { text: string; date: Date | null }[] = [];
    let currentBlock: string[] = [];
    let currentBlockDate: Date | null = null;

    for (let i = startLineIndex; i < lines.length; i++) {
      const line = lines[i];

      const lineDate = extractDateFromLine(line);
      if (lineDate) {
        currentBlockDate = lineDate;
      }

      if (filterDateObj && currentBlockDate && currentBlockDate < filterDateObj) {
        continue;
      }

      const userSkuMatch = line.match(/(?:Ali Jazz|Dua Ali|You|Me|Ali javeed).*?:\s*([A-Z]{3,4}\d{5,8})/i) ||
                           line.match(/^([A-Z]{3,4}\d{5,8})$/i);

      if (userSkuMatch) {
        const foundSku = userSkuMatch[1].toUpperCase();
        if (filterStartSku.trim() && foundSku === filterStartSku.trim().toUpperCase()) {
          continue;
        }
        skuList.push(foundSku);
        continue;
      }

      if (isProductSeparator(line)) {
        if (currentBlock.length > 0) {
          rawBlocks.push({ text: currentBlock.join('\n'), date: currentBlockDate });
          currentBlock = [];
        }
      } else {
        currentBlock.push(line);
      }
    }

    if (currentBlock.length > 0) {
      rawBlocks.push({ text: currentBlock.join('\n'), date: currentBlockDate });
    }

    const parsed: ParsedProduct[] = [];
    let skuIndex = 0;

    for (const block of rawBlocks) {
      const blockText = block.text;

      if (filterStartSku.trim() && blockText.toUpperCase().includes(filterStartSku.trim().toUpperCase())) {
        continue;
      }

      const mediaFiles: string[] = [];
      const mediaMatches = blockText.matchAll(/([A-Z0-9_\-]+\.(?:jpg|jpeg|png|mp4))/gi);
      for (const m of mediaMatches) {
        mediaFiles.push(m[1]);
      }

      let costPrice = '';
      const costMatch = blockText.match(/(?:rate|price|mrp|just\s*only\s*@\s*rs\.?|₹|rs\.?)\s*[:\-~*]*\s*(?:₹|rs\.?)?\s*(\d{3,5})/i);
      if (costMatch) {
        costPrice = costMatch[1];
      }

      let salePrice = '';
      let supplierCode = '';
      const saleMatch = blockText.match(/(?:aed\s*(\d{2,4})\s*([a-z]{3,4})|([a-z]{3,4})\s*aed\s*(\d{2,4}))/i);
      if (saleMatch) {
        salePrice = saleMatch[1] || saleMatch[4] || '';
        supplierCode = (saleMatch[2] || saleMatch[3] || '').toUpperCase();
      }

      if (!costPrice && !salePrice && mediaFiles.length === 0) {
        continue;
      }

      const assignedSku = skuList[skuIndex] || `${supplierCode || 'SKU'}${100000 + skuIndex}`;
      skuIndex++;

      const isKts = supplierCode.includes('KTS') || assignedSku.startsWith('KTS');
      const sizeStr = parseSizeString(blockText);
      const materialStr = parseFabricMaterial(blockText);
      const workTypeStr = parseEmbroideryDetails(blockText, isKts);

      parsed.push({
        id: `prod_${skuIndex}`,
        sku: assignedSku,
        salePrice: salePrice || '',
        costPrice: costPrice || '',
        size: sizeStr,
        material: materialStr,
        workType: workTypeStr,
        supplierCode: supplierCode || (assignedSku.slice(0, 3)),
        mediaFiles,
        selectedMedia: [],
        rawDescription: blockText,
        messageDate: block.date,
      });
    }

    setProducts(parsed);
    setStatusMsg(`Loaded ${parsed.length} products! Connect Media Folder to preview image thumbnails.`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setSelectedFile(f);
      processChat(f);
    }
  };

  const handleFieldChange = (index: number, field: keyof ParsedProduct, value: string) => {
    setProducts(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const connectFolderForThumbnails = async () => {
    try {
      if (!('showDirectoryPicker' in window)) {
        alert('Directory picker API browser mein available nahi hai. Chrome ya Edge use karein.');
        return;
      }

      // @ts-ignore
      const handle = await window.showDirectoryPicker();
      setDirHandle(handle);
      setStatusMsg('Loading image thumbnails from folder...');

      const newThumbs: Record<string, string> = {};

      for (const prod of products) {
        for (const fileName of prod.mediaFiles) {
          if (!/\.(jpe?g|png|webp)$/i.test(fileName)) continue;
          if (newThumbs[fileName]) continue;

          try {
            let fHandle: any = null;
            try {
              fHandle = await handle.getFileHandle(fileName);
            } catch {
              try {
                const skuDir = await handle.getDirectoryHandle(prod.sku);
                fHandle = await skuDir.getFileHandle(fileName);
              } catch {
                continue;
              }
            }

            const file = await fHandle.getFile();
            const url = URL.createObjectURL(file);
            newThumbs[fileName] = url;
          } catch (_) {}
        }
      }

      setThumbnails(newThumbs);
      setStatusMsg(`Connected! Loaded ${Object.keys(newThumbs).length} image thumbnails successfully.`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStatusMsg(`Folder connection error: ${err.message}`);
      }
    }
  };

  const toggleMediaSelection = (productIdx: number, fileName: string) => {
    setProducts(prev => {
      const copy = [...prev];
      const prod = copy[productIdx];
      const selected = Array.isArray(prod.selectedMedia) ? prod.selectedMedia : [];
      const isAlready = selected.includes(fileName);
      const updated = isAlready
        ? selected.filter(f => f !== fileName)
        : [...selected, fileName];
      copy[productIdx] = { ...prod, selectedMedia: updated };
      return copy;
    });
  };

  const setAllMediaSelection = (productIdx: number, selectAll: boolean) => {
    setProducts(prev => {
      const copy = [...prev];
      const prod = copy[productIdx];
      copy[productIdx] = {
        ...prod,
        selectedMedia: selectAll ? [...(prod.mediaFiles || [])] : []
      };
      return copy;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const exportToExcel = () => {
    if (products.length === 0) return;

    const data = products.map(p => ({
      'SKU': p.sku,
      'Sale Price': p.salePrice ? Number(p.salePrice) || p.salePrice : '',
      'Cost Price': p.costPrice ? Number(p.costPrice) || p.costPrice : '',
      'Size': p.size,
      'Material': p.material,
      'Details': p.workType,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

    XLSX.writeFile(workbook, `Products_SKU_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const organizeImagesInFolder = async () => {
    if (products.length === 0) {
      alert('Pehle chat upload kar ke items load karein.');
      return;
    }

    try {
      if (!('showDirectoryPicker' in window)) {
        alert('Aap ka browser Folder selection API support nahi karta. Chrome ya Edge use karein.');
        return;
      }

      setIsProcessingFiles(true);
      setStatusMsg('Processing images and moving to folders...');

      // @ts-ignore
      const rootDirHandle = dirHandle || (await window.showDirectoryPicker());
      if (!dirHandle) setDirHandle(rootDirHandle);

      let movedOriginalCount = 0;
      let watermarkedAedCount = 0;
      let watermarkedQarCount = 0;

      for (let pIdx = 0; pIdx < products.length; pIdx++) {
        const item = products[pIdx];
        if (!item.mediaFiles || item.mediaFiles.length === 0) continue;

        setStatusMsg(`Processing ${item.sku} (${pIdx + 1}/${products.length})...`);

        const skuDirHandle = await rootDirHandle.getDirectoryHandle(item.sku, { create: true });
        const selectedList = Array.isArray(item.selectedMedia) ? item.selectedMedia : [];

        let aedDirHandle: any = null;
        let qarDirHandle: any = null;

        if (selectedList.length > 0) {
          aedDirHandle = await skuDirHandle.getDirectoryHandle('AED', { create: true });
          qarDirHandle = await skuDirHandle.getDirectoryHandle('QAR', { create: true });
        }

        let imageCounter = 1;

        for (const fileName of item.mediaFiles) {
          try {
            let fileHandle: any = null;
            let isInRoot = true;

            try {
              fileHandle = await rootDirHandle.getFileHandle(fileName);
            } catch {
              try {
                fileHandle = await skuDirHandle.getFileHandle(fileName);
                isInRoot = false;
              } catch {
                continue;
              }
            }

            const fileData: File = await fileHandle.getFile();
            const arrayBuf = await fileData.arrayBuffer();
            const safeBlob = new Blob([arrayBuf], { type: fileData.type || 'image/jpeg' });

            if (isInRoot) {
              const origFileHandle = await skuDirHandle.getFileHandle(fileName, { create: true });
              const origWritable = await origFileHandle.createWritable();
              await origWritable.write(safeBlob);
              await origWritable.close();

              try {
                await rootDirHandle.removeEntry(fileName);
              } catch (_) {}
              movedOriginalCount++;
            }

            const isSelectedForWatermark = selectedList.includes(fileName);
            const isImage = /\.(jpe?g|png|webp)$/i.test(fileName);

            if (isImage && isSelectedForWatermark && aedDirHandle && qarDirHandle) {
              const padIndex = String(imageCounter).padStart(2, '0');
              const cleanMat = item.material ? `Fabric - ${item.material}` : '';
              const cleanSize = item.size ? `Size - ${item.size}` : '';

              const aedFileName = `${item.sku} - AED ${item.salePrice} (${padIndex}) ${cleanSize} ${cleanMat}.jpg`.replace(/\s+/g, ' ').trim();
              const qarFileName = `${item.sku} - QAR ${item.salePrice} (${padIndex}) ${cleanSize} ${cleanMat}.jpg`.replace(/\s+/g, ' ').trim();

              try {
                const aedBlob = await createWatermarkedImageBlob(safeBlob, 'AED', item);
                const aedFileHandle = await aedDirHandle.getFileHandle(aedFileName, { create: true });
                const aedWritable = await aedFileHandle.createWritable();
                await aedWritable.write(aedBlob);
                await aedWritable.close();
                watermarkedAedCount++;

                const qarBlob = await createWatermarkedImageBlob(safeBlob, 'QAR', item);
                const qarFileHandle = await qarDirHandle.getFileHandle(qarFileName, { create: true });
                const qarWritable = await qarFileHandle.createWritable();
                await qarWritable.write(qarBlob);
                await qarWritable.close();
                watermarkedQarCount++;

                imageCounter++;
              } catch (wmErr) {
                console.error(`Watermark error on ${fileName}:`, wmErr);
              }
            }
          } catch (err) {
            console.warn(`File skip error: ${fileName}`, err);
          }
        }
      }

      setStatusMsg(
        `Complete! Moved ${movedOriginalCount} originals. Watermarked ${watermarkedAedCount} AED and ${watermarkedQarCount} QAR images.`
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setStatusMsg(`Folder organizing error: ${error.message}`);
      }
    } finally {
      setIsProcessingFiles(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp Product Chat Parser & Image Organizer</h1>
          <p className="text-sm text-gray-500">
            Export WhatsApp chat, preview large thumbnails, tick selected images for watermark (AED/QAR) & export Excel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={connectFolderForThumbnails}
            disabled={products.length === 0}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium text-xs disabled:opacity-50 transition shadow-sm"
          >
            📸 Connect Folder (Load Previews)
          </button>
          <button
            onClick={exportToExcel}
            disabled={products.length === 0}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs disabled:opacity-50 transition shadow-sm"
          >
            Download Excel
          </button>
          <button
            onClick={organizeImagesInFolder}
            disabled={products.length === 0 || isProcessingFiles}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-xs disabled:opacity-50 transition shadow-sm"
          >
            {isProcessingFiles ? 'Processing...' : 'Organize & Apply Watermark'}
          </button>
        </div>
      </div>

      {/* Upload and Filter Controls */}
      <div className="bg-white border rounded-lg p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">WhatsApp Chat File (.txt)</label>
            <input
              type="file"
              accept=".txt"
              onChange={handleFileChange}
              className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Start from Date (Optional)</label>
            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="border rounded px-3 py-1.5 w-full text-xs text-gray-700 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Load Messages After SKU (Exclusive)</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. KTS101104"
                value={filterStartSku}
                onChange={(e) => setFilterStartSku(e.target.value)}
                className="border rounded px-3 py-1.5 w-full text-xs font-mono uppercase focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={() => processChat()}
                className="px-3 py-1.5 bg-gray-800 hover:bg-black text-white text-xs font-medium rounded transition"
              >
                Apply
              </button>
            </div>
          </div>
        </div>

        {statusMsg && (
          <div className="text-xs px-3 py-2 bg-blue-50 border border-blue-100 rounded text-blue-800 font-medium">
            {statusMsg}
          </div>
        )}
      </div>

      {/* Product Table */}
      {products.length > 0 && (
        <div className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-gray-50 border-b text-gray-700 font-semibold uppercase text-xs">
              <tr>
                <th className="p-3 w-10">#</th>
                <th className="p-3">SKU</th>
                <th className="p-3">Sale Price</th>
                <th className="p-3">Cost Price</th>
                <th className="p-3">Size (Numeric Range)</th>
                <th className="p-3">Material</th>
                <th className="p-3">Details (KTS Embroidery)</th>
                <th className="p-3">Watermark Targets</th>
                <th className="p-3 text-center w-16">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-800">
              {products.map((item, idx) => {
                const isExpanded = expandedId === item.id;
                const selectedCount = (item.selectedMedia || []).length;
                const totalCount = (item.mediaFiles || []).length;

                return (
                  <React.Fragment key={item.id}>
                    <tr className={`hover:bg-gray-50 ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                      <td className="p-3 text-gray-400 font-mono text-xs">{idx + 1}</td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.sku}
                          onChange={(e) => handleFieldChange(idx, 'sku', e.target.value)}
                          className="border rounded px-2 py-1 w-28 font-mono text-xs font-semibold focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.salePrice}
                          onChange={(e) => handleFieldChange(idx, 'salePrice', e.target.value)}
                          className="border rounded px-2 py-1 w-20 text-xs font-medium text-emerald-700"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.costPrice}
                          onChange={(e) => handleFieldChange(idx, 'costPrice', e.target.value)}
                          className="border rounded px-2 py-1 w-20 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.size}
                          onChange={(e) => handleFieldChange(idx, 'size', e.target.value)}
                          className="border rounded px-2 py-1 w-32 text-xs font-mono font-medium"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.material}
                          onChange={(e) => handleFieldChange(idx, 'material', e.target.value)}
                          className="border rounded px-2 py-1 w-32 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.workType}
                          onChange={(e) => handleFieldChange(idx, 'workType', e.target.value)}
                          placeholder={item.supplierCode.includes('KTS') ? 'KTS Embroidery' : '-'}
                          className="border rounded px-2 py-1 w-48 text-xs"
                        />
                      </td>
                      <td className="p-3 text-xs">
                        <span
                          className={`inline-block px-2 py-0.5 rounded font-mono font-semibold ${
                            selectedCount > 0
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {selectedCount > 0 ? `${selectedCount} selected` : 'None (Move Only)'}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleExpand(item.id)}
                          className={`w-7 h-7 rounded border font-bold flex items-center justify-center transition ${
                            isExpanded
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                          }`}
                          title="Open Image Previews & Selection"
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                      </td>
                    </tr>

                    {/* Expandable Section: Large Image Thumbnails + Selector */}
                    {isExpanded && (
                      <tr className="bg-slate-50 border-y">
                        <td colSpan={9} className="p-4">
                          <div className="bg-white border rounded p-4 text-xs text-gray-700 space-y-4 shadow-sm">
                            <div>
                              <div className="flex justify-between items-center pb-2 border-b mb-3">
                                <div>
                                  <span className="font-bold text-gray-800 text-sm">
                                    Click Images to Select for Watermark (AED & QAR)
                                  </span>
                                  <span className="text-gray-400 ml-2 text-xs">
                                    ({selectedCount} of {totalCount} selected)
                                  </span>
                                </div>
                                <div className="space-x-2">
                                  <button
                                    type="button"
                                    onClick={() => setAllMediaSelection(idx, true)}
                                    className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-medium"
                                  >
                                    Select All
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAllMediaSelection(idx, false)}
                                    className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-medium"
                                  >
                                    Deselect All
                                  </button>
                                </div>
                              </div>

                              {/* Large Thumbnail Grid (h-56) */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                                {(item.mediaFiles || []).map((fileName, fIdx) => {
                                  const isSelected = (item.selectedMedia || []).includes(fileName);
                                  const thumbUrl = thumbnails[fileName];
                                  const isVideo = fileName.endsWith('.mp4');

                                  return (
                                    <div
                                      key={fIdx}
                                      onClick={() => !isVideo && toggleMediaSelection(idx, fileName)}
                                      className={`relative group rounded-lg border-2 overflow-hidden flex flex-col cursor-pointer transition ${
                                        isSelected
                                          ? 'border-emerald-500 ring-2 ring-emerald-300 shadow-md bg-emerald-50/10'
                                          : 'border-gray-200 bg-gray-50 hover:border-gray-400'
                                      }`}
                                    >
                                      {/* Large Preview Area */}
                                      <div className="w-full h-56 bg-gray-100 flex items-center justify-center overflow-hidden relative">
                                        {thumbUrl ? (
                                          <img
                                            src={thumbUrl}
                                            alt={fileName}
                                            className="w-full h-full object-cover transition duration-150 group-hover:scale-105"
                                          />
                                        ) : (
                                          <div className="text-center p-3 text-gray-400">
                                            {isVideo ? (
                                              <span className="text-2xl block mb-1">🎥</span>
                                            ) : (
                                              <span className="text-2xl block mb-1">🖼️</span>
                                            )}
                                            <span className="text-xs font-medium">
                                              {isVideo ? 'Video File' : 'No Preview'}
                                            </span>
                                            {!isVideo && (
                                              <span className="block text-[10px] text-gray-400 mt-1">
                                                Click "Connect Folder"
                                              </span>
                                            )}
                                          </div>
                                        )}

                                        {/* Floating Checkbox Badge */}
                                        {!isVideo && (
                                          <div className="absolute top-2 left-2 bg-white/95 backdrop-blur rounded-md px-2 py-1 shadow flex items-center gap-1.5 border">
                                            <input
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={() => toggleMediaSelection(idx, fileName)}
                                              onClick={(e) => e.stopPropagation()}
                                              className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                                            />
                                            <span className="text-[11px] font-bold text-gray-700">
                                              {isSelected ? 'Watermark' : 'Skip'}
                                            </span>
                                          </div>
                                        )}
                                      </div>

                                      <div className="p-2 text-center bg-white border-t">
                                        <p className="truncate text-xs font-mono text-gray-700 font-medium" title={fileName}>
                                          {fileName}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Raw Description */}
                            <div className="border-t pt-3">
                              <span className="font-semibold text-gray-500 block mb-1">Raw WhatsApp Message</span>
                              <pre className="font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto bg-gray-50 p-2.5 rounded border text-[11px]">
                                {item.rawDescription}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}