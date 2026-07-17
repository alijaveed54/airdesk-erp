"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

export default function SchemaExportPage() {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");

  async function exportSchemas() {
    setExporting(true);
    setMessage("");

    try {
      const response = await fetch("/api/settings/schema-export", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Schema export failed");
      }

      const blob = await response.blob();
      const disposition =
        response.headers.get("Content-Disposition") || "";

      const fileNameMatch = disposition.match(/filename="([^"]+)"/);
      const fileName =
        fileNameMatch?.[1] || "airtable-all-bases-schema.json";

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = fileName;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);

      setMessage("Schema JSON downloaded successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Schema export failed"
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">
          Airtable Schema Export
        </h1>

        <p className="mt-2 text-sm font-bold text-slate-500">
          Export tables, fields, field types, linked records and select
          options for every active base registered in ERP Bases.
        </p>
      </div>

      <div className="max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-950">
          Export All Registered Bases
        </h2>

        <p className="mt-2 text-sm font-semibold text-slate-600">
          The downloaded JSON can be used to create automatic table and
          field mappings for the multi-company ERP.
        </p>

        <button
          type="button"
          onClick={exportSchemas}
          disabled={exporting}
          className="mt-6 flex h-12 items-center gap-2 rounded-2xl bg-blue-600 px-5 font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Download size={18} />
          )}

          {exporting ? "Exporting..." : "Download All Schemas"}
        </button>

        {message && (
          <p
            className={`mt-4 rounded-xl px-4 py-3 text-sm font-black ${
              message.toLowerCase().includes("success")
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
