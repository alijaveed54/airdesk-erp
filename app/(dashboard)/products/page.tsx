"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import ProductDrawer from "@/components/products/ProductDrawer";
import ProductPagination from "@/components/products/ProductPagination";
import ProductTable from "@/components/products/ProductTable";

type AirtableRecord = {
  id: string;
  fields: Record<string, any>;
};

type ProductsApiResponse = {
  success: boolean;
  records?: AirtableRecord[];
  offset?: string;
  message?: string;
};

type Product = {
  id: string;
  image: string;
  sku: string;
  supplier: string;
  price: string | number;
  stock: string | number;
  created: string;
};

function getFirst(value: any) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function getNumber(value: any) {
  const first = getFirst(value);
  if (first === "" || first === null || first === undefined) return "";
  return first;
}

function getImageUrl(value: any) {
  const image = Array.isArray(value) ? value[0] : value;
  return image?.url || image?.thumbnails?.full?.url || image?.thumbnails?.large?.url || image?.thumbnails?.small?.url || "";
}

function formatPrice(value: any) {
  const price = getNumber(value);
  if (price === "" || price === "-") return "-";
  return String(price);
}

function mapProduct(record: AirtableRecord): Product {
  const fields = record.fields;

  return {
    id: record.id,
    image: getImageUrl(fields.Image),
    sku: fields.SKU || "-",
    supplier:
      fields["ALV Supplier Code"] ||
      fields["Supplier Code"] ||
      fields.Supplier ||
      "-",
    price: formatPrice(fields.Price || fields.CP || fields["Sale Price"]),
    stock:
      fields["Balance Stock"] ??
      fields.Stock ??
      fields.stock ??
      fields.Status ??
      "-",
    created: fields.Created || fields.created || fields["Created time"] || "-",
  };
}

export default function ProductsPage() {
  const [records, setRecords] = useState<AirtableRecord[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState("");
  const [nextOffset, setNextOffset] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadProducts(currentOffset = "", currentSearch = search) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("pageSize", "50");
      if (currentOffset) params.set("offset", currentOffset);
      if (currentSearch) params.set("search", currentSearch);

      const res = await fetch(`/api/products?${params.toString()}`);
      const data: ProductsApiResponse = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to load products");
      }

      setRecords(data.records || []);
      setNextOffset(data.offset || "");
      setOffset(currentOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
      setRecords([]);
      setNextOffset("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    const value = searchInput.trim();
    setSearch(value);
    setHistory([]);
    setSelectedProduct(null);
    loadProducts("", value);
  }

  const products = useMemo(() => records.map(mapProduct), [records]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black text-slate-950">Products</h1>
          <p className="text-sm text-slate-500">
            Live Airtable products. Showing 50 records per page.
          </p>
        </div>

        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {loading ? "Loading..." : `${records.length} records loaded`}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              size={18}
            />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search SKU..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-50"
            />
          </div>

          <button
            type="submit"
            className="h-12 rounded-2xl bg-emerald-600 px-6 text-sm font-black text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-700"
          >
            Search
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4">
          <ProductTable
            products={products}
            loading={loading}
            onSelect={setSelectedProduct}
          />
        </div>

        <ProductPagination
          loading={loading}
          hasPrevious={history.length > 0}
          hasNext={Boolean(nextOffset)}
          onPrevious={() => {
            const previous = history[history.length - 1] || "";
            setHistory((items) => items.slice(0, -1));
            setSelectedProduct(null);
            loadProducts(previous);
          }}
          onNext={() => {
            setHistory((items) => [...items, offset]);
            setSelectedProduct(null);
            loadProducts(nextOffset);
          }}
        />
      </div>

      <ProductDrawer
        open={Boolean(selectedProduct)}
        product={selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />
    </div>
  );
}
