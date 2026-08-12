"use client";

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Images,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type GalleryImage = {
  key: string;
  url: string;
  sku: string;
  currency: string;
  size: number;
  lastModified: string;
  imageNumber: string;
  fabric: string;
  fabricDetail: string;
  price: string;
  sizes: string;
};

type GalleryGroup = {
  sku: string;
  currency: string;
  count: number;
  totalSize: number;
  coverUrl: string;
  latestUpload: string;
  fabric: string;
  fabricDetail: string;
  price: string;
  sizes: string;
  images: GalleryImage[];
};

type GalleryResponse = {
  success: boolean;
  message?: string;
  groups?: GalleryGroup[];
  pagination?: {
    hasMore?: boolean;
    nextCursor?: string;
    pageSize?: number;
  };
};

const FOLDER_PAGE_SIZE = 300;

function mergeGroups(current: GalleryGroup[], incoming: GalleryGroup[]) {
  const map = new Map<string, GalleryGroup>();

  for (const group of [...current, ...incoming]) {
    const key = `${group.sku}:${group.currency}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        ...group,
        images: [...group.images],
      });
      continue;
    }

    const imageMap = new Map(
      [...existing.images, ...group.images].map((image) => [image.key, image]),
    );

    const images = Array.from(imageMap.values()).sort((a, b) => {
      const aNo = Number(a.imageNumber || 999999);
      const bNo = Number(b.imageNumber || 999999);
      return aNo !== bNo ? aNo - bNo : a.key.localeCompare(b.key);
    });

    const incomingIsNewer = group.latestUpload > existing.latestUpload;

    map.set(key, {
      ...existing,
      ...group,
      count: images.length,
      totalSize: images.reduce((sum, image) => sum + Number(image.size || 0), 0),
      coverUrl: incomingIsNewer ? group.coverUrl : existing.coverUrl,
      latestUpload: incomingIsNewer ? group.latestUpload : existing.latestUpload,
      images,
    });
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      b.latestUpload.localeCompare(a.latestUpload) ||
      a.sku.localeCompare(b.sku, undefined, { numeric: true }),
  );
}

function cleanPrice(value: string) {
  const number = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function money(group: GalleryGroup) {
  const price = cleanPrice(group.price);
  if (price === null) return "";
  return `${group.currency} ${price.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function unique(values: string[]) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

export default function PublicR2GalleryPage() {
  const [groups, setGroups] = useState<GalleryGroup[]>([]);
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState("ALL");
  const [fabric, setFabric] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [activeGroup, setActiveGroup] = useState<GalleryGroup | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [urlReady, setUrlReady] = useState(false);

  const loadGallery = useCallback(async (cursor = "") => {
    const isMore = Boolean(cursor);

    if (isMore) setLoadingMore(true);
    else setLoading(true);

    setError("");

    try {
      const params = new URLSearchParams({
        folderLimit: String(FOLDER_PAGE_SIZE),
      });

      if (cursor) params.set("cursor", cursor);

      const response = await fetch(
        `/api/public/r2/gallery?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as GalleryResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Public gallery load failed");
      }

      setGroups((current) =>
        mergeGroups(isMore ? current : [], data.groups || []),
      );
      setNextCursor(data.pagination?.nextCursor || "");
      setHasMore(Boolean(data.pagination?.hasMore));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Public gallery load failed",
      );
    } finally {
      if (isMore) setLoadingMore(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get("search") || "");
    setCurrency(params.get("currency") || "ALL");
    setFabric(params.get("fabric") || "ALL");
    setUrlReady(true);
    void loadGallery();
  }, [loadGallery]);

  useEffect(() => {
    if (!urlReady) return;

    const params = new URLSearchParams();

    if (search.trim()) params.set("search", search.trim());
    if (currency !== "ALL") params.set("currency", currency);
    if (fabric !== "ALL") params.set("fabric", fabric);

    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }, [urlReady, search, currency, fabric]);

  const currencies = useMemo(
    () => unique(groups.map((group) => group.currency)),
    [groups],
  );

  const fabrics = useMemo(
    () =>
      unique(
        groups.map(
          (group) =>
            group.fabric ||
            group.fabricDetail ||
            group.images.find((image) => image.fabric)?.fabric ||
            "",
        ),
      ),
    [groups],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return groups.filter((group) => {
      const groupFabric =
        group.fabric ||
        group.fabricDetail ||
        group.images.find((image) => image.fabric)?.fabric ||
        "";

      return (
        (!query || group.sku.toLowerCase().includes(query)) &&
        (currency === "ALL" || group.currency === currency) &&
        (fabric === "ALL" || groupFabric === fabric)
      );
    });
  }, [groups, search, currency, fabric]);

  function openGroup(group: GalleryGroup) {
    setActiveGroup(group);
    setActiveIndex(0);
  }

  function closePreview() {
    setActiveGroup(null);
    setActiveIndex(0);
  }

  function previousImage() {
    if (!activeGroup) return;
    setActiveIndex((index) =>
      index <= 0 ? activeGroup.images.length - 1 : index - 1,
    );
  }

  function nextImage() {
    if (!activeGroup) return;
    setActiveIndex((index) =>
      index >= activeGroup.images.length - 1 ? 0 : index + 1,
    );
  }

  async function copyFilteredLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      const input = document.createElement("textarea");
      input.value = window.location.href;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }

    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1600);
  }

  async function downloadAsJpg(image: GalleryImage) {
    if (downloadBusy) return;

    setDownloadBusy(true);

    try {
      const response = await fetch(image.url, { cache: "no-store" });

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
              if (result) resolve(result);
              else reject(new Error("JPG conversion failed"));
            },
            "image/jpeg",
            0.95,
          );
        });

        const jpgUrl = URL.createObjectURL(jpgBlob);
        const link = document.createElement("a");
        const number = image.imageNumber || String(activeIndex + 1).padStart(2, "0");

        link.href = jpgUrl;
        link.download = `${image.sku}-${image.currency}-${number}.jpg`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(jpgUrl);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (downloadError) {
      window.alert(
        downloadError instanceof Error
          ? downloadError.message
          : "JPG download failed",
      );
    } finally {
      setDownloadBusy(false);
    }
  }

  const activeImage = activeGroup?.images[activeIndex];

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-slate-950 px-4 py-5 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Public Product Images
            </p>
            <h1 className="mt-1 text-2xl font-black">Mysmar R2 Gallery</h1>
            <p className="mt-1 text-xs text-slate-300">
              Read-only public gallery. No ERP login required.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyFilteredLink}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-white"
            >
              <Copy size={15} />
              {linkCopied ? "Link Copied" : "Copy Gallery Link"}
            </button>

            <button
              type="button"
              onClick={() => void loadGallery()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 py-4 md:grid-cols-[1fr_180px_220px_auto]">
          <label className="relative block">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search SKU"
              className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm font-bold outline-none focus:border-slate-500"
            />
          </label>

          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold"
          >
            <option value="ALL">All Currencies</option>
            {currencies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            value={fabric}
            onChange={(event) => setFabric(event.target.value)}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold"
          >
            <option value="ALL">All Fabrics</option>
            {fabrics.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setCurrency("ALL");
              setFabric("ALL");
            }}
            className="h-11 rounded-xl border border-slate-300 bg-slate-50 px-4 text-sm font-black text-slate-700"
          >
            Reset
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-3 py-5 sm:px-5">
        {!loading && !error && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-600">
            <span>
              {filtered.length} folders shown · {groups.length} loaded
            </span>
            <span>Public read-only view</span>
          </div>
        )}

        {loading && (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white">
            <div className="text-center">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-700" />
              <p className="mt-3 text-sm font-bold text-slate-500">
                Loading R2 gallery...
              </p>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="font-bold text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => void loadGallery()}
              className="mt-3 rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white"
            >
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <Images className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-bold text-slate-500">
              No gallery folders found for these filters.
            </p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filtered.map((group) => {
                const groupFabric =
                  group.fabric ||
                  group.fabricDetail ||
                  group.images.find((image) => image.fabric)?.fabric ||
                  "";

                return (
                  <button
                    key={`${group.sku}:${group.currency}`}
                    type="button"
                    onClick={() => openGroup(group)}
                    className="flex min-h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="aspect-[4/5] w-full overflow-hidden bg-slate-100">
                      <img
                        src={group.coverUrl}
                        alt={group.sku}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </div>

                    <div className="flex flex-1 flex-col p-3">
                      <p className="truncate text-sm font-black text-slate-950">
                        {group.sku}
                      </p>

                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                        <span>{group.currency}</span>
                        <span>
                          {group.count} image{group.count === 1 ? "" : "s"}
                        </span>
                      </div>

                      {money(group) && (
                        <p className="mt-2 text-sm font-black text-emerald-700">
                          {money(group)}
                        </p>
                      )}

                      {groupFabric && (
                        <p className="mt-1 line-clamp-1 text-[11px] font-bold text-slate-500">
                          {groupFabric}
                        </p>
                      )}

                      {group.sizes && (
                        <p className="mt-auto pt-2 text-[11px] font-bold text-slate-400">
                          Size: {group.sizes}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {hasMore && nextCursor && (
              <div className="mt-7 text-center">
                <button
                  type="button"
                  onClick={() => void loadGallery(nextCursor)}
                  disabled={loadingMore}
                  className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-60"
                >
                  {loadingMore && <Loader2 size={16} className="animate-spin" />}
                  {loadingMore ? "Loading..." : "Load More"}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {activeGroup && activeImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
              <div>
                <h2 className="text-lg font-black text-slate-950">
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
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={22} />
              </button>
            </div>

            <div className="grid gap-5 p-4 lg:grid-cols-[1fr_300px] lg:p-5">
              <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-3xl bg-slate-100">
                <img
                  src={activeImage.url}
                  alt={`${activeGroup.sku} ${activeIndex + 1}`}
                  className="max-h-[75vh] w-auto max-w-full object-contain"
                />

                {activeGroup.images.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={previousImage}
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 shadow-lg"
                    >
                      <ChevronLeft size={22} />
                    </button>

                    <button
                      type="button"
                      onClick={nextImage}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 shadow-lg"
                    >
                      <ChevronRight size={22} />
                    </button>
                  </>
                )}
              </div>

              <aside className="space-y-4">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <dl className="space-y-3 text-sm">
                    <InfoRow label="SKU" value={activeGroup.sku} />
                    <InfoRow label="Currency" value={activeGroup.currency} />
                    <InfoRow
                      label="Price"
                      value={money(activeGroup) || "—"}
                    />
                    <InfoRow
                      label="Fabric"
                      value={
                        activeGroup.fabric ||
                        activeGroup.fabricDetail ||
                        activeImage.fabric ||
                        activeImage.fabricDetail ||
                        "—"
                      }
                    />
                    <InfoRow
                      label="Sizes"
                      value={activeGroup.sizes || activeImage.sizes || "—"}
                    />
                    <InfoRow
                      label="Image No."
                      value={activeImage.imageNumber || "—"}
                    />
                  </dl>
                </div>

                <button
                  type="button"
                  onClick={() => void downloadAsJpg(activeImage)}
                  disabled={downloadBusy}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-60"
                >
                  {downloadBusy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  {downloadBusy ? "Preparing JPG..." : "Download JPG"}
                </button>

                <a
                  href={activeImage.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white"
                >
                  <ExternalLink size={16} />
                  Open Full Image
                </a>

                <div className="grid grid-cols-4 gap-2">
                  {activeGroup.images.map((image, index) => (
                    <button
                      key={image.key}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      className={`aspect-square overflow-hidden rounded-xl border ${
                        index === activeIndex
                          ? "border-slate-950 ring-2 ring-slate-950/10"
                          : "border-slate-200"
                      }`}
                    >
                      <img
                        src={image.url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="font-bold text-slate-500">{label}</dt>
      <dd className="text-right font-black text-slate-900">{value}</dd>
    </div>
  );
}
