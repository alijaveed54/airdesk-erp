"use client";

import { ImageIcon, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import OrderItemsGrid, { type OrderItem } from "./OrderItemsGrid";

type AirtableRecord = {
  id: string;
  fields: Record<string, any>;
};

type Product = {
  id: string;
  sku: string;
  image: string;
  price: string | number;
  stock: string | number;
  purchaseSupplier: string;
  supplierSku: string;
};

function getFirst(value: any) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function getImageUrl(value: any) {
  const image = Array.isArray(value) ? value[0] : value;

  return (
    image?.url ||
    image?.thumbnails?.full?.url ||
    image?.thumbnails?.large?.url ||
    image?.thumbnails?.small?.url ||
    ""
  );
}

function getDefaultSupplierFromSku(sku: string) {
  const match = sku.match(/^[A-Za-z]+/);
  return match?.[0]?.toUpperCase() || "";
}

function mapProduct(record: AirtableRecord): Product {
  const fields = record.fields;
  const sku = fields.SKU || "-";

  return {
    id: record.id,
    sku,
    image: getImageUrl(fields.Image),
    price: getFirst(fields.Price || fields.CP || fields["Sale Price"]) || "-",
    stock: fields["Balance Stock"] ?? fields.Stock ?? fields.stock ?? "-",
    purchaseSupplier:
      fields.Supplier ||
      fields["Supplier"] ||
      getDefaultSupplierFromSku(sku),
    supplierSku: fields["ALV Supplier Code"] || "",
  };
}

type ProductSearchProps = {
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
  isI5qDqBase?: boolean;
  isFabStockBase?: boolean;
  orderMode?: "DQ" | "i5Q";
};

export default function ProductSearch({
  items,
  onChange,
  isI5qDqBase = false,
  isFabStockBase = false,
  orderMode = "DQ",
}: ProductSearchProps) {
  const enableStockValidation = isI5qDqBase || isFabStockBase;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [purchaseSupplier, setPurchaseSupplier] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [size, setSize] = useState("");
  const [singlePrice, setSinglePrice] = useState("");
  const [packPrice, setPackPrice] = useState("");
  const [warehouse, setWarehouse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProductSku, setNewProductSku] = useState("");
  const [newSupplierSku, setNewSupplierSku] = useState("");
  const [newProductCp, setNewProductCp] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [newProductSupplier, setNewProductSupplier] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);
  const [productSaveError, setProductSaveError] = useState("");
  const [productSaveSuccess, setProductSaveSuccess] = useState("");
  

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
    const value = query.trim();

    if (value.length < 3 || selectedProduct) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearched(false);
      setLoading(true);

      try {
        const res = await fetch(
          `/api/products?search=${encodeURIComponent(value)}&pageSize=10`
        );
        const data = await res.json();

        if (res.ok && data.success) {
    const records = (data.records || [])
      .map(mapProduct)
      .filter((product: Product) => {
        if (!enableStockValidation) return true;
        return Number(product.stock) > 0;
      });

    setResults(records);
    setSearched(true);

    setShowAddProduct(records.length === 0);
} else {
    setResults([]);
    setSearched(true);
    setShowAddProduct(true);
}
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [query, selectedProduct]);

  function getAvailableStock(product: Product | null) {
    return Math.max(0, Number(product?.stock) || 0);
  }

  function handleQuantityChange(value: number) {
    const nextQty = Math.max(1, Number(value) || 1);

    if (enableStockValidation && selectedProduct) {
      const availableStock = getAvailableStock(selectedProduct);

      if (nextQty > availableStock) {
        alert(`Available stock is only ${availableStock} pc(s).`);
        setQuantity(Math.max(1, availableStock));
        return;
      }
    }

    setQuantity(nextQty);
  }

  function selectProduct(product: Product) {
    if (enableStockValidation && getAvailableStock(product) <= 0) {
      alert("This product is out of stock.");
      return;
    }

    setSelectedProduct(product);
    setQuery(product.sku);
    setResults([]);
  }
async function saveNewProduct() {
  setProductSaveError("");
  setProductSaveSuccess("");

  if (!newProductSku.trim()) {
    setProductSaveError("SKU is required");
    return;
  }

  setSavingProduct(true);

  try {
    let imageUrl = "";

if (productImage) {
  setUploadingImage(true);

  const formData = new FormData();
  formData.append("file", productImage);

  const uploadRes = await fetch("/api/upload/image", {
    method: "POST",
    body: formData,
  });

  const uploadData = await uploadRes.json();

  if (!uploadRes.ok || !uploadData.success) {
    throw new Error(uploadData.message || "Image upload failed");
  }

  imageUrl = uploadData.url;

  setUploadingImage(false);
}
    const res = await fetch("/api/products/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
  sku: newProductSku.trim(),
  supplierSku: newSupplierSku.trim(),
  cp: Number(newProductCp) || 0,
  price: Number(newProductPrice) || Number(newProductCp) || 0,
  imageUrl,
}),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || "Product save failed");
    }

    const createdProduct = mapProduct(data.record);

setSelectedProduct(createdProduct);
setQuery(createdProduct.sku);
setResults([]);
setSearched(false);
setShowAddProduct(false);

setShowAddProductModal(false);
setProductSaveSuccess("");
setProductSaveError("");

setNewProductSku("");
setNewSupplierSku("");
setNewProductCp("");
setNewProductPrice("");
setProductImage(null);
setProductImagePreview("");
  } catch (error) {
    setProductSaveError(
      error instanceof Error ? error.message : "Product save failed"
    );
  } finally {
    setSavingProduct(false);
  }
}
  function addProduct() {
    if (!selectedProduct) return;

    if (enableStockValidation) {
      const availableStock = getAvailableStock(selectedProduct);
      const requestedQty = Math.max(1, Number(quantity) || 1);

      const alreadyAddedQty = items
        .filter((item) => item.productId === selectedProduct.id)
        .reduce((total, item) => total + (Number(item.qty) || 0), 0);

      const remainingStock = Math.max(0, availableStock - alreadyAddedQty);
      const newOrderTotalQty = alreadyAddedQty + requestedQty;

      if (newOrderTotalQty > availableStock) {
        alert(
          `Available stock is ${availableStock} pc(s). ` +
          `${alreadyAddedQty} pc(s) already added in this order. ` +
          `You can add only ${remainingStock} more pc(s).`
        );

        if (remainingStock > 0) {
          setQuantity(remainingStock);
        }

        return;
      }
    }

    const item: OrderItem = {
      id: crypto.randomUUID(),
      productId: selectedProduct.id,
      sku: selectedProduct.sku,
      supplierSku: selectedProduct.supplierSku || "",
      image: selectedProduct.image,
      purchaseSupplier:
        selectedProduct.purchaseSupplier || getDefaultSupplierFromSku(selectedProduct.sku),
      price: isI5qDqBase ? Number(singlePrice) || 0 : Number(selectedProduct.price) || 0,
      qty: Number(quantity) || 1,
      stock: selectedProduct.stock,
      warehouse: isI5qDqBase ? false : warehouse,
      size: isI5qDqBase ? size.trim() : "",
      packPrice: isI5qDqBase ? Number(packPrice) || 0 : 0,
    };

    onChange([...items, item]);

    setSelectedProduct(null);
    setQuery("");
    setPurchaseSupplier("");
    setQuantity(1);
    setSize("");
    setSinglePrice("");
    setPackPrice("");
    setWarehouse(false);
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">3. Add Products</h2>

      <div className={`mt-5 grid gap-4 ${isI5qDqBase ? "lg:grid-cols-[1fr_120px_120px_140px_140px]" : "lg:grid-cols-[1fr_120px]"}`}>
        <div className="relative">
          <label className="mb-2 block text-sm font-bold text-slate-700">
            Search SKU
          </label>

          <div className="relative">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedProduct(null);
              }}
              placeholder="Type SKU..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-12 outline-none focus:border-emerald-500 focus:bg-white"
            />

            {loading && (
              <Loader2
                size={18}
                className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-emerald-600"
              />
            )}
          </div>

          {results.length > 0 && !selectedProduct && (
            <div className="absolute z-40 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              {results.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => selectProduct(product)}
                  className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-emerald-50"
                >
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.sku}
                      className="h-14 w-12 rounded-xl object-contain bg-slate-50"
                    />
                  ) : (
                    <div className="grid h-14 w-12 place-items-center rounded-xl bg-slate-100">
                      <ImageIcon size={18} />
                    </div>
                  )}
                  <div>
                    <p className="font-black text-slate-900">{product.sku}</p>
                    <p className="text-sm text-slate-500">
                      AED {product.price} • Stock {product.stock}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {searched &&
            showAddProduct &&
            query.trim().length >= 3 &&
            !selectedProduct && (
              <div className="mt-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4">
                <p className="font-black text-amber-900">
                  {enableStockValidation
                    ? "Product not found or stock is zero."
                    : "Product not found."}
                </p>

                <p className="mt-1 text-sm text-amber-700">
                  {enableStockValidation
                    ? "Only products with Balance Stock greater than zero can be selected."
                    : "You can create this SKU in Products."}
                </p>

                {!enableStockValidation && (
                <button
                  type="button"
                  className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white"
                  onClick={() => {
                    const sku = query.trim();
                    const defaultSupplier = getDefaultSupplierFromSku(sku);

                    setNewProductSku(sku);
                    setNewProductSupplier(defaultSupplier);
                    setNewSupplierSku("");
                    setNewProductCp("");
                    setNewProductPrice("");
                    setProductImage(null);
                    setProductImagePreview("");
                    setShowAddProductModal(true);
                    setProductSaveSuccess("");
setProductSaveError("");
                  }}
                >
                  + Add New Product
                </button>
                )}
              </div>
            )}
        </div>

        {isI5qDqBase && (
          <Input label="Size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size" />
        )}

        <Input
          label="Qty"
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => handleQuantityChange(Number(e.target.value))}
        />

        {isI5qDqBase && (
          <Input label="Single Price" type="number" min={0} value={singlePrice} onChange={(e) => setSinglePrice(e.target.value)} placeholder="0" />
        )}

        {isI5qDqBase && (
          <Input label="Pack Price" type="number" min={0} value={packPrice} onChange={(e) => setPackPrice(e.target.value)} placeholder="0" />
        )}
      </div>

      {!isI5qDqBase && (
      <label className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <input
          type="checkbox"
          checked={warehouse}
          onChange={(e) => setWarehouse(e.target.checked)}
          className="h-5 w-5 accent-emerald-600"
        />
        <div>
          <p className="text-sm font-black text-slate-800">
            Already in Warehouse
          </p>
          <p className="text-xs text-slate-500">Supplier ko order nahi dena.</p>
        </div>
      </label>
      )}

      <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5">
        {selectedProduct ? (
          <div className="flex items-center gap-4">
            {selectedProduct.image ? (
              <img
                src={selectedProduct.image}
                alt={selectedProduct.sku}
                className="h-24 w-20 rounded-2xl object-contain bg-white ring-1 ring-slate-200"
              />
            ) : (
              <div className="grid h-24 w-20 place-items-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200">
                <ImageIcon size={24} />
              </div>
            )}

            <div>
              <p className="text-xs font-black uppercase text-emerald-700">
                Selected Product
              </p>

              <p className="mt-1 text-lg font-black text-slate-950">
                {selectedProduct.sku}
              </p>

              {!isI5qDqBase && (
                <p className="mt-1 text-sm font-bold text-slate-600">
                  Supplier SKU: {selectedProduct.supplierSku || "-"}
                </p>
              )}

              <p className="mt-1 text-sm text-slate-600">
                {isI5qDqBase ? `${orderMode} • Stock ${selectedProduct.stock}` : `AED ${selectedProduct.price} • Stock ${selectedProduct.stock}`}
              </p>
            </div>
          </div>
        ) : (
          <p className="font-bold text-slate-500">
            Product preview will appear here.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={addProduct}
        disabled={!selectedProduct}
        className="mt-5 inline-flex h-12 items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 px-6 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={18} />
        Add Product
      </button>


      {showAddProductModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-slate-950">
                  Add New Product
                </h3>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  Product table mein new SKU create karne ke liye details fill karein.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowAddProductModal(false)}
                className="rounded-2xl bg-slate-100 p-3 text-slate-700 hover:bg-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Input
                label="SKU"
                value={newProductSku}
                onChange={(e) => {
                  const sku = e.target.value;
                  setNewProductSku(sku);

                  if (!newProductSupplier) {
                    setNewProductSupplier(getDefaultSupplierFromSku(sku));
                  }
                }}
                placeholder="Product SKU"
              />

              

              <Input
                label="Supplier SKU"
                value={newSupplierSku}
                onChange={(e) => setNewSupplierSku(e.target.value)}
                placeholder="Optional"
              />
<label className="block md:col-span-2">
  <span className="mb-2 block text-sm font-bold text-slate-700">
    Product Image
  </span>

  <input
    type="file"
    accept="image/*"
    onChange={(e) => {
      const file = e.target.files?.[0];

      if (!file) return;

      setProductImage(file);
      setProductImagePreview(URL.createObjectURL(file));
    }}
    className="block w-full rounded-2xl border border-slate-200 bg-slate-50 p-3"
  />

  {productImagePreview && (
    <img
      src={productImagePreview}
      alt="Preview"
      className="mt-3 h-40 rounded-2xl border object-contain"
    />
  )}
</label>
              <Input
                label="CP"
                type="number"
                value={newProductCp}
                onChange={(e) => setNewProductCp(e.target.value)}
                placeholder="0"
              />

              <Input
                label="Selling Price"
                type="number"
                value={newProductPrice}
                onChange={(e) => setNewProductPrice(e.target.value)}
                placeholder="0"
              />

              
            </div>
{productSaveError && (
  <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
    {productSaveError}
  </div>
)}

{productSaveSuccess && (
  <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
    {productSaveSuccess}
  </div>
)}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowAddProductModal(false)}
                className="h-12 flex-1 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700"
              >
                Cancel
              </button>

              <button
  type="button"
  onClick={saveNewProduct}
  disabled={savingProduct || !!productSaveSuccess}
  className="h-12 flex-1 rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
>
  {savingProduct
  ? "Saving..."
  : productSaveSuccess
  ? "Saved"
  : "Save Product"}
</button>
            </div>
          </div>
        </div>
      )}

      <OrderItemsGrid items={items} onChange={onChange} isI5qDqBase={isI5qDqBase} />
    </div>
  );
}

function Input({
  label,
  ...props
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">
        {label}
      </span>
      <input
        {...props}
        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-emerald-500 focus:bg-white"
      />
    </label>
  );
}
