import type { LucideIcon } from "lucide-react";

const tones = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  purple: "bg-purple-50 text-purple-700 ring-purple-100",
};

export default function StatCard({
  title,
  value,
  icon: Icon,
  tone = "emerald",
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  tone?: keyof typeof tones;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
        </div>
        <div className={`grid h-12 w-12 place-items-center rounded-2xl ring-1 ${tones[tone]}`}>
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}
