"use client";

import {
  Download,
  Filter,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onRefresh: () => void;
};

export default function ProductToolbar({
  search,
  onSearchChange,
  onSearch,
  onRefresh,
}: Props) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

        <div className="flex flex-1 gap-3">
          <div className="relative flex-1">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search SKU..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 outline-none transition focus:border-emerald-500"
            />
          </div>

          <button
            onClick={onSearch}
            className="rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 px-6 font-bold text-white shadow-lg"
          >
            Search
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 hover:bg-slate-50">
            <Plus size={18} />
            Add Product
          </button>

          <button className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 hover:bg-slate-50">
            <Upload size={18} />
            Import
          </button>

          <button className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 hover:bg-slate-50">
            <Download size={18} />
            Export
          </button>

          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 hover:bg-slate-50"
          >
            <RefreshCw size={18} />
            Refresh
          </button>

          <button className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 hover:bg-slate-50">
            <Filter size={18} />
            Filters
          </button>

        </div>

      </div>
    </div>
  );
}