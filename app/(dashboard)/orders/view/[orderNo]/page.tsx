"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Clock3, History, Loader2, RefreshCw, UserRound } from "lucide-react";

type OrderHistoryItem = {
  id: string;
  date: string;
  user: string;
  role: string;
  action: string;
  operation: string;
  module?: string;
  table?: string;
  recordId?: string;
  recordLabel?: string;
  source?: string;
  oldValue?: unknown;
  newValue?: unknown;
  changedFields?: unknown;
};

type ViewOrderResponse = {
  success: boolean;
  message?: string;
  orderNo?: string;
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
  };
  order?: {
    date?: string;
    store?: string;
    status?: string;
    totalAmount?: number;
  };
  records?: any[];
};


const AIRTABLE_RECORD_ID_PATTERN = /^rec[a-zA-Z0-9]{10,}$/;
const AIRTABLE_RECORD_ID_GLOBAL_PATTERN = /\brec[a-zA-Z0-9]{10,}\b/g;

function parsePossibleJson(value: string): unknown {
  const trimmed = value.trim();

  if (
    (!trimmed.startsWith("{") || !trimmed.endsWith("}")) &&
    (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isAirtableRecordId(value: unknown) {
  return (
    typeof value === "string" &&
    AIRTABLE_RECORD_ID_PATTERN.test(value.trim())
  );
}

function isBlankHistoryValue(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isTechnicalHistoryField(fieldName: string) {
  const normalized = fieldName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return [
    "id",
    "recordid",
    "airtablerecordid",
    "createdtime",
    "lastmodifiedtime",
  ].includes(normalized);
}

function humanizeHistoryField(fieldName: string) {
  const knownLabels: Record<string, string> = {
    order_status: "Order Status",
    orderstatus: "Order Status",
    order_no: "Order Number",
    orderno: "Order Number",
    bill_no: "Bill Number",
    received_in_wh_1: "Received in Warehouse",
    dispatched_from_wh_1: "Dispatched from UAE",
    dispatch_date_from_wh1: "UAE Dispatch Date",
  };

  const normalized = fieldName.trim().toLowerCase();

  if (knownLabels[normalized]) {
    return knownLabels[normalized];
  }

  return fieldName
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

function isOnlyLinkedReference(value: unknown): boolean {
  if (typeof value === "string") {
    const parsed = parsePossibleJson(value);

    if (parsed !== value) {
      return isOnlyLinkedReference(parsed);
    }

    return isAirtableRecordId(value);
  }

  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => isOnlyLinkedReference(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) return false;

    const preferredValue = (value as Record<string, unknown>).name ??
      (value as Record<string, unknown>).label ??
      (value as Record<string, unknown>).title ??
      (value as Record<string, unknown>).text ??
      (value as Record<string, unknown>).value;

    if (preferredValue !== undefined && !isAirtableRecordId(preferredValue)) {
      return false;
    }

    return entries.every(([key, item]) =>
      isTechnicalHistoryField(key) || isOnlyLinkedReference(item)
    );
  }

  return false;
}

function linkedReferenceChangeText(oldValue: unknown, newValue: unknown) {
  const oldIsReference = isOnlyLinkedReference(oldValue);
  const newIsReference = isOnlyLinkedReference(newValue);

  if (!oldIsReference && !newIsReference) return "";

  if (isBlankHistoryValue(oldValue) && newIsReference) {
    return "Linked record added";
  }

  if (oldIsReference && isBlankHistoryValue(newValue)) {
    return "Linked record removed";
  }

  return "Linked record updated";
}

function formatHistoryValue(value: unknown): string {
  if (isBlankHistoryValue(value)) return "Blank";

  if (typeof value === "string") {
    const parsed = parsePossibleJson(value);

    if (parsed !== value) {
      return formatHistoryValue(parsed);
    }

    if (isAirtableRecordId(value)) {
      return "Linked record";
    }

    return value.replace(AIRTABLE_RECORD_ID_GLOBAL_PATTERN, "Linked record");
  }

  if (Array.isArray(value)) {
    if (value.every((item) => isOnlyLinkedReference(item))) {
      return value.length === 1
        ? "Linked record"
        : `${value.length} linked records`;
    }

    const formattedValues = Array.from(
      new Set(value.map((item) => formatHistoryValue(item)).filter(Boolean))
    );

    return formattedValues.length > 0 ? formattedValues.join(", ") : "Blank";
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const preferredValue =
      objectValue.name ??
      objectValue.label ??
      objectValue.title ??
      objectValue.text ??
      objectValue.value;

    if (preferredValue !== undefined && !isAirtableRecordId(preferredValue)) {
      return formatHistoryValue(preferredValue);
    }

    const readableEntries = Object.entries(objectValue)
      .filter(([key]) => !isTechnicalHistoryField(key))
      .map(([key, item]) => `${humanizeHistoryField(key)}: ${formatHistoryValue(item)}`)
      .filter((item) => !item.endsWith(": Blank"));

    return readableEntries.length > 0
      ? readableEntries.join(" · ")
      : "Linked record";
  }

  return String(value);
}

function formatHistoryDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value || "—";

  return date.toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function historyOperationClass(operation: string) {
  switch (String(operation || "").toUpperCase()) {
    case "CREATE":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "DELETE":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-blue-200 bg-blue-50 text-blue-700";
  }
}

function getChangedItems(item: OrderHistoryItem) {
  const fields = item.changedFields;
  if (!fields || typeof fields !== "object") return [];

  return Object.entries(fields as Record<string, any>)
    .filter(([key]) => !isTechnicalHistoryField(key))
    .map(([key, value]) => ({
      key: humanizeHistoryField(key),
      oldValue: value?.old ?? value?.from ?? "",
      newValue: value?.new ?? value?.to ?? "",
    }));
}

export default function ViewOrderPage() {
  const params = useParams();
  const router = useRouter();
  const orderNo = String(params.orderNo || "");

  const [data, setData] = useState<ViewOrderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [history, setHistory] = useState<OrderHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const records = data?.records || [];
  const totalQty = useMemo(
    () =>
      records.reduce(
        (total, record) => total + Number(record.fields?.quantity || 0),
        0
      ),
    [records]
  );

  async function loadHistory() {
    if (!orderNo) return;

    setHistoryLoading(true);

    try {
      const res = await fetch(
        `/api/orders/history?orderNo=${encodeURIComponent(orderNo)}`,
        { cache: "no-store" }
      );

      const result = await res.json();

      if (result.success) {
        setHistory(result.history || []);
      } else {
        setHistory([]);
      }
    } catch (error) {
      console.error("History loading failed:", error);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadOrder() {
    setLoading(true);

    try {
      const res = await fetch(
        `/api/orders/view?orderNo=${encodeURIComponent(orderNo)}`,
        { cache: "no-store" }
      );

      const responseText = await res.text();
      let result: ViewOrderResponse | null = null;

      try {
        result = responseText ? JSON.parse(responseText) : null;
      } catch {
        result = null;
      }

      if (!res.ok || !result?.success) {
        alert(result?.message || "Order not found");
        setData(null);
        return;
      }

      setData(result);
    } catch (error) {
      console.error("Order view failed:", error);
      alert("Order view failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orderNo) {
      loadOrder();
      loadHistory();
    }
  }, [orderNo]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900">Order View</h1>
        <p className="text-slate-500">{orderNo}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded-xl border px-4 py-2 font-black"
        >
          Back
        </button>

        <button
          type="button"
          onClick={() => {
            void Promise.all([loadOrder(), loadHistory()]);
          }}
          disabled={loading || historyLoading}
          className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 font-black text-blue-700 disabled:opacity-50"
        >
          {loading || historyLoading ? "Refreshing..." : "Refresh"}
        </button>

        <button
          type="button"
          onClick={() => router.push(`/orders/edit/${orderNo}`)}
          className="rounded-xl bg-slate-900 px-4 py-2 font-black text-white"
        >
          Edit Order
        </button>

        <button
          type="button"
          onClick={() =>
            router.push(
              `/orders/print?orderNo=${encodeURIComponent(orderNo)}`
            )
          }
          className="rounded-xl bg-emerald-600 px-4 py-2 font-black text-white hover:bg-emerald-700"
        >
          Print Order
        </button>
      </div>

      {loading ? (
        <div className="rounded-3xl border bg-white p-8 font-bold">
          Loading order...
        </div>
      ) : !data ? (
        <div className="rounded-3xl border bg-white p-8 font-bold text-red-600">
          Order could not be loaded.
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            <div className="rounded-3xl border bg-slate-50 p-5">
              <h2 className="mb-4 text-xl font-black">Order Information</h2>
              <div className="space-y-3 text-sm">
                <p><b>Order No:</b> {data.orderNo || orderNo}</p>
                <p><b>Order Date:</b> {data.order?.date || "-"}</p>
                <p><b>Store:</b> {data.order?.store || "-"}</p>
                <p><b>Status:</b> {data.order?.status || "-"}</p>
                <p><b>Total SKU Lines:</b> {records.length}</p>
                <p><b>Total Qty:</b> {totalQty}</p>
                <p><b>Total Amount:</b> {data.order?.totalAmount ?? "-"}</p>
              </div>
            </div>

            <div className="rounded-3xl border bg-slate-50 p-5">
              <h2 className="mb-4 text-xl font-black">Customer Information</h2>
              <div className="space-y-3 text-sm">
                <p><b>Customer:</b> {data.customer?.name || "-"}</p>
                <p><b>Mobile:</b> {data.customer?.phone || "-"}</p>
                <p><b>City:</b> {data.customer?.city || "-"}</p>
                <p><b>Country:</b> {data.customer?.country || "-"}</p>
                <p><b>Address:</b> {data.customer?.address || "-"}</p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left">Image</th>
                  <th className="px-4 py-3 text-left">Item Code</th>
                  <th className="px-4 py-3 text-left">Product Name</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-center">Qty</th>
                  <th className="px-4 py-3 text-left">Received WH</th>
                  <th className="px-4 py-3 text-left">Bill No</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>

              <tbody>
                {records.map((record) => {
                  const fields = record.fields || {};
                  const received =
                    String(fields.received_in_wh_1 || "").toLowerCase() === "yes";
                  const billNo = String(fields.bill_no || "").trim();
                  const billNoLower = billNo.toLowerCase();
                  const isStockOut =
                    billNoLower === "stock out" ||
                    billNoLower === "sold out" ||
                    billNoLower === "sold";

                  let status = "Pending";
                  let badge = "bg-yellow-100 text-yellow-700";

                  if (received && isStockOut) {
                    status = "Stock Out";
                    badge = "bg-red-100 text-red-700";
                  } else if (received && !billNo) {
                    status = "In Stock";
                    badge = "bg-indigo-100 text-indigo-700";
                  } else if (received && billNo) {
                    status = "Dispatched";
                    badge = "bg-green-100 text-green-700";
                  }

                  return (
                    <tr key={record.id} className="border-t">
                      <td className="px-4 py-3">
                        {fields.image?.[0]?.url ? (
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                fields.image[0].url,
                                "_blank",
                                "noopener,noreferrer"
                              )
                            }
                            className="block cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            title="Open full image"
                          >
                            <img
                              src={fields.image[0].url}
                              alt={fields["Item Code"] || "Product"}
                              className="h-16 w-12 rounded-lg object-cover"
                            />
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3 font-bold">
                        {fields["Item Code"] || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {fields["Product Name"] || "-"}
                      </td>
                      <td className="px-4 py-3">{fields.Supplier || "-"}</td>
                      <td className="px-4 py-3 text-center font-black">
                        {fields.quantity || 0}
                      </td>
                      <td className="px-4 py-3">
                        {fields.received_in_wh_1 || "-"}
                      </td>
                      <td className="px-4 py-3">{fields.bill_no || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${badge}`}>
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <History size={20} className="text-blue-600" />
                  <h2 className="text-xl font-black text-slate-900">
                    History
                  </h2>
                </div>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  {history.length} change{history.length === 1 ? "" : "s"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void loadHistory()}
                disabled={historyLoading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Refresh order history"
              >
                {historyLoading ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                {historyLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {historyLoading && history.length === 0 ? (
              <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-4 font-bold text-slate-500">
                <Loader2 size={17} className="animate-spin" />
                Loading history...
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <History size={24} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-bold text-slate-500">
                  No history available
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {history.map((item) => {
                  const changes = getChangedItems(item);

                  return (
                    <article
                      key={item.id}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                    >
                      <div className="border-b border-slate-100 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-black text-slate-900">
                              {item.action || item.operation || "Order updated"}
                            </h3>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-500">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 size={13} />
                                {formatHistoryDate(item.date)}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <UserRound size={13} />
                                {item.user || "Unknown user"}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${historyOperationClass(item.operation)}`}
                          >
                            {item.operation || "UPDATE"}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.role && (
                            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500 ring-1 ring-slate-200">
                              {item.role}
                            </span>
                          )}
                          {[item.module, item.table, item.recordLabel]
                            .filter(
                              (label): label is string =>
                                Boolean(label) && !isAirtableRecordId(label)
                            )
                            .map((label) => (
                              <span
                                key={label}
                                className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-400 ring-1 ring-slate-200"
                              >
                                {label}
                              </span>
                            ))}
                        </div>
                      </div>

                      <div className="space-y-3 p-4">
                        {changes.length > 0 ? (
                          changes.map((change) => {
                            const linkedChange = linkedReferenceChangeText(
                              change.oldValue,
                              change.newValue
                            );

                            return (
                              <div
                                key={change.key}
                                className="rounded-xl border border-slate-200 p-3"
                              >
                                <p className="mb-2 text-xs font-black text-slate-700">
                                  {change.key}
                                </p>

                                {linkedChange ? (
                                  <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                                    {linkedChange}
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                                    <div className="min-w-0 rounded-lg bg-red-50 px-2.5 py-2">
                                      <p className="text-[9px] font-black uppercase tracking-wide text-red-400">
                                        Previous
                                      </p>
                                      <p className="mt-1 break-words text-xs font-bold text-red-700">
                                        {formatHistoryValue(change.oldValue)}
                                      </p>
                                    </div>

                                    <ArrowRight size={15} className="text-slate-300" />

                                    <div className="min-w-0 rounded-lg bg-emerald-50 px-2.5 py-2">
                                      <p className="text-[9px] font-black uppercase tracking-wide text-emerald-500">
                                        New
                                      </p>
                                      <p className="mt-1 break-words text-xs font-bold text-emerald-700">
                                        {formatHistoryValue(change.newValue)}
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : linkedReferenceChangeText(
                            item.oldValue,
                            item.newValue
                          ) ? (
                          <div className="rounded-xl bg-blue-50 p-3 text-xs font-bold text-blue-700">
                            {linkedReferenceChangeText(item.oldValue, item.newValue)}
                          </div>
                        ) : (
                          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                            <div className="min-w-0 rounded-xl bg-red-50 p-3">
                              <p className="text-[9px] font-black uppercase tracking-wide text-red-400">
                                Previous
                              </p>
                              <p className="mt-1 break-words text-xs font-bold text-red-700">
                                {formatHistoryValue(item.oldValue)}
                              </p>
                            </div>

                            <ArrowRight size={15} className="text-slate-300" />

                            <div className="min-w-0 rounded-xl bg-emerald-50 p-3">
                              <p className="text-[9px] font-black uppercase tracking-wide text-emerald-500">
                                New
                              </p>
                              <p className="mt-1 break-words text-xs font-bold text-emerald-700">
                                {formatHistoryValue(item.newValue)}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} alt="Preview" className="max-h-[95vh] max-w-[95vw] object-contain" onClick={(e)=>e.stopPropagation()} />
          <button type="button" onClick={() => setPreviewImage(null)} className="absolute right-6 top-6 rounded-full bg-white px-4 py-2 font-bold">✕</button>
        </div>
      )}
    </div>
  );
}