"use client";

import { Suspense } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSearchParams } from "next/navigation";
import {
  ArrowDownUp,
  Boxes,
  ImageIcon,
  RefreshCw,
  Search,
  WalletCards,
} from "lucide-react";

type InventoryItem = {
  id: string;
  sku: string;
  imageUrl: string;
  quantity: number;
  price: number | null;
  totalValue: number;
};

type SortOption =
  | "quantity-desc"
  | "quantity-asc"
  | "sku-asc"
  | "sku-desc"
  | "price-desc"
  | "price-asc";

function InventoryListContent() {
  const searchParams = useSearchParams();
  const requestedType =
    searchParams.get("type") === "fab-stock"
      ? "fab-stock"
      : "dq";

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [baseName, setBaseName] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] =
    useState<SortOption>("quantity-desc");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [totalStockValue, setTotalStockValue] = useState(0);

  const isFab = requestedType === "fab-stock";

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
    }).format(value);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/inventory/list?type=${requestedType}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Inventory load failed"
        );
      }

      setItems(data.items || []);
      setBaseName(data.baseName || "");
      setTotalQuantity(Number(data.totalQuantity || 0));
      setTotalStockValue(
        Number(data.totalStockValue || 0)
      );
    } catch (error) {
      setItems([]);
      setBaseName("");
      setTotalQuantity(0);
      setTotalStockValue(0);
      setMessage(
        error instanceof Error
          ? error.message
          : "Inventory load failed"
      );
    } finally {
      setLoading(false);
    }
  }, [requestedType]);

  useEffect(() => {
    setSearch("");
    setSort("quantity-desc");
    loadInventory();
  }, [loadInventory]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = query
      ? items.filter((item) =>
          item.sku.toLowerCase().includes(query)
        )
      : [...items];

    filtered.sort((a, b) => {
      switch (sort) {
        case "quantity-asc":
          return a.quantity - b.quantity;
        case "sku-asc":
          return a.sku.localeCompare(b.sku);
        case "sku-desc":
          return b.sku.localeCompare(a.sku);
        case "price-desc":
          return Number(b.price || 0) - Number(a.price || 0);
        case "price-asc":
          return Number(a.price || 0) - Number(b.price || 0);
        case "quantity-desc":
        default:
          return b.quantity - a.quantity;
      }
    });

    return filtered;
  }, [items, search, sort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-950">
            {isFab
              ? "Inventory List FAB"
              : "Inventory List DQ"}
          </h1>

          <p className="mt-1 text-sm font-bold text-slate-500">
            {baseName ||
              (isFab
                ? "FAB Doha Stock"
                : "i5Q/DQ")}
          </p>
        </div>

        <button
          type="button"
          onClick={loadInventory}
          disabled={loading}
          className="flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 font-black text-white disabled:opacity-50"
        >
          <RefreshCw
            size={17}
            className={loading ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase text-slate-500">
            In-stock SKUs
          </p>
          <p className="mt-2 text-3xl font-black text-slate-950">
            {items.length}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase text-slate-500">
            Total Quantity
          </p>
          <p className="mt-2 text-3xl font-black text-slate-950">
            {formatNumber(totalQuantity)}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-slate-500">
                Total Stock Value
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {isFab ? "QAR " : ""}
                {formatNumber(totalStockValue)}
              </p>
            </div>

            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <WalletCards size={22} />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div>
            <label className="text-xs font-black uppercase text-slate-500">
              Search SKU
            </label>

            <div className="relative mt-1">
              <Search
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Type SKU"
                className="h-11 w-full rounded-xl border border-slate-200 pl-11 pr-4 font-bold outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-black uppercase text-slate-500">
              Sort
            </label>

            <div className="relative mt-1">
              <ArrowDownUp
                size={17}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as SortOption)
                }
                className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-11 pr-4 font-bold outline-none focus:border-blue-500"
              >
                <option value="quantity-desc">
                  Quantity High → Low
                </option>
                <option value="quantity-asc">
                  Quantity Low → High
                </option>
                <option value="sku-asc">
                  SKU A → Z
                </option>
                <option value="sku-desc">
                  SKU Z → A
                </option>

                {isFab && (
                  <>
                    <option value="price-desc">
                      Price High → Low
                    </option>
                    <option value="price-asc">
                      Price Low → High
                    </option>
                  </>
                )}
              </select>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-black text-red-700">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-5 py-4 text-left">
                  Image
                </th>
                <th className="px-5 py-4 text-left">
                  SKU
                </th>
                <th className="px-5 py-4 text-right">
                  Quantity
                </th>
                {isFab && (
                  <th className="px-5 py-4 text-right">
                    Price
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={isFab ? 4 : 3}
                    className="px-5 py-16 text-center font-bold text-slate-500"
                  >
                    Loading inventory...
                  </td>
                </tr>
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={isFab ? 4 : 3}
                    className="px-5 py-16 text-center"
                  >
                    <Boxes
                      size={34}
                      className="mx-auto text-slate-300"
                    />
                    <p className="mt-3 font-black text-slate-500">
                      No in-stock products found
                    </p>
                  </td>
                </tr>
              ) : (
                visibleItems.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-5 py-3">
                      <div className="grid h-20 w-16 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.sku}
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <ImageIcon
                            size={20}
                            className="text-slate-300"
                          />
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-3 text-base font-black text-slate-900">
                      {item.sku}
                    </td>

                    <td className="px-5 py-3 text-right">
                      <span className="inline-flex min-w-16 justify-center rounded-xl bg-emerald-50 px-3 py-2 font-black text-emerald-700">
                        {formatNumber(item.quantity)}
                      </span>
                    </td>

                    {isFab && (
                      <td className="px-5 py-3 text-right font-black text-slate-900">
                        QAR{" "}
                        {Number(item.price || 0).toFixed(2)}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && visibleItems.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-sm font-bold text-slate-500">
            Showing {visibleItems.length} of {items.length} SKUs
          </div>
        )}
      </div>
    </div>
  );
}


export default function InventoryListPage() {
  return (
    <Suspense fallback={<div className="p-6 font-bold">Loading...</div>}>
      <InventoryListContent />
    </Suspense>
  );
}
