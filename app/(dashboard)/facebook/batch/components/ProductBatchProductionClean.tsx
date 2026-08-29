"use client";

import {
  Loader2,
  PackageSearch,
  Search,
} from "lucide-react";
import {
  FormEvent,
  useState,
} from "react";

import {
  getProductBatchState,
  ProductBatchItem,
  setProductBatchField,
  setProductBatchProducts,
  selectAllProducts,
  toggleProductSelection,
  updateProductCaption,
  useProductBatchStore,
} from "./product-batch-store";

type ProductsResponse = {
  success: boolean;
  message?: string;
  products?: Array<{
    productId: string;
    sku: string;
    name: string;
    category: string;
    color: string;
    price: number;
    images: string[] | string;
  }>;
};

function normalizeImages(value: string[] | string | undefined) {
  if (!value) return [] as string[];
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(String);
  }

  return String(value)
    .split(/[\n,|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapProducts(
  products: NonNullable<ProductsResponse["products"]>
): ProductBatchItem[] {
  return products.map((product) => ({
    productId: product.productId,
    sku: product.sku || "",
    name: product.name || product.sku || "Product",
    category: product.category || "",
    color: product.color || "",
    price: Number(product.price || 0),
    images: normalizeImages(product.images),
    caption: product.name
      ? `${product.name}${product.sku ? ` · ${product.sku}` : ""}`
      : product.sku || "",
  }));
}

export default function ProductBatchProductionClean() {
  const store = useProductBatchStore();
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("");
  const [sku, setSku] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  async function handleSearch(event: FormEvent) {
    event.preventDefault();

    setProductBatchField("loading", true);
    setProductBatchField("error", "");

    try {
      const response = await fetch("/api/facebook/batch/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          color,
          sku,
          minPrice: minPrice ? Number(minPrice) : 0,
          maxPrice: maxPrice ? Number(maxPrice) : 0,
        }),
      });

      const data = (await response.json()) as ProductsResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Products load nahi ho sake.");
      }

      setProductBatchProducts(mapProducts(data.products || []));
    } catch (searchError) {
      setProductBatchField(
        "error",
        searchError instanceof Error
          ? searchError.message
          : "Products load nahi ho sake."
      );
      setProductBatchProducts([]);
    } finally {
      setProductBatchField("loading", false);
    }
  }

  const selectedCount = store.selectedIds.size;
  const allSelected =
    store.products.length > 0 &&
    selectedCount === store.products.length;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-slate-900">
            <PackageSearch size={20} />
            <h2 className="text-xl font-black">
              Product Batch Builder
            </h2>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Airtable products filter karein, select karein, phir neeche controller se batch queue banayein.
          </p>
        </div>

        {store.products.length > 0 && (
          <button
            type="button"
            onClick={selectAllProducts}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            {allSelected ? "Clear Selection" : "Select All"}
          </button>
        )}
      </div>

      <form
        onSubmit={(event) => void handleSearch(event)}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"
      >
        <label className="block xl:col-span-2">
          <span className="mb-1.5 block text-xs font-black text-slate-600">
            SKU / Search
          </span>
          <input
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder="SKU ya product name"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-slate-600">
            Category
          </span>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Category"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-slate-600">
            Color
          </span>
          <input
            value={color}
            onChange={(event) => setColor(event.target.value)}
            placeholder="Color"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-slate-600">
            Min Price
          </span>
          <input
            type="number"
            min={0}
            value={minPrice}
            onChange={(event) => setMinPrice(event.target.value)}
            placeholder="0"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-slate-600">
            Max Price
          </span>
          <input
            type="number"
            min={0}
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
            placeholder="0"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>

        <div className="flex items-end xl:col-span-6">
          <button
            type="submit"
            disabled={store.loading}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {store.loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Search size={16} />
            )}
            Search Products
          </button>
        </div>
      </form>

      {store.error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {store.error}
        </p>
      )}

      {store.products.length === 0 ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-sm font-bold text-slate-400">
          Product search karke batch ke liye items select karein.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">
            {selectedCount} of {store.products.length} selected
          </p>

          <div className="grid gap-3 lg:grid-cols-2">
            {store.products.map((product) => {
              const selected = store.selectedIds.has(product.productId);
              const preview = product.images[0] || "";

              return (
                <article
                  key={product.productId}
                  className={[
                    "rounded-2xl border p-4 transition",
                    selected
                      ? "border-blue-400 bg-blue-50 ring-4 ring-blue-50"
                      : "border-slate-200 bg-white",
                  ].join(" ")}
                >
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        toggleProductSelection(product.productId)
                      }
                      className="shrink-0"
                      aria-label={`Select ${product.name}`}
                    >
                      <span
                        className={[
                          "grid h-5 w-5 place-items-center rounded-md border text-xs font-black",
                          selected
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 text-transparent",
                        ].join(" ")}
                      >
                        ✓
                      </span>
                    </button>

                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                      {preview ? (
                        <img
                          src={preview}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[10px] font-black text-slate-400">
                          No Image
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-slate-900">
                        {product.name}
                      </p>
                      <p className="truncate text-xs font-semibold text-slate-500">
                        {product.sku || "No SKU"}
                        {product.price ? ` · ${product.price}` : ""}
                      </p>
                      <p className="truncate text-[11px] font-semibold text-slate-400">
                        {[product.category, product.color]
                          .filter(Boolean)
                          .join(" · ") || "No category"}
                      </p>
                      <p className="mt-1 text-[11px] font-bold text-slate-500">
                        {product.images.length} image(s)
                      </p>
                    </div>
                  </div>

                  {selected && (
                    <label className="mt-3 block">
                      <span className="mb-1 block text-[10px] font-black uppercase text-slate-500">
                        Caption
                      </span>
                      <textarea
                        value={product.caption}
                        onChange={(event) =>
                          updateProductCaption(
                            product.productId,
                            event.target.value
                          )
                        }
                        rows={3}
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                      />
                    </label>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
