"use client";

import { useEffect, useState } from "react";
import { Database, Download, Loader2, RefreshCw } from "lucide-react";

type BasePermission = {
  baseName: string;
  baseId: string;
  canUsers?: boolean;
};

export default function SchemaManagerPage() {
  const [bases, setBases] = useState<BasePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");

  async function loadBases() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load available bases");
      }

      const user = data.user || {};
      const available = user.availableBases?.length
        ? user.availableBases
        : user.permissions || [];

      setBases(
        available.filter(
          (base: BasePermission) => base.baseId && base.baseName
        )
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load available bases"
      );
      setBases([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBases();
  }, []);

  async function downloadSchema(base?: BasePermission) {
    const downloadKey = base?.baseId || "all";
    setDownloading(downloadKey);
    setError("");

    try {
      const url = base
        ? `/api/admin/schema/export?baseId=${encodeURIComponent(base.baseId)}`
        : "/api/admin/schema/export";

      const response = await fetch(url, { cache: "no-store" });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Schema download failed");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^\"]+)"?/i);
      const fallbackName = base
        ? `${base.baseName}-schema.json`
        : "airtable-all-bases-schema.json";
      const fileName = match?.[1] || fallbackName;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Schema download failed"
      );
    } finally {
      setDownloading("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">Schema Manager</h1>
        <p className="mt-1 text-slate-500">
          Download the latest live Airtable schema.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => downloadSchema()}
          disabled={loading || downloading !== "" || bases.length === 0}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-50"
        >
          {downloading === "all" ? (
            <Loader2 size={17} className="animate-spin" />
          ) : (
            <Download size={17} />
          )}
          Download All Bases
        </button>

        <button
          type="button"
          onClick={loadBases}
          disabled={loading || downloading !== ""}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-5 text-sm font-black text-blue-700 disabled:opacity-50"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border bg-white p-8 font-bold text-slate-600">
          Loading bases...
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bases.map((base) => (
            <div
              key={base.baseId}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                  <Database size={22} />
                </div>

                <div className="min-w-0">
                  <h2 className="font-black text-slate-950">{base.baseName}</h2>
                  <p className="mt-1 truncate text-xs font-bold text-slate-400">
                    {base.baseId}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => downloadSchema(base)}
                disabled={downloading !== ""}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 px-4 text-sm font-black text-white disabled:opacity-50"
              >
                {downloading === base.baseId ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Download size={17} />
                )}
                Download Latest Schema
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
