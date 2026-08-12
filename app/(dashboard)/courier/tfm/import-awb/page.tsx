"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import {
  ChangeEvent,
  useMemo,
  useRef,
  useState,
} from "react";

type ParsedReportRow = {
  rowKey: string;
  orderNo: string;
  awb: string;
  created: string;
  status: string;
  lastActionDate: string;
  previousReportAwbs: string[];
};

type PreviewRow = ParsedReportRow & {
  recordId: string;
  currentAwb: string;
  previousAwbs: string[];
  currentStatus: string;
  action: "update" | "replace" | "same" | "invalid";
  selectable: boolean;
  warnings: string[];
  errors: string[];
};

type PreviewResponse = {
  success: boolean;
  message?: string;
  base?: {
    baseId: string;
    baseName: string;
    invoiceTable: string;
  };
  fields?: Record<string, string>;
  summary?: {
    total: number;
    matched: number;
    notFound: number;
    multipleMatches: number;
    same: number;
    update: number;
    replace: number;
  };
  rows?: PreviewRow[];
};

type ApplyResponse = {
  success: boolean;
  partial?: boolean;
  message?: string;
  updated?: Array<{
    orderNo: string;
    awb: string;
    recordId: string;
  }>;
  failed?: Array<{
    orderNo: string;
    awb: string;
    message: string;
  }>;
};

type Filter = "all" | "matched" | "replace" | "same" | "error";

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(value);
      value = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }

      row.push(value);
      value = "";

      if (row.some((cell) => cell.trim())) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    value += character;
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);

  return rows;
}

function parseDateTime(value: string) {
  const text = value.trim();
  const match = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );

  if (!match) {
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  let hour = Number(match[4]);
  const meridiem = (match[7] || "").toUpperCase();

  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  return new Date(
    Number(match[3]),
    Number(match[1]) - 1,
    Number(match[2]),
    hour,
    Number(match[5]),
    Number(match[6] || 0),
  ).getTime();
}

function unique(values: string[]) {
  const output = new Map<string, string>();

  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (text && !output.has(key)) output.set(key, text);
  }

  return Array.from(output.values());
}

function reportRowsFromCsv(text: string) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));

  if (rows.length < 2) {
    throw new Error("CSV is empty or has no data rows");
  }

  const headers = rows[0].map(normalizeHeader);
  const indexOf = (...names: string[]) =>
    headers.findIndex((header) =>
      names.map(normalizeHeader).includes(header),
    );

  const column = {
    awb: indexOf("AWB"),
    orderNo: indexOf("SHIPPER REF #", "Shipper Ref", "Order Number"),
    created: indexOf("Created"),
    status: indexOf("Status"),
    lastActionDate: indexOf("Last Action Date"),
  };

  if (column.awb < 0 || column.orderNo < 0) {
    throw new Error(
      "Required columns were not found. CSV must contain AWB and SHIPPER REF #.",
    );
  }

  const sourceRows = rows.slice(1).map((cells, index) => ({
    rowKey: String(index + 2),
    orderNo: String(cells[column.orderNo] || "").trim(),
    awb: String(cells[column.awb] || "")
      .trim()
      .replace(/\.0$/, ""),
    created:
      column.created >= 0
        ? String(cells[column.created] || "").trim()
        : "",
    status:
      column.status >= 0
        ? String(cells[column.status] || "").trim()
        : "",
    lastActionDate:
      column.lastActionDate >= 0
        ? String(cells[column.lastActionDate] || "").trim()
        : "",
  }));

  const grouped = new Map<string, typeof sourceRows>();

  for (const row of sourceRows) {
    if (!row.orderNo && !row.awb) continue;
    const key = row.orderNo.trim().toLowerCase();
    const current = grouped.get(key) || [];
    current.push(row);
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).map((group) => {
    const sorted = [...group].sort((left, right) => {
      const leftDate =
        parseDateTime(left.created) ||
        parseDateTime(left.lastActionDate) ||
        Number(left.rowKey);
      const rightDate =
        parseDateTime(right.created) ||
        parseDateTime(right.lastActionDate) ||
        Number(right.rowKey);
      return rightDate - leftDate;
    });
    const latest = sorted[0];
    const previousReportAwbs = unique(
      sorted.slice(1).map((row) => row.awb),
    ).filter(
      (awb) => awb.toLowerCase() !== latest.awb.toLowerCase(),
    );

    return {
      ...latest,
      previousReportAwbs,
    } satisfies ParsedReportRow;
  });
}

function badgeClass(action: PreviewRow["action"]) {
  if (action === "replace") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (action === "same") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (action === "invalid") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function TfmAwbImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [reportRows, setReportRows] = useState<ParsedReportRow[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ApplyResponse | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setError("");
    setPreview(null);
    setSelected([]);
    setResult(null);

    try {
      const text = await file.text();
      const parsed = reportRowsFromCsv(text);
      setFileName(file.name);
      setReportRows(parsed);
    } catch (fileError) {
      setFileName("");
      setReportRows([]);
      setError(
        fileError instanceof Error
          ? fileError.message
          : "TFM CSV could not be read",
      );
    }
  }

  async function buildPreview() {
    if (!reportRows.length) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/tfm/awb-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ rows: reportRows }),
      });
      const data = (await response.json()) as PreviewResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "AWB preview failed");
      }

      setPreview(data);
      setSelected(
        (data.rows || [])
          .filter((row) => row.selectable)
          .map((row) => row.rowKey),
      );
    } catch (previewError) {
      setPreview(null);
      setSelected([]);
      setError(
        previewError instanceof Error
          ? previewError.message
          : "AWB preview failed",
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return (preview?.rows || []).filter((row) => {
      const matchesSearch =
        !query ||
        [
          row.orderNo,
          row.awb,
          row.currentAwb,
          row.status,
          row.currentStatus,
          ...row.previousAwbs,
          ...row.warnings,
          ...row.errors,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesFilter =
        filter === "all" ||
        (filter === "matched" && row.selectable) ||
        (filter === "replace" && row.action === "replace") ||
        (filter === "same" && row.action === "same") ||
        (filter === "error" && !row.selectable);

      return matchesSearch && matchesFilter;
    });
  }, [filter, preview?.rows, search]);

  const selectableVisible = filteredRows.filter(
    (row) => row.selectable,
  );
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((row) => selected.includes(row.rowKey));

  function toggleRow(row: PreviewRow) {
    if (!row.selectable) return;

    setSelected((current) =>
      current.includes(row.rowKey)
        ? current.filter((key) => key !== row.rowKey)
        : [...current, row.rowKey],
    );
  }

  function toggleVisible() {
    const visibleKeys = selectableVisible.map((row) => row.rowKey);

    setSelected((current) => {
      if (allVisibleSelected) {
        return current.filter((key) => !visibleKeys.includes(key));
      }

      return Array.from(new Set([...current, ...visibleKeys]));
    });
  }

  async function applyUpdates() {
    const rows = (preview?.rows || []).filter(
      (row) => row.selectable && selected.includes(row.rowKey),
    );

    if (!rows.length) return;

    setApplying(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/tfm/awb-import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ rows }),
      });
      const data = (await response.json()) as ApplyResponse;

      if (!response.ok) {
        throw new Error(data.message || "AWB update failed");
      }

      setResult(data);
      await buildPreview();
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "AWB update failed",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link
            href="/courier/tfm"
            className="inline-flex items-center gap-2 text-sm font-black text-blue-700"
          >
            <ArrowLeft size={17} />
            Back to TFM Verification
          </Link>
          <h1 className="mt-2 text-3xl font-black text-slate-950">
            Import TFM AWB Report
          </h1>
          <p className="mt-1 max-w-3xl text-sm font-bold leading-6 text-slate-500">
            Match TFM AWBs to Airtable by SHIPPER REF #. Existing AWBs are
            preserved as history and the latest report AWB becomes current.
          </p>
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white"
        >
          <Upload size={17} />
          Select TFM CSV
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void handleFile(event)}
          className="hidden"
        />
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div
          className={[
            "rounded-2xl border p-4 font-bold",
            result.failed?.length
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          ].join(" ")}
        >
          <p className="font-black">{result.message}</p>
          {!!result.failed?.length && (
            <div className="mt-2 space-y-1 text-xs">
              {result.failed.slice(0, 20).map((item) => (
                <p key={`${item.orderNo}:${item.awb}:${item.message}`}>
                  {item.orderNo} · {item.awb}: {item.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <p className="font-black text-slate-950">
                {fileName || "No CSV selected"}
              </p>
              <p className="mt-1 text-sm font-bold text-slate-500">
                {reportRows.length
                  ? `${reportRows.length} unique Order Numbers ready for matching`
                  : "Required columns: AWB and SHIPPER REF #"}
              </p>
              {preview?.base && (
                <p className="mt-2 text-xs font-black text-blue-700">
                  Current base: {preview.base.baseName} · {preview.base.invoiceTable}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void buildPreview()}
            disabled={!reportRows.length || loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-40"
          >
            {loading ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            Match Orders
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold leading-6 text-blue-800">
          Import applies only to the currently selected ERP base. This TFM
          report contains BS and TAT references, so switch base and import the
          same CSV again for the other base. Rows not belonging to the current
          base appear as Not Found and are not updated.
        </div>
      </section>

      {preview?.summary && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Unique Orders" value={preview.summary.total} />
          <Stat label="Matched" value={preview.summary.matched} />
          <Stat label="New AWB" value={preview.summary.update} />
          <Stat label="Replace / History" value={preview.summary.replace} />
          <Stat label="Not Found" value={preview.summary.notFound} />
        </section>
      )}

      {preview && (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-xl">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order, AWB, status or warning..."
                className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-4 text-sm font-bold outline-none focus:border-blue-400"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "All"],
                  ["matched", "Matched"],
                  ["replace", "Replace / History"],
                  ["same", "Already Same"],
                  ["error", "Not Found / Error"],
                ] as Array<[Filter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={[
                    "h-10 rounded-xl border px-4 text-xs font-black",
                    filter === value
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-600",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-3 text-sm font-black text-slate-700">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleVisible}
                disabled={!selectableVisible.length}
                className="h-4 w-4 rounded"
              />
              Select visible matched rows
            </label>

            <button
              type="button"
              onClick={() => void applyUpdates()}
              disabled={!selected.length || applying}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white disabled:opacity-40"
            >
              {applying ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <ShieldCheck size={17} />
              )}
              Update Selected AWBs ({selected.length})
            </button>
          </div>
        </section>
      )}

      {preview && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1350px] text-left text-sm">
              <thead className="bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Select</th>
                  <th className="px-4 py-3">Order Number</th>
                  <th className="px-4 py-3">Report AWB</th>
                  <th className="px-4 py-3">Current AWB</th>
                  <th className="px-4 py-3">Previous AWBs</th>
                  <th className="px-4 py-3">Report Status</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Validation</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.rowKey}
                    className="border-t border-slate-100 align-top hover:bg-slate-50"
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.includes(row.rowKey)}
                        onChange={() => toggleRow(row)}
                        disabled={!row.selectable}
                        className="h-4 w-4 rounded disabled:opacity-30"
                      />
                    </td>
                    <td className="px-4 py-4 font-black text-blue-700">
                      {row.orderNo || "—"}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-black text-slate-950">{row.awb || "—"}</p>
                      {row.previousReportAwbs.length > 0 && (
                        <p className="mt-1 text-xs font-bold text-amber-700">
                          {row.previousReportAwbs.length} older report AWB(s)
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-700">
                      {row.currentAwb || "Empty"}
                    </td>
                    <td className="max-w-[280px] px-4 py-4 text-xs font-bold leading-5 text-slate-600">
                      {row.previousAwbs.length
                        ? row.previousAwbs.join(", ")
                        : "—"}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-bold text-slate-700">{row.status || "—"}</p>
                      {row.lastActionDate && (
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          {row.lastActionDate}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={[
                          "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase",
                          badgeClass(row.action),
                        ].join(" ")}
                      >
                        {row.action === "replace"
                          ? "Replace + History"
                          : row.action === "same"
                            ? "Already Same"
                            : row.action === "invalid"
                              ? "Blocked"
                              : "Update"}
                      </span>
                    </td>
                    <td className="max-w-[390px] px-4 py-4">
                      {row.selectable && !row.warnings.length && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                          <CheckCircle2 size={12} />
                          Ready
                        </span>
                      )}

                      <div className="space-y-1.5">
                        {row.warnings.map((warning) => (
                          <p
                            key={warning}
                            className="flex gap-1 text-xs font-bold leading-5 text-amber-700"
                          >
                            <AlertTriangle size={13} className="mt-1 shrink-0" />
                            {warning}
                          </p>
                        ))}
                        {row.errors.map((rowError) => (
                          <p
                            key={rowError}
                            className="flex gap-1 text-xs font-bold leading-5 text-red-700"
                          >
                            <XCircle size={13} className="mt-1 shrink-0" />
                            {rowError}
                          </p>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}

                {!filteredRows.length && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-12 text-center font-bold text-slate-500"
                    >
                      No rows match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
    </div>
  );
}
