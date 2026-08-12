"use client";

type Props = {
  search: string;
  category: string;
  color: string;
  size: string;
  sort: string;
  categories: string[];
  colors: string[];
  sizes: string[];
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onSizeChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onReset: () => void;
};

export default function StockFilters(props: Props) {
  return (
    <section className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-3 shadow-sm backdrop-blur sm:px-5">
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex gap-2">
          <input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Search SKU..."
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium outline-none transition focus:border-slate-900"
          />
          <button
            type="button"
            onClick={props.onReset}
            className="rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700"
          >
            Reset
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Select value={props.category} onChange={props.onCategoryChange} label="All Categories" options={props.categories} />
          <Select value={props.color} onChange={props.onColorChange} label="All Colors" options={props.colors} />
          <Select value={props.size} onChange={props.onSizeChange} label="All Sizes" options={props.sizes} />
          <select
            value={props.sort}
            onChange={(event) => props.onSortChange(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold outline-none"
          >
            <option value="sku-asc">SKU A–Z</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="stock-desc">Stock: High to Low</option>
          </select>
        </div>
      </div>
    </section>
  );
}

function Select({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold outline-none"
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
