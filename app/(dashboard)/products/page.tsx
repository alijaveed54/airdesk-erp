import { Search, Plus } from "lucide-react";

const sampleProducts = [
  {
    sku: "ALV2004 - XXL",
    itemCode: "ALV2004 - XXL",
    supplier: "ALV",
    price: "AED 80",
    status: "Dispatched",
    store: "Sooper Deals",
  },
  {
    sku: "HRT3797 | Navy Blue - M",
    itemCode: "HRT3797 | Navy Blue - M",
    supplier: "HRT",
    price: "AED 110",
    status: "Dispatched",
    store: "U5Store.com",
  },
  {
    sku: "HRT5642 | Green - 2XL",
    itemCode: "HRT5642 | Green - 2XL",
    supplier: "HRT",
    price: "AED 95",
    status: "Delivered",
    store: "Sooper Deals",
  },
];

export default function ProductsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black text-slate-950">Products</h1>
          <p className="text-sm text-slate-500">
            Clean product view mapped from Airtable fields.
          </p>
        </div>
        <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-700">
          <Plus size={18} />
          Add Product
        </button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              placeholder="Search SKU, supplier, store..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-50"
            />
          </div>
          <select className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700 outline-none">
            <option>All Suppliers</option>
            <option>ALV</option>
            <option>HRT</option>
            <option>FFT</option>
          </select>
          <select className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700 outline-none">
            <option>All Status</option>
            <option>Delivered</option>
            <option>Dispatched</option>
            <option>Processing</option>
          </select>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-4">SKU</th>
                <th className="px-4 py-4">Item Code</th>
                <th className="px-4 py-4">Supplier</th>
                <th className="px-4 py-4">Price</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Store</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sampleProducts.map((product) => (
                <tr key={product.sku} className="transition hover:bg-emerald-50/40">
                  <td className="px-4 py-4 font-bold text-slate-900">{product.sku}</td>
                  <td className="px-4 py-4 text-slate-600">{product.itemCode}</td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      {product.supplier}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-bold text-emerald-700">{product.price}</td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                      {product.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{product.store}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
