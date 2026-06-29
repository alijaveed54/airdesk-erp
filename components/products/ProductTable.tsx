"use client";

import { ImageIcon } from "lucide-react";

type Product = {
  id: string;
  image: string;
  sku: string;
  supplier: string;
  price: string | number;
  stock: string | number;
  created: string;
};

type Props = {
  products: Product[];
  loading: boolean;
  onSelect: (product: Product) => void;
};

export default function ProductTable({
  products,
  loading,
  onSelect,
}: Props) {
  if (loading) {
    return (
      <div className="rounded-2xl border bg-white p-10 text-center">
        Loading products...
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-4 text-left">Image</th>
              <th className="px-4 py-4 text-left">SKU</th>
              <th className="px-4 py-4 text-left">Supplier</th>
              <th className="px-4 py-4 text-left">Price</th>
              <th className="px-4 py-4 text-left">Stock</th>
            </tr>
          </thead>

          <tbody>
            {products.map((product) => (
              <tr
                key={product.id}
                onClick={() => onSelect(product)}
                className="cursor-pointer border-t transition hover:bg-emerald-50"
              >
                <td className="px-4 py-3">
                  {product.image ? (
                    <img
  src={product.image}
  alt={product.sku}
  loading="lazy"
  className="h-20 w-16 rounded-xl object-contain bg-slate-50 ring-1 ring-slate-200"
/>
                  ) : (
                    <div className="grid h-14 w-12 place-items-center rounded-xl bg-slate-100">
                      <ImageIcon size={18} />
                    </div>
                  )}
                </td>

                <td className="px-4 py-3 font-bold">
                  {product.sku}
                </td>

                <td className="px-4 py-3">
                  {product.supplier}
                </td>

                <td className="px-4 py-3 text-emerald-700 font-bold">
                  AED {product.price}
                </td>

                <td className="px-4 py-3">
                  {product.stock}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}