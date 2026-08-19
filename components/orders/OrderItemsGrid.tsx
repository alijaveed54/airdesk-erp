"use client";

import { ImageIcon, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type OrderItem = {
  id: string;
  productId: string;
  sku: string;
  supplierSku: string;
  image: string;
  purchaseSupplier: string;
  price: number;
  qty: number;
  stock: string | number;
  warehouse: boolean;
  size?: string;
  packPrice?: number;
};

type OrderItemsGridProps = {
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
  isI5qDqBase?: boolean;
};

export function getOrderItemTotal(item: OrderItem) {
  return Number(item.packPrice) > 0
    ? Number(item.packPrice)
    : Number(item.price) * Number(item.qty);
}

export default function OrderItemsGrid({
  items,
  onChange,
  isI5qDqBase = false,
}: OrderItemsGridProps) {
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);
  const [selectedBaseName, setSelectedBaseName] = useState("");
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; sku: string } | null>(null);

  useEffect(() => {
    async function loadSelectedBase() {
      try {
        const res = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        const data = await res.json();

        if (res.ok && data.success) {
          const baseName =
            data.user?.selectedBase?.baseName ||
            data.user?.permissions?.[0]?.baseName ||
            "";

          setSelectedBaseName(String(baseName));
        }
      } catch {
        setSelectedBaseName("");
      }
    }

    loadSelectedBase();
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadSuppliers() {
      setLoadingSuppliers(true);

      try {
        const res = await fetch("/api/options/suppliers");
        const data = await res.json();

        if (mounted && res.ok && data.success) {
          setSupplierOptions(data.options || []);
        }
      } catch {
        if (mounted) setSupplierOptions([]);
      } finally {
        if (mounted) setLoadingSuppliers(false);
      }
    }

    loadSuppliers();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!previewImage) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage]);

  const subtotal = useMemo(() => {
    return items.reduce((total, item) => total + getOrderItemTotal(item), 0);
  }, [items]);

  const isTatBase = useMemo(() => {
    const name = selectedBaseName.trim().toLowerCase();

    return (
      name.includes("tatlumput") ||
      name === "tat" ||
      name.startsWith("tat ")
    );
  }, [selectedBaseName]);

  const isFabStockBase = useMemo(() => {
    const name = selectedBaseName.trim().toLowerCase();

    const isFabBase = name.includes("fab");
    const isNonStock =
      name.includes("non stock") ||
      name.includes("non-stock") ||
      name.includes("without stock");

    return isFabBase && name.includes("stock") && !isNonStock;
  }, [selectedBaseName]);

  const enableStockValidation = isI5qDqBase || isFabStockBase;

  const visibleColumnCount =
    isI5qDqBase ? 8 : isTatBase || isFabStockBase ? 6 : 9;

  const currency = isI5qDqBase || isFabStockBase ? "QAR" : "AED";

  function updateItem(id: string, updates: Partial<OrderItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }

  function updateQuantity(item: OrderItem, value: number) {
    const nextQty = Math.max(1, Number(value) || 1);

    if (enableStockValidation) {
      const availableStock = Math.max(0, Number(item.stock) || 0);

      const otherLinesQty = items
        .filter(
          (otherItem) =>
            otherItem.productId === item.productId &&
            otherItem.id !== item.id
        )
        .reduce(
          (total, otherItem) => total + (Number(otherItem.qty) || 0),
          0
        );

      const remainingForThisLine = Math.max(
        0,
        availableStock - otherLinesQty
      );

      if (otherLinesQty + nextQty > availableStock) {
        alert(
          `Available stock is ${availableStock} pc(s). ` +
          `${otherLinesQty} pc(s) are already added in other lines. ` +
          `This line can have maximum ${remainingForThisLine} pc(s).`
        );

        if (remainingForThisLine > 0) {
          updateItem(item.id, {
            qty: remainingForThisLine,
          });
        }

        return;
      }
    }

    updateItem(item.id, { qty: nextQty });
  }

  function removeItem(id: string) {
    onChange(items.filter((item) => item.id !== id));
  }

  return (
    <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-lg font-black text-slate-950">Order Items</h3>
          <p className="text-sm text-slate-500">
            Har Add Product ek naya line item banayega. Duplicate SKU allowed hai.
          </p>
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-2 text-right">
          <p className="text-xs font-bold uppercase text-slate-400">Subtotal</p>
          <p className="text-lg font-black text-slate-950">{currency} {subtotal.toFixed(2)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table
          className={`w-full text-sm ${
            isI5qDqBase
              ? "min-w-[900px]"
              : isTatBase || isFabStockBase
              ? "min-w-[700px]"
              : "min-w-[980px]"
          }`}
        >
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Image</th>
              <th className="px-4 py-3 text-left">Our SKU</th>
              {isI5qDqBase && <th className="px-4 py-3 text-left">Size</th>}
              {!isTatBase && !isI5qDqBase && !isFabStockBase && <th className="px-4 py-3 text-left">Supplier SKU</th>}
              {!isTatBase && !isI5qDqBase && !isFabStockBase && <th className="px-4 py-3 text-left">Purchase Supplier</th>}
              <th className="px-4 py-3 text-left">Qty</th>
              <th className="px-4 py-3 text-left">{isI5qDqBase ? "Single Price" : "Price"}</th>
              {isI5qDqBase && <th className="px-4 py-3 text-left">Pack Price</th>}
              <th className="px-4 py-3 text-left">Total</th>
              {!isTatBase && !isI5qDqBase && !isFabStockBase && <th className="px-4 py-3 text-left">WH</th>}
              <th className="px-4 py-3 text-right">Remove</th>
            </tr>
          </thead>

          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={visibleColumnCount} className="px-4 py-10 text-center">
                  <p className="font-black text-slate-400">No products added yet.</p>
                  <p className="mt-1 text-xs font-bold text-slate-400">
                    SKU search se product select karke Add Product press karein.
                  </p>
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    {item.image ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewImage({ src: item.image, sku: item.sku })
                        }
                        className="group relative block rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        title="Click to enlarge image"
                        aria-label={`Enlarge image for ${item.sku}`}
                      >
                        <img
                          src={item.image}
                          alt={item.sku}
                          className="h-16 w-12 cursor-zoom-in rounded-xl bg-slate-50 object-contain ring-1 ring-slate-200 transition group-hover:opacity-90"
                        />
                      </button>
                    ) : (
                      <div className="grid h-16 w-12 place-items-center rounded-xl bg-slate-100 text-slate-400 ring-1 ring-slate-200">
                        <ImageIcon size={18} />
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <p className="font-black text-slate-950">{item.sku}</p>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      Stock: {item.stock}
                    </p>
                  </td>

                  {isI5qDqBase && (
                    <td className="px-4 py-3">
                      <input
                        value={item.size || ""}
                        onChange={(e) => updateItem(item.id, { size: e.target.value })}
                        className="h-10 w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold outline-none focus:border-emerald-500 focus:bg-white"
                        placeholder="Size"
                      />
                    </td>
                  )}

                  {!isTatBase && !isI5qDqBase && !isFabStockBase && (
                    <td className="px-4 py-3">
                      <p className="max-w-[220px] font-bold text-slate-700">
                        {item.supplierSku || "-"}
                      </p>
                    </td>
                  )}

                  {!isTatBase && !isI5qDqBase && !isFabStockBase && (
                    <td className="px-4 py-3">
                      <select
                        value={item.purchaseSupplier}
                        onChange={(e) =>
                          updateItem(item.id, {
                            purchaseSupplier: e.target.value,
                          })
                        }
                        className="h-10 w-40 rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold outline-none focus:border-emerald-500 focus:bg-white"
                      >
                        <option value="">
                          {loadingSuppliers ? "Loading..." : "Select"}
                        </option>

                        {supplierOptions.map((supplier) => (
                          <option key={supplier} value={supplier}>
                            {supplier}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}

                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) =>
                        updateQuantity(item, Number(e.target.value))
                      }
                      className="h-10 w-20 rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold outline-none focus:border-emerald-500 focus:bg-white"
                    />
                  </td>

                  <td className="px-4 py-3">
                    {isI5qDqBase ? (
                      <input
                        type="number"
                        min={0}
                        value={item.price}
                        onChange={(e) => updateItem(item.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                        className="h-10 w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold outline-none focus:border-emerald-500 focus:bg-white"
                      />
                    ) : (
                      <span className="font-black text-slate-900">{currency} {Number(item.price).toFixed(2)}</span>
                    )}
                  </td>

                  {isI5qDqBase && (
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        value={item.packPrice || 0}
                        onChange={(e) => updateItem(item.id, { packPrice: Math.max(0, Number(e.target.value) || 0) })}
                        className="h-10 w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold outline-none focus:border-emerald-500 focus:bg-white"
                      />
                    </td>
                  )}

                  <td className="px-4 py-3">
                    <p className="font-black text-slate-950">{currency} {getOrderItemTotal(item).toFixed(2)}</p>
                  </td>

                  {!isTatBase && !isI5qDqBase && !isFabStockBase && (
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={item.warehouse}
                          onChange={(e) =>
                            updateItem(item.id, {
                              warehouse: e.target.checked,
                            })
                          }
                          className="h-5 w-5 accent-emerald-600"
                        />
                        <span className="text-xs font-bold text-slate-500">
                          {item.warehouse ? "Yes" : "No"}
                        </span>
                      </label>
                    </td>
                  )}

                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="rounded-xl p-2 text-red-600 transition hover:bg-red-50"
                      title="Remove item"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview for ${previewImage.sku}`}
        >
          <div
            className="relative max-h-[92vh] max-w-[92vw] rounded-2xl bg-white p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black"
              title="Close preview"
              aria-label="Close image preview"
            >
              <X size={20} />
            </button>

            <img
              src={previewImage.src}
              alt={previewImage.sku}
              className="max-h-[85vh] max-w-[86vw] rounded-xl object-contain"
            />

            <p className="px-2 pb-1 pt-3 text-center text-sm font-black text-slate-800">
              {previewImage.sku}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
