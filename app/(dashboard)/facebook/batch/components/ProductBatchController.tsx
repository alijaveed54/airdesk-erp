"use client";

import {
  Loader2,
  Send,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  getProductBatchState,
  getSelectedProducts,
  setProductBatchField,
  toggleProductBatchPage,
  useProductBatchStore,
} from "./product-batch-store";

type FacebookPage = {
  id: string;
  pageName: string;
  pageId: string;
  active: boolean;
};

type PagesResponse = {
  success: boolean;
  message?: string;
  pages?: FacebookPage[];
};

type BatchResponse = {
  success: boolean;
  message?: string;
};

export default function ProductBatchController() {
  const store = useProductBatchStore();
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [loadingPages, setLoadingPages] = useState(true);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const loadPages = useCallback(async () => {
    setLoadingPages(true);

    try {
      const response = await fetch("/api/facebook/pages", {
        cache: "no-store",
      });
      const data = (await response.json()) as PagesResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Facebook Pages load nahi ho sake.");
      }

      setPages((data.pages || []).filter((page) => page.active));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Facebook Pages load nahi ho sake."
      );
    } finally {
      setLoadingPages(false);
    }
  }, []);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  const selectedProducts = getSelectedProducts();
  const jobCount =
    selectedProducts.length * store.pageRecordIds.length;

  async function handleCreateProductBatch() {
    setError("");
    setSuccess("");

    if (!selectedProducts.length) {
      setError("Kam az kam ek product select karein.");
      return;
    }

    if (!store.pageRecordIds.length) {
      setError("Kam az kam ek Facebook Page select karein.");
      return;
    }

    const missingImages = selectedProducts.filter(
      (product) => product.images.length === 0
    );

    if (missingImages.length) {
      setError(
        `${missingImages.length} selected product(s) mein image nahi hai.`
      );
      return;
    }

    setProductBatchField("submitting", true);

    try {
      const batchId = crypto.randomUUID();
      const payload = {
        batchId,
        batchName:
          store.batchName.trim() ||
          `Product Batch ${new Date().toLocaleString("en-PK")}`,
        pageRecordIds: store.pageRecordIds,
        intervalMinutes: store.intervalMinutes,
        startAt: store.startAt
          ? new Date(store.startAt).toISOString()
          : "",
        products: selectedProducts.map((product) => ({
          sku: product.sku,
          caption: product.caption.trim(),
          imageUrls: product.images,
        })),
      };

      const response = await fetch("/api/facebook/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as BatchResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Product batch create nahi ho saka.");
      }

      setSuccess(
        data.message ||
          `${selectedProducts.length} product(s) se batch queue ho gaya.`
      );
      setProductBatchField("batchName", "");
      setProductBatchField("startAt", "");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Product batch create nahi ho saka."
      );
    } finally {
      setProductBatchField("submitting", false);
    }
  }

  if (loadingPages) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3 text-sm font-bold text-slate-500">
          <Loader2 size={18} className="animate-spin" />
          Loading product batch controller...
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-black text-slate-900">
          Product Batch Controller
        </h2>
        <p className="mt-1 text-sm font-semibold text-slate-600">
          Selected products ko shared Pages par queue karein.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-black text-slate-600">
              Batch Name
            </span>
            <input
              value={store.batchName}
              onChange={(event) =>
                setProductBatchField("batchName", event.target.value)
              }
              placeholder="Example: New Arrivals Product Batch"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
            />
          </label>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-800">
                  Facebook Pages
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  Har selected product in Pages par post hoga.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  const current = getProductBatchState();
                  setProductBatchField(
                    "pageRecordIds",
                    current.pageRecordIds.length === pages.length
                      ? []
                      : pages.map((page) => page.id)
                  );
                }}
                className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700"
              >
                {store.pageRecordIds.length === pages.length
                  ? "Clear All"
                  : "Select All"}
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {pages.map((page) => {
                const selected = store.pageRecordIds.includes(page.id);

                return (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => toggleProductBatchPage(page.id)}
                    className={[
                      "flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                      selected
                        ? "border-indigo-400 bg-indigo-50 ring-4 ring-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs font-black",
                        selected
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-300 text-transparent",
                      ].join(" ")}
                    >
                      ✓
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-slate-800">
                        {page.pageName}
                      </span>
                      <span className="block truncate text-[11px] font-semibold text-slate-500">
                        {page.pageId}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-black text-slate-600">
              Start At
            </span>
            <input
              type="datetime-local"
              value={store.startAt}
              onChange={(event) =>
                setProductBatchField("startAt", event.target.value)
              }
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-xs font-bold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-black text-slate-600">
              Minutes Between Posts
            </span>
            <input
              type="number"
              min={0}
              max={1440}
              value={store.intervalMinutes}
              onChange={(event) =>
                setProductBatchField(
                  "intervalMinutes",
                  Number(event.target.value) || 0
                )
              }
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
            />
          </label>

          <div className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">
            {selectedProducts.length} product(s) × {store.pageRecordIds.length}{" "}
            page(s) = {jobCount} jobs
          </div>

          <button
            type="button"
            onClick={() => void handleCreateProductBatch()}
            disabled={store.submitting || jobCount === 0}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-black text-white hover:from-indigo-700 hover:to-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {store.submitting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
            Queue Product Batch
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </p>
      )}

      {success && (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {success}
        </p>
      )}
    </section>
  );
}
