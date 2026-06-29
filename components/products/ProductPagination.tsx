"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  loading: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

export default function ProductPagination({
  loading,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: Props) {
  return (
    <div className="mt-5 flex items-center justify-between">
      <button
        onClick={onPrevious}
        disabled={!hasPrevious || loading}
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft size={18} />
        Previous
      </button>

      <button
        onClick={onNext}
        disabled={!hasNext || loading}
        className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
        <ChevronRight size={18} />
      </button>
    </div>
  );
}