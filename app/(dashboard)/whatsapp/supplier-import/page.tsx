"use client";

import React, { useState, ChangeEvent } from "react";

export interface ParsedProduct {
  sku: string;
  name: string;
  description: string;
  fabric: string;
  size: string;
  workType: string;
  price: string;
  supplier: string;
  color: string;
  date: string;
  imagesCount: number;
  rawBlock: string;
}

interface ChatMessage {
  date: string;
  time: string;
  sender: string;
  content: string;
  isMedia: boolean;
}

export default function WhatsAppSupplierImportPage() {
  const [status, setStatus] = useState<string>("");
  const [chatText, setChatText] = useState<string>("");
  const [startFromSku, setStartFromSku] = useState<string>("");
  const [skuWarning, setSkuWarning] = useState<string>("");
  const [products, setProducts] = useState<ParsedProduct[]>([]);
  const [selectedFolderFiles, setSelectedFolderFiles] = useState<File[]>([]);
  const [folderName, setFolderName] = useState<string>("");

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (!file) return;

    if (!file.name.endsWith(".txt")) {
      setStatus("Barah-e-karam sirf WhatsApp export .txt file upload karein.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target ? (event.target.result as string) : "";
      setChatText(content || "");
      setSkuWarning("");
      setProducts([]);
      setStatus("Chat file loaded successfully: " + file.name);
    };
    reader.readAsText(file);
  };

  const handleFolderSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const imageFiles = fileList.filter((file) => file.type.indexOf("image/") === 0);

    const firstPath = (files[0] as any).webkitRelativePath || "";
    const rootDirName = firstPath ? firstPath.split("/")[0] : "Selected Folder";

    setSelectedFolderFiles(imageFiles);
    setFolderName(rootDirName);
    setStatus("Media folder loaded: " + rootDirName + " (" + imageFiles.length + " images)");
  };

  const checkIsMedia = (text: string): boolean => {
    if (text.indexOf("<Media omitted>") !== -1) return true;
    const lower = text.toLowerCase();
    const extensions = [".jpg", ".jpeg", ".png", ".webp"];
    for (let i = 0; i < extensions.length; i++) {
      if (lower.indexOf(extensions[i]) !== -1) return true;
    }
    return false;
  };

  const parseRawChatToMessages = (rawText: string): ChatMessage[] => {
    const msgRegex = /(?:\[?(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)\]?)\s*([^:\n]+):\s*([\s\S]*?)(?=(?:\[?\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]+\d{1,2}:\d{2}|$))/g;
    const messages: ChatMessage[] = [];
    let match: any = null;

    while ((match = msgRegex.exec(rawText)) !== null) {
      const body = match[4].trim();
      messages.push({
        date: match[1],
        time: match[2],
        sender: match[3].trim(),
        content: body,
        isMedia: checkIsMedia(body),
      });
    }

    return messages;
  };

  const getSkuFromReply = (msgContent: string): string => {
    const clean = msgContent.trim();
    const directSkuMatch = clean.match(/^(?:SKU\s*[:#-]?\s*)?([A-Za-z0-9-_]{3,15})$/i);
    if (directSkuMatch) {
      return directSkuMatch[1].toUpperCase();
    }

    const inlineSkuMatch = clean.match(/(?:SKU|Code|Design|Art|Article)\s*[:#-]?\s*([A-Za-z0-9-_]{3,15})/i);
    if (inlineSkuMatch) {
      return inlineSkuMatch[1].toUpperCase();
    }

    return "";
  };

  const extractFieldFromList = (text: string, keywords: string[]): string => {
    const lower = text.toLowerCase();
    for (let i = 0; i < keywords.length; i++) {
      const word = keywords[i].toLowerCase();
      if (lower.indexOf(word) !== -1) {
        return keywords[i];
      }
    }
    return "-";
  };

  const extractLabeledValue = (text: string, labels: string[]): string => {
    for (let i = 0; i < labels.length; i++) {
      const regex = new RegExp("(?:" + labels[i] + ")\\s*[:=-]?\\s*([^\\n,]+)", "i");
      const match = text.match(regex);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return "-";
  };

  const handleAnalyzeChat = (forceFullChat = false) => {
    if (!chatText.trim()) {
      setStatus("Pehle WhatsApp chat .txt file upload karein.");
      return;
    }

    setSkuWarning("");
    let workingText = chatText;
    const targetSku = startFromSku.trim();

    if (targetSku && !forceFullChat) {
      const cleanTarget = targetSku.toUpperCase();
      const matchIndex = workingText.toUpperCase().indexOf(cleanTarget);

      if (matchIndex !== -1) {
        const lookbackDistance = Math.max(0, matchIndex - 2000);
        workingText = workingText.substring(lookbackDistance);
        setStatus("Chat filtered from SKU: " + cleanTarget);
      } else {
        setSkuWarning("SKU '" + targetSku + "' chat mein nahi mila.");
        setStatus("Target SKU nahi mila. Puri chat analyze karne ka option chunein.");
        return;
      }
    }

    const messages = parseRawChatToMessages(workingText);
    const parsedList: ParsedProduct[] = [];

    const fabricKeywords = ["Lawn", "Cotton", "Chiffon", "Silk", "Khaddar", "Jacquard", "Organza", "Linen", "Viscose", "Velvet", "Paper Cotton", "Dobby"];
    const sizeKeywords = ["Small", "Medium", "Large", "XL", "XXL", "Free Size", "Standard", "Unstitched", "Stitched"];
    const workKeywords = ["Handwork", "Heavy Embroidery", "Embroidered", "Digital Print", "Printed", "Mirror Work", "Sequins", "Cutwork", "Zari", "Block Print", "Schiffli"];
    const colorKeywords = ["Red", "Blue", "Black", "White", "Green", "Yellow", "Pink", "Grey", "Brown", "Navy", "Maroon", "Purple", "Peach", "Beige"];

    for (let i = 0; i < messages.length; i++) {
      const currentMsg = messages[i];
      const detectedSku = getSkuFromReply(currentMsg.content);

      if (!detectedSku) continue;

      const descriptionCollector: string[] = [];
      let imagesCount = 0;
      let supplierName = "-";
      const date = currentMsg.date;

      const lookBackLimit = Math.max(0, i - 8);
      for (let j = i - 1; j >= lookBackLimit; j--) {
        const prevMsg = messages[j];

        if (getSkuFromReply(prevMsg.content)) {
          break;
        }

        if (supplierName === "-") {
          supplierName = prevMsg.sender;
        }

        if (prevMsg.isMedia) {
          imagesCount++;
        }

        const cleanText = prevMsg.content.replace(/<Media omitted>/gi, "").trim();
        if (cleanText) {
          descriptionCollector.unshift(cleanText);
        }
      }

      const combinedDescription = descriptionCollector.join("\n");

      let fabric = extractLabeledValue(combinedDescription, ["Fabric", "Stuff", "Cloth", "Material"]);
      if (fabric === "-") {
        fabric = extractFieldFromList(combinedDescription, fabricKeywords);
      }

      let size = extractLabeledValue(combinedDescription, ["Size", "Sizes"]);
      if (size === "-") {
        size = extractFieldFromList(combinedDescription, sizeKeywords);
      }

      let workType = extractLabeledValue(combinedDescription, ["Work", "Work Type", "Embroidery", "Design Type"]);
      if (workType === "-") {
        workType = extractFieldFromList(combinedDescription, workKeywords);
      }

      const priceMatch = combinedDescription.match(/(?:Price|Rate|Cost|Rs\.?|PKR|AED|USD)\s*[:=-]?\s*([\d,]+)/i);
      const price = priceMatch && priceMatch[1] ? priceMatch[1].trim() : "-";

      let color = extractLabeledValue(combinedDescription, ["Color", "Colour", "Shade"]);
      if (color === "-") {
        color = extractFieldFromList(combinedDescription, colorKeywords);
      }

      const lines = combinedDescription.split("\n");
      const name = lines.length > 0 && lines[0].trim().length > 0 
        ? lines[0].trim().substring(0, 40) 
        : "Product " + detectedSku;

      parsedList.push({
        sku: detectedSku,
        name: name,
        description: combinedDescription,
        fabric: fabric,
        size: size,
        workType: workType,
        price: price,
        supplier: supplierName,
        color: color,
        date: date,
        imagesCount: imagesCount,
        rawBlock: combinedDescription,
      });
    }

    setProducts(parsedList);
    setStatus("Analysis Complete: " + parsedList.length + " products mapped with your SKU replies.");
  };

  async function createFolders() {
    const picker = (window as any).showDirectoryPicker;

    if (!picker) {
      setStatus("Chrome ya Edge browser ki zaroorat hai folder create karne ke liye.");
      return;
    }

    try {
      const folder = await picker({ mode: "readwrite" });
      await folder.getDirectoryHandle("SKU_FOLDER_SAMPLE", { create: true });
      setStatus("Folder creation ready.");
    } catch (err: any) {
      setStatus("Folder permission cancel ya deny ho gayi.");
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-black">WhatsApp Supplier Import</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 border rounded-xl bg-white space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            Step 1: Upload WhatsApp TXT
          </label>
          <input 
            type="file" 
            accept=".txt" 
            onChange={handleFileUpload}
            className="block w-full text-xs text-gray-500 file:mr-2 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        <div className="p-4 border rounded-xl bg-white space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            Step 2: Select Media Folder
          </label>
          <input 
            type="file" 
            // @ts-ignore
            webkitdirectory="true"
            directory=""
            multiple 
            onChange={handleFolderSelect}
            className="block w-full text-xs text-gray-500 file:mr-2 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 cursor-pointer"
          />
          {folderName && (
            <p className="text-xs text-emerald-600 font-medium">
              {folderName} ({selectedFolderFiles.length} images)
            </p>
          )}
        </div>

        <div className="p-4 border rounded-xl bg-white space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            Step 3: Start From SKU (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. HRT1234"
            value={startFromSku}
            onChange={(e) => {
              setStartFromSku(e.target.value);
              setSkuWarning("");
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <button
          onClick={() => handleAnalyzeChat(false)}
          className="rounded-xl bg-blue-600 px-6 py-2.5 text-white font-medium hover:bg-blue-700 transition"
        >
          Step 4: Analyze Chat
        </button>
      </div>

      {skuWarning && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between text-amber-900">
          <span className="text-sm font-medium">{skuWarning}</span>
          <button
            onClick={() => handleAnalyzeChat(true)}
            className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 transition"
          >
            Puri Chat Analyze Karein
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-semibold text-gray-800">
            Step 5: Preview Products ({products.length} Detected)
          </h2>
        </div>

        <div className="border rounded-xl bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto max-h-[460px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-gray-50 border-b text-gray-600 font-semibold sticky top-0 uppercase tracking-wider">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">SKU (Your Reply)</th>
                  <th className="p-3">Supplier</th>
                  <th className="p-3">Fabric</th>
                  <th className="p-3">Work Type</th>
                  <th className="p-3">Size</th>
                  <th className="p-3">Price</th>
                  <th className="p-3">Color</th>
                  <th className="p-3">Images</th>
                  <th className="p-3">Description Sample</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-gray-400">
                      Koi product map nahi hua. Chat upload karein aur Step 4 click karein.
                    </td>
                  </tr>
                ) : (
                  products.map((p, index) => (
                    <tr key={index} className="hover:bg-gray-50/80 transition">
                      <td className="p-3 text-gray-400">{index + 1}</td>
                      <td className="p-3 font-bold font-mono text-blue-600">{p.sku}</td>
                      <td className="p-3 text-gray-700 font-medium">{p.supplier}</td>
                      <td className="p-3 text-gray-600">{p.fabric}</td>
                      <td className="p-3 text-purple-700 font-medium">{p.workType}</td>
                      <td className="p-3 text-gray-600">{p.size}</td>
                      <td className="p-3 font-semibold text-emerald-600">{p.price}</td>
                      <td className="p-3 text-gray-600">{p.color}</td>
                      <td className="p-3 text-gray-600">{p.imagesCount}</td>
                      <td className="p-3 text-gray-500 truncate max-w-xs">{p.description}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <button
          onClick={createFolders}
          className="rounded-xl bg-green-600 px-5 py-3 text-white font-medium hover:bg-green-700 transition"
        >
          Step 6: Create SKU Folders
        </button>
      </div>

      {status && (
        <p className="text-sm font-medium text-gray-700 bg-gray-100 p-3 rounded-lg border border-gray-200">
          {status}
        </p>
      )}
    </div>
  );
}