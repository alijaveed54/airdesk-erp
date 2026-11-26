"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Filter,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Upload,
  X,
} from "lucide-react";

type UaeStockItem = {
  id: string;
  sku?: string;
  name?: string;
  category: string;
  size?: string;
  price: number | string;
  currency?: string;
  imageUrl?: string;
  stock?: number;
};

type StockReportResponse = {
  success: boolean;
  authenticated?: boolean;
  message?: string;
  categoryOptions?: string[];
  sizeOptions?: string[];
  items?: UaeStockItem[];
};

type AdjustResponse = {
  success: boolean;
  message?: string;
  stock?: number;
};

type ItemFormData = {
  id?: string;
  name: string;
  category: string;
  size: string;
  price: number | string;
  imageUrl: string;
};

async function uploadProductImage(file: File): Promise<string> {
  const endpoints = ["/api/r2/upload", "/api/upload"];
  let lastError = "Image upload endpoint nahi mila.";

  for (const endpoint of endpoints) {
    try {
      const body = new FormData();
      body.append("file", file);

      const res = await fetch(endpoint, {
        method: "POST",
        body,
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        lastError = `${endpoint} ne invalid response diya (HTTP ${res.status}).`;
        continue;
      }

      if (!res.ok || data?.success === false) {
        lastError = data?.message || data?.error || `Upload failed (HTTP ${res.status})`;
        continue;
      }

      const uploadedUrl =
        data?.url ||
        data?.fileUrl ||
        data?.publicUrl ||
        data?.imageUrl ||
        data?.data?.url ||
        "";

      if (!uploadedUrl) {
        lastError = `${endpoint} se image URL wapas nahi mila.`;
        continue;
      }

      return String(uploadedUrl);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Image upload error";
    }
  }

  throw new Error(lastError);
}

export default function UaeStockReportPage() {
  const [items, setItems] = useState<UaeStockItem[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [sizeOptions, setSizeOptions] = useState<string[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedSize, setSelectedSize] = useState("All");
  const [busyId, setBusyId] = useState("");
  const [stepQty, setStepQty] = useState<Record<string, number>>({});

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "update">("create");
  const [savingItem, setSavingItem] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [formData, setFormData] = useState<ItemFormData>({
    name: "",
    category: "",
    size: "",
    price: "",
    imageUrl: "",
  });

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        setIsLoggedIn(false);
        return;
      }
      const data = await res.json();
      setIsLoggedIn(Boolean(data?.success && data?.user));
    } catch {
      setIsLoggedIn(false);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/stock/uae", { cache: "no-store" });
      const text = await res.text();
      let data: StockReportResponse;
      try {
        data = JSON.parse(text) as StockReportResponse;
      } catch {
        throw new Error(`Invalid response from /api/stock/uae (HTTP ${res.status})`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.message || "UAE Stock Report load nahi ho saki");
      }

      setItems(data.items || []);
      setCategoryOptions(data.categoryOptions || []);
      setSizeOptions(data.sizeOptions || []);
      if (typeof data.authenticated === "boolean") {
        setIsLoggedIn(data.authenticated);
      }
    } catch (err) {
      setItems([]);
      setCategoryOptions([]);
      setSizeOptions([]);
      setError(err instanceof Error ? err.message : "Report load error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
    void loadReport();
  }, [checkSession, loadReport]);

  useEffect(() => {
    if (!isLoggedIn) {
      setInStockOnly(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(formData.imageUrl || "");
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile, formData.imageUrl]);

  // Sirf wahi categories jin mein kam از kam 1 item mojood ho
  const categories = useMemo(() => {
    const activeSet = new Set<string>();
    for (const item of items) {
      const cat = String(item.category || "").trim();
      if (!cat) continue;
      if (isLoggedIn && inStockOnly && (item.stock ?? 0) <= 0) continue;
      activeSet.add(cat);
    }

    const ordered =
      categoryOptions.length > 0
        ? categoryOptions.filter((cat) => activeSet.has(cat))
        : [];

    for (const cat of activeSet) {
      if (!ordered.includes(cat)) {
        ordered.push(cat);
      }
    }

    return ["All", ...ordered];
  }, [items, categoryOptions, isLoggedIn, inStockOnly]);

  // Sirf wahi sizes jin mein kam از kam 1 item mojood ho
  const sizes = useMemo(() => {
    const activeSet = new Set<string>();
    for (const item of items) {
      const sz = String(item.size || "").trim();
      if (!sz) continue;
      if (isLoggedIn && inStockOnly && (item.stock ?? 0) <= 0) continue;
      activeSet.add(sz);
    }

    const ordered =
      sizeOptions.length > 0
        ? sizeOptions.filter((sz) => activeSet.has(sz))
        : [];

    for (const sz of activeSet) {
      if (!ordered.includes(sz)) {
        ordered.push(sz);
      }
    }

    return ["All", ...ordered];
  }, [items, sizeOptions, isLoggedIn, inStockOnly]);

  useEffect(() => {
    if (selectedCategory !== "All" && !categories.includes(selectedCategory)) {
      setSelectedCategory("All");
    }
  }, [categories, selectedCategory]);

  useEffect(() => {
    if (selectedSize !== "All" && !sizes.includes(selectedSize)) {
      setSelectedSize("All");
    }
  }, [sizes, selectedSize]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const catMatch =
        selectedCategory === "All" || item.category === selectedCategory;
      const sizeMatch =
        selectedSize === "All" || (item.size || "") === selectedSize;
      const stockMatch =
        !isLoggedIn || !inStockOnly || (item.stock ?? 0) > 0;
      const searchMatch =
        !q ||
        [item.name, item.sku, item.category, item.size, String(item.price)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      return catMatch && sizeMatch && stockMatch && searchMatch;
    });
  }, [items, search, selectedCategory, selectedSize, isLoggedIn, inStockOnly]);

  function getQty(id: string) {
    return Math.max(1, stepQty[id] || 1);
  }

  function setQty(id: string, val: number) {
    setStepQty((prev) => ({
      ...prev,
      [id]: Math.max(1, Math.min(999, val || 1)),
    }));
  }

  function closeModal() {
    setModalOpen(false);
    setSelectedFile(null);
    setPreviewUrl("");
  }

  function openCreateModal() {
    setModalMode("create");
    setSelectedFile(null);
    setPreviewUrl("");
    setFormData({
      name: "",
      category: categoryOptions[0] || "",
      size: sizeOptions[0] || "",
      price: "",
      imageUrl: "",
    });
    setModalOpen(true);
  }

  function openEditModal(item: UaeStockItem) {
    setModalMode("update");
    setSelectedFile(null);
    setPreviewUrl(item.imageUrl || "");
    setFormData({
      id: item.id,
      name: item.name || "",
      category: item.category || categoryOptions[0] || "",
      size: item.size || sizeOptions[0] || "",
      price: item.price || "",
      imageUrl: item.imageUrl || "",
    });
    setModalOpen(true);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Sirf image file select karein.");
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert("Product name required hai.");
      return;
    }

    setSavingItem(true);
    setError("");
    setNotice("");

    try {
      let finalImageUrl = formData.imageUrl.trim();
      if (selectedFile) {
        finalImageUrl = await uploadProductImage(selectedFile);
      }

      const res = await fetch("/api/stock/uae/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: modalMode,
          id: formData.id,
          name: formData.name,
          category: formData.category,
          size: formData.size,
          price: formData.price,
          imageUrl: finalImageUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Operation failed");
      }

      setNotice(data.message);
      closeModal();
      await loadReport();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error saving item");
    } finally {
      setSavingItem(false);
    }
  }

  async function adjustStock(item: UaeStockItem, mode: "add" | "reduce") {
    if (!isLoggedIn || busyId) return;

    const delta = getQty(item.id);
    const key = `${mode}:${item.id}`;
    setBusyId(key);
    setError("");
    setNotice("");

    try {
      const res = await fetch("/api/stock/uae/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          sku: item.sku,
          mode,
          quantity: delta,
        }),
      });

      const data = (await res.json()) as AdjustResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Stock update failed");
      }

      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                stock:
                  typeof data.stock === "number"
                    ? data.stock
                    : Math.max(
                        0,
                        (row.stock || 0) + (mode === "add" ? delta : -delta),
                      ),
              }
            : row,
        ),
      );

      setNotice(
        data.message ||
          `${item.name || item.sku || item.id}: ${
            mode === "add" ? `+${delta} stock add` : `-${delta} stock reduce`
          } ho gaya.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stock update error");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-700">
            <ShoppingBag size={16} />
            UAE Stock Report
          </div>
          <h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">
            UAE Products Catalogue
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {isLoggedIn
              ? "ERP ID active: products add/edit, stock adjustment aur filters mojood hain."
              : "Public view: sirf available products ki photo, category aur price show ho rahi hai."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isLoggedIn && (
            <>
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700"
              >
                <Plus size={15} />
                Add Product
              </button>

              <button
                type="button"
                onClick={() => setInStockOnly((prev) => !prev)}
                className={[
                  "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-black transition",
                  inStockOnly
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                ].join(" ")}
              >
                <Filter size={14} />
                {inStockOnly ? "In-Stock Only: ON" : "Filter Out Zero Stock"}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              void checkSession();
              void loadReport();
            }}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
          <CheckCircle2 size={18} className="shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product, category, size ya price..."
              className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm font-bold outline-none focus:border-blue-500"
            />
          </div>

          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={[
                    "h-9 rounded-xl border px-3.5 text-xs font-black transition",
                    selectedCategory === cat
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                  ].join(" ")}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {sizes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            <span className="mr-1 text-xs font-black text-slate-500">Size:</span>
            {sizes.map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setSelectedSize(sz)}
                className={[
                  "h-8 rounded-xl border px-3 text-xs font-black transition",
                  selectedSize === sz
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                ].join(" ")}
              >
                {sz}
              </button>
            ))}
          </div>
        )}
      </section>

      {loading ? (
        <div className="flex items-center justify-center rounded-3xl border border-slate-200 bg-white p-14">
          <Loader2 size={28} className="animate-spin text-blue-600" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-500">
          Koi product nahi mila.
        </div>
      ) : (
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map((item) => {
            const qty = getQty(item.id);
            const adding = busyId === `add:${item.id}`;
            const reducing = busyId === `reduce:${item.id}`;

            return (
              <article
                key={item.id}
                className="relative flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
              >
                <div className="aspect-[4/5] w-full overflow-hidden bg-slate-100">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name || item.category}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-400">
                      No Photo
                    </div>
                  )}
                </div>

                {isLoggedIn && (
                  <button
                    type="button"
                    onClick={() => openEditModal(item)}
                    className="absolute right-3 top-3 inline-flex h-8 items-center gap-1 rounded-xl bg-white/90 px-2.5 text-[11px] font-black text-slate-700 shadow-sm backdrop-blur hover:bg-white"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                )}

                <div className="flex flex-1 flex-col justify-between space-y-4 p-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {item.category && (
                        <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700">
                          {item.category}
                        </span>
                      )}
                      {item.size && (
                        <span className="inline-block rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700">
                          {item.size}
                        </span>
                      )}
                    </div>

                    {item.name && (
                      <h2 className="line-clamp-2 text-sm font-black text-slate-900">
                        {item.name}
                      </h2>
                    )}

                    <p className="text-lg font-black text-emerald-700">
                      {item.currency || "AED"} {item.price}
                    </p>
                  </div>

                  {isLoggedIn && (
                    <div className="space-y-2.5 border-t border-slate-100 pt-3">
                      <div className="flex items-center justify-between text-xs font-black text-slate-600">
                        <span>Current Stock:</span>
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-slate-900">
                          {item.stock ?? 0}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={qty}
                          onChange={(e) =>
                            setQty(item.id, parseInt(e.target.value, 10))
                          }
                          className="h-9 w-16 rounded-xl border border-slate-300 px-2 text-center text-xs font-black"
                          aria-label="Quantity"
                        />

                        <button
                          type="button"
                          onClick={() => void adjustStock(item, "add")}
                          disabled={Boolean(busyId)}
                          className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                          {adding ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Plus size={14} />
                          )}
                          Add
                        </button>

                        <button
                          type="button"
                          onClick={() => void adjustStock(item, "reduce")}
                          disabled={Boolean(busyId) || (item.stock ?? 0) <= 0}
                          className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-amber-600 px-2.5 text-xs font-black text-white hover:bg-amber-700 disabled:opacity-40"
                        >
                          {reducing ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Minus size={14} />
                          )}
                          Reduce
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-black text-slate-900">
                {modalMode === "create" ? "Add New Product" : "Edit Product"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="grid h-8 w-8 place-items-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-black text-slate-600">
                  Product Name *
                </label>
                <input
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g. Lawn Suit 3pc"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-600">
                    Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value })
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold outline-none focus:border-blue-600"
                  >
                    <option value="">Select Category</option>
                    {categoryOptions.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-600">
                    Size
                  </label>
                  <select
                    value={formData.size}
                    onChange={(e) =>
                      setFormData({ ...formData, size: e.target.value })
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold outline-none focus:border-blue-600"
                  >
                    <option value="">Select Size</option>
                    {sizeOptions.map((sz) => (
                      <option key={sz} value={sz}>
                        {sz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600">
                  Unit Cost / Price (AED)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.price}
                  onChange={(e) =>
                    setFormData({ ...formData, price: e.target.value })
                  }
                  placeholder="0.00"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600">
                  Product Image
                </label>

                <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-black text-slate-700 transition hover:border-blue-500 hover:bg-blue-50/50">
                  <Upload size={15} className="text-blue-600" />
                  <span className="truncate">
                    {selectedFile ? selectedFile.name : "Choose Image File"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                {previewUrl && (
                  <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="h-14 w-14 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1 text-xs font-bold text-slate-600">
                      <p className="truncate text-slate-800">
                        {selectedFile ? selectedFile.name : "Current Image"}
                      </p>
                      {selectedFile && (
                        <button
                          type="button"
                          onClick={() => setSelectedFile(null)}
                          className="mt-1 text-[11px] font-black text-red-600 hover:underline"
                        >
                          Remove selected file
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-black text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingItem}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-5 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingItem && <Loader2 size={14} className="animate-spin" />}
                  {modalMode === "create" ? "Create Product" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}