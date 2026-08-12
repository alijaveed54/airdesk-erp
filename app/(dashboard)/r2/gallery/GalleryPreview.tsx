"use client";

import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  Loader2,
  Trash2,
  X,
} from "lucide-react";

import { useEffect, useState } from "react";

import type {
  AIResult,
  GalleryGroup,
  GalleryImage,
} from "./types";

import {
  formatBytes,
  formatDate,
} from "./helpers";

type Props = {
  activeGroup: GalleryGroup | null;
  activeImage: GalleryImage | undefined;
  activeIndex: number;

  busyKey: string;

  aiResults: Record<string, AIResult>;

  selectedKeys: string[];

  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;

  closePreview: () => void;
  previousImage: () => void;
  nextImage: () => void;

  toggleImageSelection: (key: string) => void;
  toggleSelectAllInGroup: () => void;

  analyzeImage: (image: GalleryImage) => Promise<void>;
  deleteGroup: (group: GalleryGroup) => Promise<void>;
  deleteImage: (image: GalleryImage) => Promise<void>;
  deleteSelectedImages: () => Promise<void>;

  handleJpgDownload: (image: GalleryImage) => Promise<void>;

  copyUrl: (url: string) => Promise<void>;
};

export default function GalleryPreview({
  activeGroup,
  activeImage,
  activeIndex,
  busyKey,
  aiResults,
  selectedKeys,
  setActiveIndex,
  closePreview,
  previousImage,
  nextImage,
  toggleImageSelection,
  toggleSelectAllInGroup,
  analyzeImage,
  deleteGroup,
  deleteImage,
  deleteSelectedImages,
  handleJpgDownload,
  copyUrl,
}: Props) {
  const categoryOptions = [
    "Saree",
    "Kurta Set",
    "Co-ord Set",
    "Anarkali Set",
    "Gown",
    "Lehenga",
    "Kaftan",
    "Abaya",
    "Dress Material",
    "Top",
    "Tunic",
    "Kurti",
    "Salwar Suit",
    "Sharara Set",
    "Garara Set",
    "Palazzo Set",
    "Skirt Set",
    "Jumpsuit",
    "Blouse",
    "Dupatta",
    "Kids Wear",
    "Other",
  ];

  const [manualCategory, setManualCategory] = useState("");
  const [categorySaved, setCategorySaved] = useState(false);

  useEffect(() => {
    if (!activeImage) return;

    setManualCategory(aiResults[activeImage.key]?.category || "");
    setCategorySaved(false);
  }, [activeImage, aiResults]);

  if (!activeGroup || !activeImage) return null;

  const activeImageKey = activeImage.key;

  function saveManualCategory() {
    const category = manualCategory.trim();
    if (!category) return;

    const currentResult = aiResults[activeImageKey];
    const nextResult: AIResult = currentResult
      ? { ...currentResult, category }
      : {
          category,
          confidence: 1,
          model: "manual",
          version: "1.0",
          analyzedAt: new Date().toISOString(),
          quality: "good",
        };

    const nextResults = {
      ...aiResults,
      [activeImageKey]: nextResult,
    };

    window.localStorage.setItem(
      "r2-gallery-ai-results",
      JSON.stringify(nextResults),
    );

    setCategorySaved(true);
    window.setTimeout(() => setCategorySaved(false), 2000);
  }

  const displayedCategory =
    manualCategory || aiResults[activeImageKey]?.category || "";

  return (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
    role="dialog"
    aria-modal="true"
  >

          <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-xl font-black text-slate-950">
              {activeGroup.sku}
            </h2>

            <p className="text-xs font-bold text-slate-500">
              {activeGroup.currency} · {activeIndex + 1} of{" "}
              {activeGroup.images.length}
            </p>
          </div>

          <button
            type="button"
            onClick={closePreview}
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_300px]">

          <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-3xl bg-slate-100">

            <img
              src={activeImage.url}
              alt={`${activeImage.sku} ${activeIndex + 1}`}
              className="max-h-[72vh] w-auto max-w-full object-contain"
            />

            {activeGroup.images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={previousImage}
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 shadow-lg"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>

                <button
                  type="button"
                  onClick={nextImage}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 shadow-lg"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>

          <aside className="space-y-4">

            <div className="rounded-3xl border border-slate-200 p-4">

              <dl className="space-y-3 text-sm">

                {[
                  ["SKU", activeImage.sku],
                  ["Currency", activeImage.currency],
                  ["Image No.", activeImage.imageNumber || "-"],
                  ["Format", "WebP"],
                  ["Size", formatBytes(activeImage.size)],
                  ["Uploaded", formatDate(activeImage.lastModified)],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="flex items-start justify-between"
                  >
                    <dt className="font-bold text-slate-500">
                      {label}
                    </dt>

                    <dd className="font-black text-slate-900">
                      {value}
                    </dd>
                  </div>
                ))}

              </dl>

            </div>
                        <div className="rounded-3xl border border-violet-200 bg-violet-50 p-4">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-violet-700" />

                <p className="text-sm font-black text-violet-950">
                  AI Category
                </p>
              </div>

              {displayedCategory ? (
                <div className="mt-3">
                  <p className="text-xl font-black text-violet-950">
                    {displayedCategory}
                  </p>

                  {aiResults[activeImageKey] && (
                    <p className="mt-1 text-xs font-bold text-violet-700">
                      Confidence{" "}
                      {Math.round(
                        aiResults[activeImageKey].confidence * 100,
                      )}
                      %
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs font-bold text-violet-700">
                  Is image ka AI analysis abhi nahi hua.
                </p>
              )}

              <div className="mt-4 space-y-2 border-t border-violet-200 pt-4">
                <label
                  htmlFor={`manual-category-${activeImageKey}`}
                  className="block text-xs font-black uppercase tracking-wide text-violet-800"
                >
                  Manual Category
                </label>

                <select
                  id={`manual-category-${activeImageKey}`}
                  value={manualCategory}
                  onChange={(event) => {
                    setManualCategory(event.target.value);
                    setCategorySaved(false);
                  }}
                  className="h-11 w-full rounded-2xl border border-violet-300 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-violet-600"
                >
                  <option value="">Select category</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={saveManualCategory}
                  disabled={!manualCategory.trim()}
                  className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-violet-300 bg-white px-4 text-sm font-black text-violet-800 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {categorySaved ? "Category Saved" : "Save Category"}
                </button>
              </div>

              <button
                type="button"
                onClick={() => void analyzeImage(activeImage)}
                disabled={busyKey === `__ai__:${activeImageKey}`}
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-violet-700 px-4 text-sm font-black text-white hover:bg-violet-800 disabled:opacity-60"
              >
                {busyKey === `__ai__:${activeImageKey}` ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}

                {aiResults[activeImageKey]
                  ? "Analyze Again"
                  : "Analyze AI"}
              </button>
            </div>
                        <div className="rounded-3xl border border-slate-200 p-4">
              <p className="mb-3 text-sm font-black text-slate-900">
                Actions
              </p>

              <div className="grid gap-2">

                <button
                  type="button"
                  onClick={() => void copyUrl(activeImage.url)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  <Clipboard className="h-4 w-4" />
                  Copy URL
                </button>

                <a
                  href={activeImage.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Image
                </a>

                <button
                  type="button"
                  onClick={() => void handleJpgDownload(activeImage)}
                  disabled={busyKey === activeImageKey}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busyKey === activeImageKey ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}

                  Download JPG
                </button>

                <button
                  type="button"
                  onClick={() => toggleImageSelection(activeImageKey)}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  {selectedKeys.includes(activeImageKey)
                    ? "Unselect Image"
                    : "Select Image"}
                </button>

                <button
                  type="button"
                  onClick={toggleSelectAllInGroup}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  {selectedKeys.length === activeGroup.images.length
                    ? "Unselect All"
                    : "Select All"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
