"use client";

import {
  ChevronLeft,
  ChevronRight,
  Database,
  Filter,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type LogRow = {
  id: string;
  fields: Record<string, unknown>;
};

type AuditResponse = {
  success: boolean;
  message?: string;
  records?: LogRow[];
  restoredPendingEvents?: number;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type Filters = {
  user: string;
  company: string;
  module: string;
  action: string;
  table: string;
  record: string;
  operation: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  user: "",
  company: "",
  module: "",
  action: "",
  table: "",
  record: "",
  operation: "",
  from: "",
  to: "",
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function formatDate(value: unknown) {
  const raw = text(value);

  if (!raw) return "—";

  const date = new Date(raw);

  return Number.isNaN(date.getTime())
    ? raw
    : date.toLocaleString("en-PK");
}

function compactJson(value: unknown) {
  const raw = text(value);

  if (!raw) return "—";

  try {
    const parsed = JSON.parse(raw);

    if (
      parsed === null ||
      parsed === undefined
    ) {
      return "—";
    }

    if (
      typeof parsed === "string" ||
      typeof parsed === "number" ||
      typeof parsed === "boolean"
    ) {
      return String(parsed);
    }

    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function operationClass(operation: string) {
  switch (operation.toUpperCase()) {
    case "CREATE":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "DELETE":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-blue-200 bg-blue-50 text-blue-700";
  }
}

export default function ActivityLogPage() {
  const [rows, setRows] =
    useState<LogRow[]>([]);
  const [filters, setFilters] =
    useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] =
    useState({
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 1,
    });
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState("");
  const [restored, setRestored] =
    useState(0);

  const loadLogs = useCallback(
    async (
      requestedPage: number,
      activeFilters: Filters
    ) => {
      setLoading(true);
      setError("");

      try {
        const params =
          new URLSearchParams({
            page: String(requestedPage),
            limit: "50",
          });

        for (const [key, value] of
          Object.entries(activeFilters)) {
          if (value.trim()) {
            params.set(key, value.trim());
          }
        }

        const response = await fetch(
          `/api/audit?${params.toString()}`,
          {
            cache: "no-store",
          }
        );
        const data =
          (await response.json()) as
            AuditResponse;

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data.message ||
            "Activity log load failed"
          );
        }

        setRows(data.records || []);
        setPagination(
          data.pagination || {
            page: requestedPage,
            limit: 50,
            total:
              data.records?.length || 0,
            totalPages: 1,
          }
        );
        setPage(requestedPage);
        setRestored(
          Number(
            data.restoredPendingEvents ||
              0
          )
        );
      } catch (loadError) {
        setRows([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Activity log load failed"
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadLogs(1, EMPTY_FILTERS);
  }, [loadLogs]);

  const rangeLabel = useMemo(() => {
    if (!pagination.total) {
      return "0 records";
    }

    const start =
      (pagination.page - 1) *
        pagination.limit +
      1;
    const end = Math.min(
      pagination.page *
        pagination.limit,
      pagination.total
    );

    return `${start}–${end} of ${pagination.total}`;
  }, [pagination]);

  function applyFilters() {
    const next = { ...filters };
    setAppliedFilters(next);
    void loadLogs(1, next);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    void loadLogs(1, EMPTY_FILTERS);
  }

  function updateFilter(
    key: keyof Filters,
    value: string
  ) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-blue-700">
            <Database size={18} />
            SQL Airtable History
          </div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Activity Log
          </h1>
          <p className="mt-1 max-w-3xl text-sm font-bold leading-6 text-slate-500">
            Sirf Airtable records ke create, update aur delete changes. Facebook, R2, searches aur page views is history mein include nahi hain.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            void loadLogs(
              page,
              appliedFilters
            )
          }
          disabled={loading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-50"
        >
          {loading ? (
            <Loader2
              size={17}
              className="animate-spin"
            />
          ) : (
            <RefreshCw size={17} />
          )}
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">
          {error}
        </div>
      )}

      {restored > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-800">
          {restored} pending audit event(s) R2 fallback se SQL mein restore hue.
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-800">
          <Filter size={17} />
          Filters
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input
            value={filters.user}
            onChange={(event) =>
              updateFilter(
                "user",
                event.target.value
              )
            }
            placeholder="User / full name"
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          />
          <input
            value={filters.company}
            onChange={(event) =>
              updateFilter(
                "company",
                event.target.value
              )
            }
            placeholder="Company / base"
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          />
          <input
            value={filters.module}
            onChange={(event) =>
              updateFilter(
                "module",
                event.target.value
              )
            }
            placeholder="Module"
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          />
          <input
            value={filters.action}
            onChange={(event) =>
              updateFilter(
                "action",
                event.target.value
              )
            }
            placeholder="Action"
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          />
          <input
            value={filters.table}
            onChange={(event) =>
              updateFilter(
                "table",
                event.target.value
              )
            }
            placeholder="Airtable table"
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          />
          <input
            value={filters.record}
            onChange={(event) =>
              updateFilter(
                "record",
                event.target.value
              )
            }
            placeholder="Order No / SKU / Record ID"
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          />
          <select
            value={filters.operation}
            onChange={(event) =>
              updateFilter(
                "operation",
                event.target.value
              )
            }
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          >
            <option value="">
              All operations
            </option>
            <option value="CREATE">
              Create
            </option>
            <option value="UPDATE">
              Update
            </option>
            <option value="DELETE">
              Delete
            </option>
          </select>
          <input
            type="date"
            value={filters.from}
            onChange={(event) =>
              updateFilter(
                "from",
                event.target.value
              )
            }
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(event) =>
              updateFilter(
                "to",
                event.target.value
              )
            }
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyFilters}
              disabled={loading}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              <Filter size={15} />
              Apply
            </button>
            <button
              type="button"
              onClick={resetFilters}
              disabled={loading}
              title="Reset filters"
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">
              Airtable Change History
            </h2>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {rangeLabel}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void loadLogs(
                  Math.max(page - 1, 1),
                  appliedFilters
                )
              }
              disabled={
                loading || page <= 1
              }
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40"
            >
              <ChevronLeft size={17} />
            </button>
            <span className="min-w-24 text-center text-xs font-black text-slate-600">
              Page {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() =>
                void loadLogs(
                  Math.min(
                    page + 1,
                    pagination.totalPages
                  ),
                  appliedFilters
                )
              }
              disabled={
                loading ||
                page >=
                  pagination.totalPages
              }
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>

        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1850px] text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Table</th>
                <th className="px-4 py-3 text-left">Module</th>
                <th className="px-4 py-3 text-left">Operation</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Record</th>
                <th className="px-4 py-3 text-left">Changed Fields</th>
                <th className="px-4 py-3 text-left">Old Data</th>
                <th className="px-4 py-3 text-left">New Data</th>
                <th className="px-4 py-3 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const fields = row.fields;
                const operation = text(
                  fields.Operation
                );

                return (
                  <tr
                    key={row.id}
                    className="border-t border-slate-100 align-top hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-600">
                      {formatDate(fields.Date)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-black text-slate-900">
                        {text(fields["Full Name"]) || text(fields.User) || "—"}
                      </p>
                      <p className="mt-0.5 text-xs font-bold text-slate-400">
                        {text(fields.User)}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-bold">
                      {text(fields.Role) || "—"}
                    </td>
                    <td className="px-4 py-3 font-bold">
                      {text(fields.Company) || "—"}
                    </td>
                    <td className="px-4 py-3 font-black text-violet-700">
                      {text(fields["Airtable Table"]) || "—"}
                    </td>
                    <td className="px-4 py-3 font-bold">
                      {text(fields.Module) || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${operationClass(operation)}`}
                      >
                        {operation || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-black text-slate-900">
                      {text(fields.Action) || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-black text-blue-700">
                        {text(fields["Record Label"]) || text(fields["Record ID"]) || "—"}
                      </p>
                      <p className="mt-0.5 text-xs font-bold text-slate-400">
                        {text(fields["Record ID"])}
                      </p>
                    </td>
                    <td className="max-w-[360px] px-4 py-3">
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
                        {compactJson(fields["Changed Fields"])}
                      </pre>
                    </td>
                    <td className="max-w-[360px] px-4 py-3">
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-red-50 p-3 text-xs font-semibold leading-5 text-red-900">
                        {compactJson(fields["Old Value"])}
                      </pre>
                    </td>
                    <td className="max-w-[360px] px-4 py-3">
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-emerald-50 p-3 text-xs font-semibold leading-5 text-emerald-900">
                        {compactJson(fields["New Value"])}
                      </pre>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-500">
                      {text(fields.Source) || "—"}
                    </td>
                  </tr>
                );
              })}

              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={13}
                    className="px-4 py-12 text-center font-bold text-slate-500"
                  >
                    No Airtable change history found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td
                    colSpan={13}
                    className="px-4 py-12 text-center"
                  >
                    <Loader2
                      size={24}
                      className="mx-auto animate-spin text-blue-600"
                    />
                    <p className="mt-2 font-black text-blue-600">
                      Loading activity history...
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
