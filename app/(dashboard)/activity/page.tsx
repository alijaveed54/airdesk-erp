"use client";

import { useEffect, useState } from "react";

type LogRow = {
  id: string;
  fields: Record<string, any>;
};

export default function ActivityLogPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ user: "", module: "", action: "" });

  async function loadLogs() {
    setLoading(true);

    const params = new URLSearchParams();
    if (filters.user.trim()) params.set("user", filters.user.trim());
    if (filters.module.trim()) params.set("module", filters.module.trim());
    if (filters.action.trim()) params.set("action", filters.action.trim());

    const res = await fetch(`/api/audit?${params.toString()}`);
    const data = await res.json();

    if (res.ok && data.success) setRows(data.records || []);
    else alert(data.message || "Activity log load failed");

    setLoading(false);
  }

  useEffect(() => {
    loadLogs();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">Activity Log</h1>
        <p className="mt-1 text-sm font-bold text-slate-500">
          Track user actions, changes and important ERP events.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-4">
          <input value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} placeholder="User" className="h-11 rounded-xl border px-3 font-bold" />
          <input value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })} placeholder="Module" className="h-11 rounded-xl border px-3 font-bold" />
          <input value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} placeholder="Action" className="h-11 rounded-xl border px-3 font-bold" />
          <button type="button" onClick={loadLogs} disabled={loading} className="h-11 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-50">
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1300px] text-sm">
            <thead className="bg-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Module</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Record</th>
                <th className="px-4 py-3 text-left">Old Value</th>
                <th className="px-4 py-3 text-left">New Value</th>
                <th className="px-4 py-3 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-3 font-bold">{row.fields.Date ? new Date(row.fields.Date).toLocaleString() : "-"}</td>
                  <td className="px-4 py-3 font-black">{row.fields.User || "-"}</td>
                  <td className="px-4 py-3 font-bold">{row.fields.Role || "-"}</td>
                  <td className="px-4 py-3 font-bold">{row.fields.Company || "-"}</td>
                  <td className="px-4 py-3 font-bold">{row.fields.Module || "-"}</td>
                  <td className="px-4 py-3 font-black">{row.fields.Action || "-"}</td>
                  <td className="px-4 py-3 font-bold">{row.fields["Record Label"] || row.fields["Record ID"] || "-"}</td>
                  <td className="px-4 py-3 font-bold">{row.fields["Old Value"] || "-"}</td>
                  <td className="px-4 py-3 font-bold">{row.fields["New Value"] || "-"}</td>
                  <td className="px-4 py-3 font-bold">{row.fields.Note || "-"}</td>
                </tr>
              ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center font-bold text-slate-500">
                    No activity logs found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center font-bold text-blue-600">
                    Loading activity logs...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
