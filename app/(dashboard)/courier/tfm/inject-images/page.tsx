"use client";

import { useState } from "react";
import Link from "next/link";
import { CloudUpload, FileText, CheckCircle2 } from "lucide-react";

export default function TfmImageInjectorPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageRefs, setPageRefs] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleFileSelect(selectedFile: File | null) {
    setFile(selectedFile);
    setPageRefs([]);
    if (!selectedFile) return;

    setExtracting(true);
    try {
      const pdfjsLib = await import("pdfjs-dist");
      
      // Fixed worker URL using unpkg for pdfjs-dist v6+ (.mjs)
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const extracted: string[] = [];

      // Regex to support standard Ref# and Page 7 split token cases
      const refRegex = /\b([A-Z]{3,4}\d{5})\b/;

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const fullPageText = textContent.items
          .map((item: any) => item.str || "")
          .join(" ");

        const refSectionMatch = fullPageText.match(
          /Ref\s*#?\s*\|?\s*([A-Z]{3,4}\d{5})/i
        );
        const fallbackMatch = fullPageText.match(refRegex);

        const refNo = refSectionMatch?.[1] || fallbackMatch?.[1] || "";
        extracted.push(refNo.toUpperCase());
      }

      setPageRefs(extracted);
    } catch (err) {
      console.error("Client-side Ref# extraction warning:", err);
    } finally {
      setExtracting(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      alert("Please select a TFM PDF file first.");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("pageRefs", JSON.stringify(pageRefs));

      const res = await fetch("/api/courier/tfm/inject-images", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to process PDF");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TFM-Images-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      alert(err?.message || "Error processing PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">TFM PDF Image Injector</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Upload your TFM Airway Bill PDF to automatically replace content text with product images.
          </p>
        </div>
        <Link href="/courier/tfm" className="rounded-xl border px-4 py-2 font-bold">
          Back
        </Link>
      </div>

      <div className="rounded-3xl border bg-white p-6 shadow-sm">
        <form onSubmit={handleUpload} className="space-y-4">
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center bg-slate-50">
            <CloudUpload size={48} className="text-blue-600 mb-3" />
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              className="hidden"
              id="pdf-upload"
            />
            <label
              htmlFor="pdf-upload"
              className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
            >
              Choose TFM PDF File
            </label>
            {file && (
              <div className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                <FileText size={16} />
                {file.name}
              </div>
            )}

            {extracting && (
              <p className="mt-2 text-xs font-bold text-blue-600">
                Scanning pages for Ref#...
              </p>
            )}

            {pageRefs.length > 0 && (
              <div className="mt-4 w-full rounded-xl bg-emerald-50 p-3 text-left border border-emerald-200">
                <div className="flex items-center gap-1.5 text-xs font-black text-emerald-800 mb-1">
                  <CheckCircle2 size={14} />
                  Detected {pageRefs.filter(Boolean).length} / {pageRefs.length} Slips:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pageRefs.map((ref, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-white px-2 py-0.5 text-xs font-bold text-slate-700 border"
                    >
                      P{idx + 1}: {ref || "N/A"}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || extracting || !file}
            className="w-full h-12 rounded-xl bg-emerald-600 font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Injecting Images & Generating PDF..." : "Generate PDF with Product Images"}
          </button>
        </form>
      </div>
    </div>
  );
}