"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  Search,
} from "lucide-react";

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
  return image?.thumbnails?.small?.url || image?.thumbnails?.large?.url || image?.url || "";
}

function formatPrice(value: any) {
  const price = getNumber(value);
  if (price === "" || price === "-") return "-";
  return String(price);
}

export default function ProductsPage() {
  const [records, setRecords] = useState<AirtableRecord[]>([]);
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
    loadProducts("", value);
  }

  const rows = useMemo(() => {
    return records.map((record) => {
      const fields = record.fields;

      return {
        id: record.id,

        // Products table fields
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
          fields["Stock"] ??
          fields.stock ??
          fields.Status ??
          "-",
        created: fields.Created || fields.created || fields["Created time"] || "-",
      };
    });
  }, [records]);

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

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-4">Image</th>
                  <th className="px-4 py-4">SKU</th>
                  <th className="px-4 py-4">Supplier Code</th>
                  <th className="px-4 py-4">Price</th>
                  <th className="px-4 py-4">Stock</th>
                  <th className="px-4 py-4">Created</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <div className="flex items-center justify-center gap-2 font-bold text-slate-500">
                        <Loader2 className="animate-spin" size={18} />
                        Loading Airtable products...
                      </div>
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((product) => (
                    <tr key={product.id} className="transition hover:bg-emerald-50/40">
                      <td className="px-4 py-3">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={String(product.sku)}
                            className="h-14 w-12 rounded-xl object-cover ring-1 ring-slate-200"
                          />
                        ) : (
                          <div className="grid h-14 w-12 place-items-center rounded-xl bg-slate-100 text-slate-400">
                            <ImageIcon size={18} />
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-4 font-bold text-slate-900">
                        {product.sku}
                      </td>

                      <td className="px-4 py-4">
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                          {product.supplier}
                        </span>
                      </td>

                      <td className="px-4 py-4 font-bold text-emerald-700">
                        {product.price === "-" ? "-" : `AED ${product.price}`}
                      </td>

                      <td className="px-4 py-4">
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                          {String(product.stock)}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-slate-600">
                        {String(product.created)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center font-semibold text-slate-500">
                      No products found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            disabled={!history.length || loading}
            onClick={() => {
              const previous = history[history.length - 1] || "";
              setHistory((items) => items.slice(0, -1));
              loadProducts(previous);
            }}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={18} />
            Previous
          </button>

          <button
            disabled={!nextOffset || loading}
            onClick={() => {
              setHistory((items) => [...items, offset]);
              loadProducts(nextOffset);
            }}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
