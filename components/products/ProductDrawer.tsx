"use client";

import { ImageIcon, X } from "lucide-react";

type ProductDrawerProps = {
  open: boolean;
  product: any;
  onClose: () => void;
};

function Detail({
  label,
  value,
}: {
  label: string;
  value: any;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 break-all text-sm font-semibold text-slate-900">
        {value || "-"}
      </p>
    </div>
  );
}

export default function ProductDrawer({
  open,
  product,
  onClose,
}: ProductDrawerProps) {
  if (!open || !product) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white p-5">
          <div>
            <p className="text-xs font-bold uppercase text-emerald-600">
              Product Details
            </p>

            <h2 className="text-xl font-black">
              {product.sku}
            </h2>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5">

          <div className="mb-6 overflow-hidden rounded-2xl bg-slate-100">

            {product.image ? (
              <img
                src={product.image}
                alt={product.sku}
                className="h-80 w-full object-contain"
              />
            ) : (
              <div className="grid h-80 place-items-center">
                <ImageIcon size={40} />
              </div>
            )}

          </div>

          <div className="space-y-3">

            <Detail label="SKU" value={product.sku} />

            <Detail
              label="Supplier"
              value={product.supplier}
            />

            <Detail
              label="Price"
              value={`AED ${product.price}`}
            />

            <Detail
              label="Balance Stock"
              value={product.stock}
            />

            <Detail
              label="Record ID"
              value={product.id}
            />

          </div>

        </div>
      </div>
    </div>
  );
}