"use client";

import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  Truck,
  UserRoundX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type ExceptionType =
  | "customer_details"
  | "missing_supplier"
  | "missing_bill"
  | "stuck_order"
  | "partially_ready"
  | "courier_booking_failed"
  | "delivery_failed"
  | "stock_mismatch"
  | "duplicate_order"
  | "cod_overdue";

type Severity = "high" | "medium" | "low";

type ExceptionIssue = {
  id: string;
  type: ExceptionType;
  severity: Severity;
  title: string;
  detail: string;
  baseId: string;
  baseName: string;
  orderNo: string;
  recordId: string;
  tableName: string;
  status: string;
  ageDays: number | null;
  amount?: number;
};

type BaseResult = {
  baseId: string;
  baseName: string;
  invoiceTable: string;
  orderEntryTable: string;
  issueCount: number;
  coverage: string[];
  warnings: string[];
  error?: string;
  truncated: boolean;
};

type DashboardResponse = {
  success: boolean;
  message?: string;
  generatedAt?: string;
  scope?: "all-bases" | "selected-base";
  selectedBaseId?: string;
  selectedBaseName?: string;
  stuckDays?: number;
  summary?: {
    total: number;
    high: number;
    medium: number;
    low: number;
    basesScanned: number;
    basesFailed: number;
    byType: Record<ExceptionType, number>;
  };
  bases?: BaseResult[];
  issues?: ExceptionIssue[];
};

const PAGE_SIZE = 40;

const TYPE_META: Record<
  ExceptionType,
  {
    label: string;
    description: string;
  }
> = {
  customer_details: {
    label: "Customer Details",
    description:
      "Missing customer name, mobile, address or city",
  },
  missing_supplier: {
    label: "Missing Supplier",
    description:
      "Order item has no supplier assignment",
  },
  missing_bill: {
    label: "Missing Bill",
    description:
      "Received/dispatched supplier item has no bill number",
  },
  stuck_order: {
    label: "Stuck Orders",
    description:
      "Active order older than the selected threshold",
  },
  partially_ready: {
    label: "Partially Ready",
    description:
      "Only part of the order is ready",
  },
  courier_booking_failed: {
    label: "Courier Failed",
    description:
      "Booking error or dispatched TFM order without AWB",
  },
  delivery_failed: {
    label: "Delivery Failed",
    description:
      "Failed, refused, undelivered or RTO order",
  },
  stock_mismatch: {
    label: "Stock Mismatch",
    description:
      "Received/in-stock line has zero quantity",
  },
  duplicate_order: {
    label: "Duplicate Order",
    description:
      "More than one invoice uses the same order number",
  },
  cod_overdue: {
    label: "COD Overdue",
    description:
      "Delivered order without COD received confirmation",
  },
};

function severityClass(severity: Severity) {
  if (severity === "high") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (severity === "medium") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-blue-200 bg-blue-50 text-blue-700";
}

function formatDate(value?: string) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-PK");
}

export default function ExceptionDashboardPage() {
  const [data, setData] =
    useState<DashboardResponse | null>(null);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] =
    useState<ExceptionType | "all">("all");
  const [severity, setSeverity] =
    useState<Severity | "all">("all");
  const [baseId, setBaseId] =
    useState("all");
  const [stuckDays, setStuckDays] =
    useState(3);
  const [page, setPage] = useState(1);
  const [opening, setOpening] =
    useState("");
  const [copied, setCopied] =
    useState(false);

  const loadDashboard = useCallback(
    async (days: number) => {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/exceptions?stuckDays=${days}`,
          {
            cache: "no-store",
          },
        );
        const result =
          (await response.json()) as DashboardResponse;

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.message ||
              "Exception Dashboard could not load",
          );
        }

        setData(result);
        setPage(1);
      } catch (loadError) {
        setData(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Exception Dashboard could not load",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadDashboard(stuckDays);
  }, [loadDashboard, stuckDays]);

  const baseOptions = useMemo(
    () =>
      (data?.bases || []).filter(
        (base) => !base.error,
      ),
    [data],
  );

  const filteredIssues = useMemo(() => {
    const query = search.trim().toLowerCase();

    return (data?.issues || []).filter(
      (issue) => {
        const matchesSearch =
          !query ||
          [
            issue.orderNo,
            issue.title,
            issue.detail,
            issue.baseName,
            issue.status,
            issue.tableName,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query);

        const matchesType =
          type === "all" || issue.type === type;

        const matchesSeverity =
          severity === "all" ||
          issue.severity === severity;

        const matchesBase =
          baseId === "all" ||
          issue.baseId === baseId;

        return (
          matchesSearch &&
          matchesType &&
          matchesSeverity &&
          matchesBase
        );
      },
    );
  }, [
    baseId,
    data,
    search,
    severity,
    type,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredIssues.length / PAGE_SIZE,
    ),
  );

  const visibleIssues = filteredIssues.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [search, type, severity, baseId]);

  async function openIssue(
    issue: ExceptionIssue,
  ) {
    setOpening(issue.id);
    setError("");

    try {
      if (
        issue.baseId &&
        issue.baseId !== data?.selectedBaseId
      ) {
        const response = await fetch(
          "/api/auth/select-base",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              baseId: issue.baseId,
            }),
          },
        );

        const result = await response.json();

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.message ||
              "Base could not be selected",
          );
        }
      }

      const target =
        issue.type === "duplicate_order"
          ? `/orders/list?search=${encodeURIComponent(
              issue.orderNo,
            )}`
          : issue.orderNo
            ? `/orders/view/${encodeURIComponent(
                issue.orderNo,
              )}`
            : "/orders/list";

      window.location.href = target;
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Order could not be opened",
      );
      setOpening("");
    }
  }

  async function copyVisible() {
    if (!visibleIssues.length) return;

    const lines = visibleIssues.map(
      (issue) =>
        `${issue.baseName} | ${issue.orderNo || "—"} | ${
          TYPE_META[issue.type].label
        } | ${issue.detail}`,
    );

    await navigator.clipboard.writeText(
      lines.join("\n"),
    );
    setCopied(true);
    window.setTimeout(
      () => setCopied(false),
      1500,
    );
  }

  const failedBases = (
    data?.bases || []
  ).filter((base) => base.error);

  const truncatedBases = (
    data?.bases || []
  ).filter((base) => base.truncated);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-red-700">
            <ShieldAlert size={18} />
            Operational Exceptions
          </div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Exception Dashboard
          </h1>
          <p className="mt-1 max-w-4xl text-sm font-bold leading-6 text-slate-500">
            {data?.scope === "all-bases"
              ? "Admin view: all accessible business bases are combined."
              : `User view: only ${
                  data?.selectedBaseName ||
                  "the selected base"
                } is included.`}
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            void loadDashboard(stuckDays)
          }
          disabled={loading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-50"
        >
          <RefreshCw
            size={17}
            className={
              loading ? "animate-spin" : ""
            }
          />
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">
          {error}
        </div>
      )}

      {failedBases.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-black text-amber-900">
            {failedBases.length} base scan(s)
            failed
          </p>
          <div className="mt-2 space-y-1 text-sm font-bold text-amber-800">
            {failedBases.map((base) => (
              <p key={base.baseId}>
                {base.baseName}: {base.error}
              </p>
            ))}
          </div>
        </div>
      )}

      {truncatedBases.length > 0 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          Record safety limit was reached in:{" "}
          {truncatedBases
            .map((base) => base.baseName)
            .join(", ")}. Increase
          `EXCEPTION_DASHBOARD_MAX_RECORDS_PER_TABLE`
          only when needed.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="All Exceptions"
          value={data?.summary?.total || 0}
          icon={ShieldAlert}
          active={type === "all"}
          onClick={() => setType("all")}
        />
        <SummaryCard
          label="High Priority"
          value={data?.summary?.high || 0}
          icon={AlertTriangle}
          active={severity === "high"}
          onClick={() =>
            setSeverity(
              severity === "high"
                ? "all"
                : "high",
            )
          }
        />
        <SummaryCard
          label="Medium Priority"
          value={data?.summary?.medium || 0}
          icon={Clock3}
          active={severity === "medium"}
          onClick={() =>
            setSeverity(
              severity === "medium"
                ? "all"
                : "medium",
            )
          }
        />
        <SummaryCard
          label="Bases Scanned"
          value={
            data?.summary?.basesScanned || 0
          }
          icon={Boxes}
        />
        <SummaryCard
          label="Scan Failures"
          value={
            data?.summary?.basesFailed || 0
          }
          icon={AlertTriangle}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(
          Object.keys(TYPE_META) as ExceptionType[]
        ).map((exceptionType) => {
          const meta = TYPE_META[exceptionType];
          const count =
            data?.summary?.byType?.[
              exceptionType
            ] || 0;
          const active =
            type === exceptionType;

          return (
            <button
              key={exceptionType}
              type="button"
              onClick={() =>
                setType(
                  active ? "all" : exceptionType,
                )
              }
              className={[
                "rounded-2xl border p-4 text-left transition",
                active
                  ? "border-blue-500 bg-blue-50 shadow-sm"
                  : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-black text-slate-900">
                  {meta.label}
                </p>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
                  {count}
                </span>
              </div>
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                {meta.description}
              </p>
            </button>
          );
        })}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_180px_150px]">
          <div className="relative">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search order, exception, base, status..."
              className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-4 text-sm font-bold outline-none focus:border-blue-400"
            />
          </div>

          <select
            value={type}
            onChange={(event) =>
              setType(
                event.target.value as
                  | ExceptionType
                  | "all",
              )
            }
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          >
            <option value="all">
              All exceptions
            </option>
            {(
              Object.keys(
                TYPE_META,
              ) as ExceptionType[]
            ).map((exceptionType) => (
              <option
                key={exceptionType}
                value={exceptionType}
              >
                {TYPE_META[exceptionType].label}
              </option>
            ))}
          </select>

          <select
            value={severity}
            onChange={(event) =>
              setSeverity(
                event.target.value as
                  | Severity
                  | "all",
              )
            }
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
          >
            <option value="all">
              All priorities
            </option>
            <option value="high">
              High priority
            </option>
            <option value="medium">
              Medium priority
            </option>
            <option value="low">
              Low priority
            </option>
          </select>

          {data?.scope === "all-bases" ? (
            <select
              value={baseId}
              onChange={(event) =>
                setBaseId(event.target.value)
              }
              className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
            >
              <option value="all">
                All bases
              </option>
              {baseOptions.map((base) => (
                <option
                  key={base.baseId}
                  value={base.baseId}
                >
                  {base.baseName}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-600">
              {data?.selectedBaseName || "Selected base"}
            </div>
          )}

          <select
            value={stuckDays}
            onChange={(event) =>
              setStuckDays(
                Number(event.target.value),
              )
            }
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400"
            title="Stuck order age"
          >
            <option value={2}>
              Stuck ≥ 2 days
            </option>
            <option value={3}>
              Stuck ≥ 3 days
            </option>
            <option value={5}>
              Stuck ≥ 5 days
            </option>
            <option value={7}>
              Stuck ≥ 7 days
            </option>
          </select>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-black text-slate-600">
            {filteredIssues.length} matching
            exception(s)
          </p>

          <button
            type="button"
            onClick={() => void copyVisible()}
            disabled={!visibleIssues.length}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 disabled:opacity-40"
          >
            <Copy size={15} />
            {copied
              ? "Copied"
              : "Copy visible rows"}
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] text-left text-sm">
            <thead className="bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">
                  Priority
                </th>
                <th className="px-4 py-3">
                  Exception
                </th>
                <th className="px-4 py-3">
                  Base
                </th>
                <th className="px-4 py-3">
                  Order
                </th>
                <th className="px-4 py-3">
                  Status / Age
                </th>
                <th className="px-4 py-3">
                  Details
                </th>
                <th className="px-4 py-3">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleIssues.map((issue) => (
                <tr
                  key={issue.id}
                  className="border-t border-slate-100 align-top hover:bg-slate-50"
                >
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${severityClass(
                        issue.severity,
                      )}`}
                    >
                      {issue.severity}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-black text-slate-950">
                      {issue.title}
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {TYPE_META[issue.type].label}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-black text-slate-800">
                      {issue.baseName}
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {issue.tableName || "—"}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-black text-blue-700">
                      {issue.orderNo || "—"}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-bold text-slate-700">
                      {issue.status || "—"}
                    </p>
                    <p className="mt-1 text-xs font-black text-slate-400">
                      {issue.ageDays === null
                        ? "Age unavailable"
                        : `${issue.ageDays} day(s)`}
                    </p>
                  </td>
                  <td className="max-w-[520px] px-4 py-4 font-bold leading-6 text-slate-600">
                    {issue.detail}
                  </td>
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      onClick={() =>
                        void openIssue(issue)
                      }
                      disabled={
                        opening === issue.id
                      }
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black text-white disabled:opacity-50"
                    >
                      {opening === issue.id ? (
                        <Loader2
                          size={15}
                          className="animate-spin"
                        />
                      ) : (
                        <ExternalLink size={15} />
                      )}
                      Open
                    </button>
                  </td>
                </tr>
              ))}

              {!loading &&
                visibleIssues.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-14 text-center font-bold text-slate-500"
                    >
                      No matching operational
                      exceptions found.
                    </td>
                  </tr>
                )}

              {loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-14 text-center"
                  >
                    <Loader2
                      size={28}
                      className="mx-auto animate-spin text-blue-600"
                    />
                    <p className="mt-2 font-black text-blue-600">
                      Scanning Airtable bases...
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-bold text-slate-500">
            Updated:{" "}
            {formatDate(data?.generatedAt)}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setPage((current) =>
                  Math.max(1, current - 1),
                )
              }
              disabled={page <= 1}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40"
            >
              <ChevronLeft size={17} />
            </button>

            <span className="min-w-28 text-center text-xs font-black text-slate-600">
              Page {page} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() =>
                setPage((current) =>
                  Math.min(
                    totalPages,
                    current + 1,
                  ),
                )
              }
              disabled={page >= totalPages}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {(data?.bases || []).map((base) => (
          <div
            key={base.baseId}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-black text-slate-950">
                  {base.baseName}
                </p>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  {base.invoiceTable || "No invoice table"} ·{" "}
                  {base.orderEntryTable ||
                    "No order-entry table"}
                </p>
              </div>

              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                {base.issueCount}
              </span>
            </div>

            {base.error ? (
              <p className="mt-4 text-sm font-bold text-red-700">
                {base.error}
              </p>
            ) : (
              <>
                <p className="mt-4 text-xs font-black uppercase text-slate-400">
                  Rules available
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {base.coverage.map((rule) => (
                    <span
                      key={rule}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700"
                    >
                      {rule}
                    </span>
                  ))}

                  {base.coverage.length === 0 && (
                    <span className="text-xs font-bold text-slate-400">
                      No matching fields detected
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof ShieldAlert;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <div
      className={[
        "rounded-3xl border p-5 text-left shadow-sm transition",
        active
          ? "border-blue-500 bg-blue-50"
          : "border-slate-200 bg-white",
        onClick
          ? "hover:border-blue-300 hover:bg-blue-50/40"
          : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-3xl font-black text-slate-950">
            {value}
          </p>
        </div>

        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-700">
          <Icon size={22} />
        </div>
      </div>
    </div>
  );

  if (!onClick) return content;

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left"
    >
      {content}
    </button>
  );
}
