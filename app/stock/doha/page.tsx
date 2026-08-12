"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard, { type PublicStockProduct } from "@/components/stock/ProductCard";
import StockFilters from "@/components/stock/StockFilters";
import ImageViewer from "@/components/stock/ImageViewer";

const PAGE_SIZE = 24;

export default function DohaPublicStockPage() {
  const [products, setProducts] = useState<PublicStockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [sort, setSort] = useState("sku-asc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedProduct, setSelectedProduct] = useState<PublicStockProduct | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  async function loadProducts() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/public/stock/doha", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load stock");
      }

      setProducts(data.products || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load stock");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    setSearch(params.get("search") || "");
    setCategory(params.get("category") || "");
    setColor(params.get("color") || "");
    setSize(params.get("size") || "");
    setSort(params.get("sort") || "sku-asc");
    setUrlReady(true);

    void loadProducts();
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, category, color, size, sort]);

  useEffect(() => {
    if (!urlReady) return;

    const params = new URLSearchParams();

    if (search.trim()) params.set("search", search.trim());
    if (category) params.set("category", category);
    if (color) params.set("color", color);
    if (size) params.set("size", size);
    if (sort !== "sku-asc") params.set("sort", sort);

    const queryString = params.toString();
    const nextUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname;

    window.history.replaceState(null, "", nextUrl);
  }, [urlReady, search, category, color, size, sort]);

  const availableProducts = useMemo(
    () => products.filter((product) => product.balanceStock >= 1),
    [products],
  );

  const query = search.trim().toLowerCase();

  const categories = useMemo(
    () =>
      unique(
        availableProducts
          .filter(
            (product) =>
              (!query || product.sku.toLowerCase().includes(query)) &&
              (!color || product.color === color) &&
              (!size || product.size === size),
          )
          .map((product) => product.category),
      ),
    [availableProducts, query, color, size],
  );

  const colors = useMemo(
    () =>
      unique(
        availableProducts
          .filter(
            (product) =>
              (!query || product.sku.toLowerCase().includes(query)) &&
              (!category || product.category === category) &&
              (!size || product.size === size),
          )
          .map((product) => product.color),
      ),
    [availableProducts, query, category, size],
  );

  const sizes = useMemo(
    () =>
      unique(
        availableProducts
          .filter(
            (product) =>
              (!query || product.sku.toLowerCase().includes(query)) &&
              (!category || product.category === category) &&
              (!color || product.color === color),
          )
          .map((product) => product.size),
      ),
    [availableProducts, query, category, color],
  );

  useEffect(() => {
    if (!loading && category && !categories.includes(category)) setCategory("");
  }, [loading, category, categories]);

  useEffect(() => {
    if (!loading && color && !colors.includes(color)) setColor("");
  }, [loading, color, colors]);

  useEffect(() => {
    if (!loading && size && !sizes.includes(size)) setSize("");
  }, [loading, size, sizes]);

  const filteredProducts = useMemo(() => {
    const result = availableProducts.filter((product) => {
      return (
        (!query || product.sku.toLowerCase().includes(query)) &&
        (!category || product.category === category) &&
        (!color || product.color === color) &&
        (!size || product.size === size)
      );
    });

    return [...result].sort((a, b) => {
      if (sort === "price-asc") return a.price - b.price;
      if (sort === "price-desc") return b.price - a.price;
      if (sort === "stock-desc") return b.balanceStock - a.balanceStock;
      return a.sku.localeCompare(b.sku);
    });
  }, [availableProducts, query, category, color, size, sort]);

  function resetFilters() {
    setSearch("");
    setCategory("");
    setColor("");
    setSize("");
    setSort("sku-asc");
  }

  async function copyFilteredLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      const input = document.createElement("textarea");
      input.value = window.location.href;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1800);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-slate-950 px-4 py-5 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Live Availability</p>
            <h1 className="text-2xl font-black">Doha Stock</h1>
            <p className="mt-1 text-xs text-slate-300">Only products with at least 1 piece in stock are shown.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={copyFilteredLink}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-white"
            >
              {linkCopied ? "Link Copied" : "Copy Filtered Link"}
            </button>
            <button
              type="button"
              onClick={loadProducts}
              className="rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-950"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <StockFilters
        search={search}
        category={category}
        color={color}
        size={size}
        sort={sort}
        categories={categories}
        colors={colors}
        sizes={sizes}
        onSearchChange={setSearch}
        onCategoryChange={setCategory}
        onColorChange={setColor}
        onSizeChange={setSize}
        onSortChange={setSort}
        onReset={resetFilters}
      />

      <section className="mx-auto max-w-7xl px-3 py-5 sm:px-5">
        {!loading && !error && (
          <div className="mb-4 flex items-center justify-between text-xs font-bold text-slate-600">
            <span>{filteredProducts.length} products available</span>
            <span>Live stock</span>
          </div>
        )}

        {loading && <Message text="Loading available stock..." />}

        {!loading && error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="font-bold text-red-700">{error}</p>
            <button type="button" onClick={loadProducts} className="mt-3 rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white">
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && filteredProducts.length === 0 && (
          <Message text="No available products found for these filters." />
        )}

        {!loading && !error && filteredProducts.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredProducts.slice(0, visibleCount).map((product) => (
                <ProductCard key={product.id} product={product} onImageClick={setSelectedProduct} />
              ))}
            </div>

            {visibleCount < filteredProducts.length && (
              <div className="mt-6 text-center">
                <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white">
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <ImageViewer product={selectedProduct} onClose={() => setSelectedProduct(null)} />
    </main>
  );
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function Message({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500 shadow-sm">
      {text}
    </div>
  );
}
