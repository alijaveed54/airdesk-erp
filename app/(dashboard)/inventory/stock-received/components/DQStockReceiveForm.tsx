"use client";

import { useEffect, useMemo, useState } from "react";

type ProductOption = {
  id: string;
  sku: string;
  imageUrl?: string;
};

type StockLine = {
  key: string;
  productId: string;
  sku: string;
  imageUrl: string;
  quantity: number;
  category: string;
};

function createEmptyLine(): StockLine {
  return {
    key: `${Date.now()}-${Math.random()}`,
    productId: "",
    sku: "",
    imageUrl: "",
    quantity: 1,
    category: "",
  };
}

export default function DQStockReceiveForm() {
  const [baseName, setBaseName] = useState("");
  const [products, setProducts] = useState<
    ProductOption[]
  >([]);
  const [lines, setLines] = useState<StockLine[]>([
    createEmptyLine(),
  ]);
  const [search, setSearch] = useState("");
  const [loadingProducts, setLoadingProducts] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [categoryEnabled, setCategoryEnabled] =
    useState(false);
  const [newProductEnabled, setNewProductEnabled] =
    useState(false);
  const [priceRequired, setPriceRequired] =
    useState(false);
  const [showNewProductForm, setShowNewProductForm] =
    useState(false);
  const [newSku, setNewSku] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [newSize, setNewSize] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newQuantity, setNewQuantity] = useState(1);
  const [newCategory, setNewCategory] = useState("");
  const [creatingProduct, setCreatingProduct] =
    useState(false);

  async function loadProducts(searchValue = "") {
    setLoadingProducts(true);
    setMessage("");

    try {
      const params = new URLSearchParams();

      if (searchValue.trim()) {
        params.set("search", searchValue.trim());
      }

      const response = await fetch(
        `/api/inventory/stock-received/dq?${params.toString()}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Products load failed"
        );
      }

      setBaseName(data.baseName || "");
      setProducts(data.products || []);
      setCategoryEnabled(false);
      setNewProductEnabled(true);
      setPriceRequired(false);
    } catch (error) {
      setProducts([]);
      setMessage(
        error instanceof Error
          ? error.message
          : "Products load failed"
      );
    } finally {
      setLoadingProducts(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  const totalQuantity = useMemo(
    () =>
      lines.reduce(
        (total, line) =>
          total + Number(line.quantity || 0),
        0
      ),
    [lines]
  );

  function updateLine(
    key: string,
    patch: Partial<StockLine>
  ) {
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, ...patch }
          : line
      )
    );
  }

  function selectProduct(
    key: string,
    productId: string
  ) {
    const product = products.find(
      (item) => item.id === productId
    );

    updateLine(key, {
      productId,
      sku: product?.sku || "",
      imageUrl: product?.imageUrl || "",
    });
  }

  function addLine() {
    setLines((current) => [
      ...current,
      createEmptyLine(),
    ]);
  }

  function removeLine(key: string) {
    setLines((current) => {
      if (current.length === 1) {
        return [createEmptyLine()];
      }

      return current.filter(
        (line) => line.key !== key
      );
    });
  }

  async function saveStock() {
    setSaving(true);
    setMessage("");

    try {
      const validLines = lines.filter(
        (line) =>
          line.productId &&
          Number(line.quantity || 0) > 0
      );

      if (validLines.length === 0) {
        throw new Error(
          "Select at least one product and enter quantity"
        );
      }

      const response = await fetch(
        "/api/inventory/stock-received/dq",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: validLines.map((line) => ({
              productId: line.productId,
              quantity: Number(line.quantity),
            })),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Stock receive failed"
        );
      }

      setMessage(data.message);
      setLines([createEmptyLine()]);
      setSearch("");
      await loadProducts();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Stock receive failed"
      );
    } finally {
      setSaving(false);
    }
  }


  async function uploadImageToR2() {
    if (!newImageFile) return "";

    setUploadingImage(true);

    try {
      const formData = new FormData();
      formData.append("file", newImageFile);

      const response = await fetch("/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Image upload failed");
      }

      return String(data.url || "");
    } finally {
      setUploadingImage(false);
    }
  }

  async function createNewProduct() {
    setCreatingProduct(true);
    setMessage("");

    try {
      if (!newSku.trim()) {
        throw new Error("SKU is required");
      }

      if (!newImageFile) {
        throw new Error("Product image is required");
      }

      if (newQuantity <= 0) {
        throw new Error("Opening quantity must be greater than zero");
      }

      if (priceRequired && Number(newPrice || 0) <= 0) {
        throw new Error("Doha Price is required");
      }

      const uploadedImageUrl = await uploadImageToR2();

      const response = await fetch(
        "/api/inventory/stock-received/dq",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create-product",
            sku: newSku.trim(),
            imageUrl: uploadedImageUrl,
            size: newSize.trim(),
            price: priceRequired
              ? Number(newPrice)
              : undefined,
            quantity: Number(newQuantity),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "New SKU creation failed"
        );
      }

      setMessage(data.message);
      setShowNewProductForm(false);
      setNewSku("");
      setNewImageUrl("");
      setNewImageFile(null);
      setNewSize("");
      setNewPrice("");
      setNewQuantity(1);
      setSearch("");
      await loadProducts();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "New SKU creation failed"
      );
    } finally {
      setCreatingProduct(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">
          DQ Stock Receive
        </h1>

        <p className="mt-1 text-sm font-bold text-slate-500">
          {baseName
            ? `${baseName} — DQ Stock Received`
            : "Receive stock into the DQ inventory base."}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <label className="text-xs font-black uppercase text-slate-500">
              Search SKU
            </label>

            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  loadProducts(search);
                }
              }}
              placeholder="Type SKU"
              className="mt-1 h-11 w-full rounded-xl border px-4 font-bold"
            />
          </div>

          <button
            type="button"
            onClick={() => loadProducts(search)}
            disabled={loadingProducts}
            className="h-11 rounded-xl bg-blue-600 px-5 font-black text-white disabled:opacity-50"
          >
            {loadingProducts
              ? "Searching..."
              : "Search"}
          </button>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              loadProducts();
            }}
            disabled={loadingProducts}
            className="h-11 rounded-xl border border-slate-300 bg-white px-5 font-black"
          >
            Refresh
          </button>

          {newProductEnabled && (
            <button
              type="button"
              onClick={() => {
                setNewSku(search.trim());
                setShowNewProductForm((current) => !current);
              }}
              className="h-11 rounded-xl border border-amber-300 bg-amber-50 px-5 font-black text-amber-800"
            >
              + Add New SKU
            </button>
          )}
        </div>
      </div>

      {showNewProductForm && (
        <div className="rounded-3xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-amber-950">
                Add New SKU
              </h2>
              <p className="text-sm font-bold text-amber-800">
                DQ — SKU, size, image and opening quantity
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowNewProductForm(false)}
              className="rounded-xl border border-amber-300 bg-white px-4 py-2 font-black"
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <input
              value={newSku}
              onChange={(event) => setNewSku(event.target.value)}
              placeholder="SKU"
              className="h-11 rounded-xl border px-4 font-bold"
            />

            <input
              value={newSize}
              onChange={(event) => setNewSize(event.target.value)}
              placeholder="Size (optional)"
              className="h-11 rounded-xl border px-4 font-bold"
            />

            {priceRequired && (
              <input
                type="number"
                min="0"
                step="0.01"
                value={newPrice}
                onChange={(event) => setNewPrice(event.target.value)}
                placeholder="Doha Price"
                className="h-11 rounded-xl border px-4 font-bold"
              />
            )}

            <input
              type="number"
              min="1"
              value={newQuantity}
              onChange={(event) =>
                setNewQuantity(
                  Math.max(1, Number(event.target.value) || 1)
                )
              }
              placeholder="Opening Qty"
              className="h-11 rounded-xl border px-4 font-bold"
            />

            {categoryEnabled && (
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="Category (optional)"
                className="h-11 rounded-xl border px-4 font-bold"
              />
            )}

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-black uppercase text-amber-900">
                Product Image
              </label>

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setNewImageFile(file);

                  if (file) {
                    setNewImageUrl(URL.createObjectURL(file));
                  } else {
                    setNewImageUrl("");
                  }
                }}
                className="block h-11 w-full rounded-xl border bg-white px-3 py-2 font-bold"
              />
            </div>
          </div>

          {newImageUrl && (
            <div className="mt-4">
              <img
                src={newImageUrl}
                alt={newSku || "New product"}
                className="h-40 w-32 rounded-xl border bg-white object-contain"
              />
            </div>
          )}

          <button
            type="button"
            onClick={createNewProduct}
            disabled={creatingProduct || uploadingImage}
            className="mt-5 h-12 rounded-xl bg-amber-600 px-6 font-black text-white disabled:opacity-50"
          >
            {uploadingImage
              ? "Uploading Image..."
              : creatingProduct
                ? "Creating..."
                : "Create SKU & Receive Stock"}
          </button>
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 font-black text-blue-800">
          {message}
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-auto">
          <table className="w-full min-w-[850px] text-sm">
            <thead className="bg-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">
                  SKU
                </th>
                <th className="px-4 py-3 text-center">
                  Image
                </th>
                <th className="px-4 py-3 text-center">
                  Stock Received
                </th>
                {categoryEnabled && (
                  <th className="px-4 py-3 text-left">
                    Category
                  </th>
                )}
                <th className="px-4 py-3 text-right">
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.key}
                  className="border-t"
                >
                  <td className="px-4 py-3">
                    <select
                      value={line.productId}
                      onChange={(event) =>
                        selectProduct(
                          line.key,
                          event.target.value
                        )
                      }
                      className="h-11 w-full rounded-xl border bg-white px-3 font-bold"
                    >
                      <option value="">
                        Select SKU
                      </option>

                      {products.map((product) => (
                        <option
                          key={product.id}
                          value={product.id}
                        >
                          {product.sku}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex h-24 w-20 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      {line.imageUrl ? (
                        <img
                          src={line.imageUrl}
                          alt={line.sku || "Selected product"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="px-2 text-center text-xs font-bold text-slate-400">
                          No Image
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.key, {
                          quantity: Math.max(
                            1,
                            Number(
                              event.target.value
                            ) || 1
                          ),
                        })
                      }
                      className="h-11 w-36 rounded-xl border px-3 text-center font-black"
                    />
                  </td>

                  {categoryEnabled && (
                    <td className="px-4 py-3">
                      <input
                        value={line.category}
                        onChange={(event) =>
                          updateLine(line.key, {
                            category:
                              event.target.value,
                          })
                        }
                        placeholder="Optional"
                        className="h-11 w-full rounded-xl border px-3 font-bold"
                      />
                    </td>
                  )}

                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        removeLine(line.key)
                      }
                      className="h-10 rounded-xl border border-red-300 bg-red-50 px-4 font-black text-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={addLine}
            className="h-11 rounded-xl border border-blue-300 bg-blue-50 px-5 font-black text-blue-700"
          >
            + Add Product
          </button>

          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-slate-100 px-4 py-3 font-black">
              Total Qty: {totalQuantity}
            </div>

            <button
              type="button"
              onClick={saveStock}
              disabled={saving}
              className="h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 px-7 font-black text-white disabled:opacity-50"
            >
              {saving
                ? "Saving..."
                : "Receive Stock"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
