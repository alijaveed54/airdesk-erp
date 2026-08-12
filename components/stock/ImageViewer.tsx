"use client";

import { useEffect } from "react";
import type { PublicStockProduct } from "./ProductCard";

type Props = {
  product: PublicStockProduct | null;
  onClose: () => void;
};

export default function ImageViewer({ product, onClose }: Props) {
  useEffect(() => {
    if (!product) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [product, onClose]);

  if (!product) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Large image of ${product.sku}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-2xl font-black text-slate-900 shadow-lg"
        aria-label="Close image"
      >
        ×
      </button>

      <div className="flex max-h-[96vh] w-full max-w-5xl flex-col items-center" onClick={(event) => event.stopPropagation()}>
        {product.image ? (
          <img src={product.image} alt={product.sku} className="max-h-[84vh] max-w-full rounded-xl object-contain shadow-2xl" />
        ) : (
          <div className="rounded-2xl bg-white p-10 text-center font-bold text-slate-500">Image not available</div>
        )}

        <div className="mt-2 w-full max-w-xl rounded-xl bg-white/95 px-4 py-3 text-center shadow-lg">
          <p className="font-black text-slate-900">{product.sku}</p>
          <p className="text-sm font-bold text-slate-700">QAR {product.price.toLocaleString("en-US")}</p>
        </div>
      </div>
    </div>
  );
}
