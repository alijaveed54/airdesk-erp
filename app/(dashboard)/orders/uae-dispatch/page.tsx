"use client";

import { useCallback, useEffect, useState } from "react";

type DispatchItem = {
  id: string;
  orderNo: string;
  sku: string;
  imageUrl: string;
  imageThumbnailUrl: string;
  quantity: number;
  supplier: string;
  billNo: string;
  orderStatus: string;
  dispatchedFromUae: string | boolean;
  dispatchDate: string;
};

type Draft = {
  dispatchedFromUae: string;
  dispatchDate: string;
};

function normalizeYes(value: unknown) {
  if (typeof value === "boolean") return value;
  return String(value ?? "").trim().toLowerCase() === "yes";
}

function getOrderNumberValue(value: string): number {
  const digits = value.match(/\d+/g);
  if (!digits) return -1;

  const parsed = Number(digits.join(""));
  return Number.isFinite(parsed) ? parsed : -1;
}

function compareOrderNumbersDescending(
  firstItem: DispatchItem,
  secondItem: DispatchItem
) {
  const numberDifference =
    getOrderNumberValue(secondItem.orderNo) -
    getOrderNumberValue(firstItem.orderNo);

  if (numberDifference !== 0) return numberDifference;

  const orderDifference = secondItem.orderNo.localeCompare(
    firstItem.orderNo,
    undefined,
    { numeric: true, sensitivity: "base" }
  );

  if (orderDifference !== 0) return orderDifference;

  return firstItem.sku.localeCompare(secondItem.sku, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function todayInDubai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function UaeDispatchPage() {
  const [items, setItems] = useState<DispatchItem[]>([]);
  const [baseName, setBaseName] = useState("");
  const [tableName, setTableName] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [nextOffset, setNextOffset] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDispatchDate, setBulkDispatchDate] = useState(todayInDubai);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    label: string;
  } | null>(null);
  const [draft, setDraft] = useState<Draft>({
    dispatchedFromUae: "",
    dispatchDate: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [capabilities, setCapabilities] = useState({
    hasDispatchedField: true,
    hasDispatchDateField: true,
  });

  const loadItems = useCallback(
    async (offset = "", append = false) => {
      append ? setLoadingMore(true) : setLoading(true);
      setError("");
      setMessage("");

      try {
        const params = new URLSearchParams({
          pageSize: "100",
        });

        if (offset) params.set("offset", offset);
        if (appliedQuery) params.set("q", appliedQuery);

        const response = await fetch(
          `/api/orders/uae-dispatch?${params.toString()}`,
          { cache: "no-store" }
        );
        const data = await response.json();

        if (response.status === 403) {
          setAccessDenied(true);
          throw new Error(data.message || "Access denied");
        }

        setAccessDenied(false);

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to load UAE dispatch items");
        }

        const incoming = Array.isArray(data.items)
          ? [...data.items].sort(compareOrderNumbersDescending)
          : [];

        if (!append) {
          setSelectedIds([]);
        }

        setItems((current) => {
          if (!append) return incoming;

          const merged = [...current, ...incoming];
          return Array.from(
            new Map(merged.map((item) => [item.id, item])).values()
          ).sort(compareOrderNumbersDescending);
        });

        setBaseName(String(data.baseName || ""));
        setTableName(String(data.tableName || ""));
        setNextOffset(String(data.nextOffset || ""));
        setCapabilities(
          data.capabilities || {
            hasDispatchedField: true,
            hasDispatchDateField: true,
          }
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load UAE dispatch items"
        );

        if (!append) {
          setItems([]);
          setNextOffset("");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [appliedQuery]
  );

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  function startEdit(item: DispatchItem) {
    setMessage("");
    setError("");
    setEditingId(item.id);
    setDraft({
      dispatchedFromUae: normalizeYes(item.dispatchedFromUae) ? "Yes" : "",
      dispatchDate: item.dispatchDate || "",
    });
  }

  function cancelEdit() {
    setEditingId("");
    setDraft({
      dispatchedFromUae: "",
      dispatchDate: "",
    });
  }

  function markYesToday() {
    setDraft({
      dispatchedFromUae: "Yes",
      dispatchDate: todayInDubai(),
    });
  }

  async function saveRow(item: DispatchItem) {
    if (draft.dispatchedFromUae === "Yes" && !draft.dispatchDate) {
      setError("Dispatch Date is required when Dispatched From UAE is Yes.");
      return;
    }

    setSavingId(item.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/orders/uae-dispatch", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recordId: item.id,
          dispatchedFromUae: draft.dispatchedFromUae,
          dispatchDate: draft.dispatchDate,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "UAE dispatch update failed");
      }

      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                dispatchedFromUae: draft.dispatchedFromUae,
                dispatchDate: draft.dispatchDate,
              }
            : row
        )
      );

      setEditingId("");
      setDraft({
        dispatchedFromUae: "",
        dispatchDate: "",
      });
      setMessage(`${item.sku || "Order item"} updated successfully.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "UAE dispatch update failed"
      );
    } finally {
      setSavingId("");
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((itemId) => itemId !== id)
        : [...current, id]
    );
  }

  function toggleAllVisible() {
    const visibleIds = items.map((item) => item.id);
    const allVisibleSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => selectedIds.includes(id));

    setSelectedIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function bulkMarkDispatched() {
    if (selectedIds.length === 0) {
      setError("Select at least one item line.");
      return;
    }

    if (!bulkDispatchDate) {
      setError("Dispatch Date is required for bulk update.");
      return;
    }

    const confirmed = window.confirm(
      `Mark ${selectedIds.length} selected item line(s) as Dispatched From UAE = Yes on ${bulkDispatchDate}?`
    );

    if (!confirmed) return;

    setBulkSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/orders/uae-dispatch", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recordIds: selectedIds,
          dispatchedFromUae: "Yes",
          dispatchDate: bulkDispatchDate,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Bulk UAE dispatch update failed");
      }

      const updatedIdSet = new Set(selectedIds);

      setItems((current) =>
        current.map((item) =>
          updatedIdSet.has(item.id)
            ? {
                ...item,
                dispatchedFromUae: "Yes",
                dispatchDate: bulkDispatchDate,
              }
            : item
        )
      );

      setSelectedIds([]);
      setMessage(
        `${data.updatedRecords || updatedIdSet.size} item line(s) updated successfully.`
      );
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : "Bulk UAE dispatch update failed"
      );
    } finally {
      setBulkSaving(false);
    }
  }

  if (accessDenied) {
    return (
      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-red-800">Access Denied</h1>
          <p className="mt-2 text-sm font-bold text-red-700">
            Supplier accounts cannot access UAE Dispatch Update.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-950">
            UAE Dispatch Update
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {baseName || "Current base"} · {tableName || "Order Entry"}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-400">
            Update Dispatched From UAE and Dispatch Date without opening the full order.
          </p>
        </div>

        <form
          className="flex w-full max-w-xl gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedQuery(query.trim());
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search order no, SKU, supplier or bill no..."
            className="h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 text-sm font-bold outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="h-12 rounded-xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setAppliedQuery("");
            }}
            className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            Clear
          </button>
        </form>
      </div>

      {!capabilities.hasDispatchedField ||
      !capabilities.hasDispatchDateField ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          {!capabilities.hasDispatchedField &&
            "Dispatched From UAE field was not found in this Order Entry table. "}
          {!capabilities.hasDispatchDateField &&
            "Dispatch Date field was not found in this Order Entry table."}
        </div>
      ) : null}

      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black text-blue-900">
            Bulk Dispatch: {selectedIds.length} selected
          </p>
          <p className="mt-1 text-xs font-bold text-blue-700">
            Selected rows will be marked Dispatched From UAE = Yes.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-black uppercase tracking-wide text-blue-700">
              Dispatch Date
            </label>
            <input
              type="date"
              value={bulkDispatchDate}
              onChange={(event) => setBulkDispatchDate(event.target.value)}
              disabled={bulkSaving || Boolean(savingId)}
              className="h-11 rounded-xl border border-blue-300 bg-white px-3 font-bold outline-none focus:border-blue-600 disabled:opacity-50"
            />
          </div>

          <button
            type="button"
            onClick={() => setBulkDispatchDate(todayInDubai())}
            disabled={bulkSaving || Boolean(savingId)}
            className="h-11 rounded-xl border border-violet-300 bg-violet-50 px-4 text-sm font-black text-violet-700 hover:bg-violet-100 disabled:opacity-50"
          >
            Today
          </button>

          <button
            type="button"
            onClick={bulkMarkDispatched}
            disabled={
              selectedIds.length === 0 ||
              !bulkDispatchDate ||
              bulkSaving ||
              Boolean(savingId) ||
              !capabilities.hasDispatchedField ||
              !capabilities.hasDispatchDateField
            }
            className="h-11 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {bulkSaving ? "Updating..." : "✓ Mark Selected Dispatched"}
          </button>

          <button
            type="button"
            onClick={() => setSelectedIds([])}
            disabled={selectedIds.length === 0 || bulkSaving}
            className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            Clear Selection
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">Order Items</h2>
            <p className="text-xs font-bold text-slate-500">
              Showing {items.length} item line(s)
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadItems()}
            disabled={loading || Boolean(savingId) || bulkSaving}
            className="h-10 rounded-xl border border-blue-300 bg-blue-50 px-4 text-sm font-black text-blue-700 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto">
          <table className="w-full min-w-[1320px] text-sm">
            <thead className="sticky top-0 z-20 bg-slate-200 text-slate-900 shadow-sm">
              <tr>
                <th className="w-[58px] px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    checked={
                      items.length > 0 &&
                      items.every((item) => selectedIds.includes(item.id))
                    }
                    onChange={toggleAllVisible}
                    disabled={loading || bulkSaving || Boolean(savingId)}
                    aria-label="Select all visible item lines"
                  />
                </th>
                <th className="w-[92px] px-4 py-4 text-left">Image</th>
                <th className="px-4 py-4 text-left">Order No</th>
                <th className="px-4 py-4 text-left">SKU</th>
                <th className="px-4 py-4 text-center">Qty</th>
                <th className="px-4 py-4 text-left">Supplier</th>
                <th className="px-4 py-4 text-left">Bill No</th>
                <th className="px-4 py-4 text-left">Order Status</th>
                <th className="px-4 py-4 text-left">Dispatched From UAE</th>
                <th className="px-4 py-4 text-left">Dispatch Date</th>
                <th className="px-4 py-4 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {items.map((item, index) => {
                const editing = editingId === item.id;
                const dispatched = normalizeYes(item.dispatchedFromUae);

                return (
                  <tr
                    key={item.id}
                    className={`border-t ${
                      index % 2 === 0 ? "bg-white" : "bg-slate-50"
                    } hover:bg-blue-50`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        disabled={bulkSaving || Boolean(savingId)}
                        aria-label={`Select ${item.sku || item.orderNo || "item line"}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {item.imageUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewImage({
                              url: item.imageUrl,
                              label: item.sku || item.orderNo || "Product image",
                            })
                          }
                          className="block h-16 w-14 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:scale-105 hover:border-blue-400"
                          title="View larger image"
                          aria-label={`View image for ${item.sku || item.orderNo || "item"}`}
                        >
                          <img
                            src={item.imageThumbnailUrl || item.imageUrl}
                            alt={item.sku || "Product"}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="flex h-16 w-14 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xl text-slate-400">
                          ◫
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-black text-slate-900">
                      {item.orderNo || "-"}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700">
                      {item.sku || "-"}
                    </td>
                    <td className="px-4 py-3 text-center font-black text-slate-900">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700">
                      {item.supplier || "-"}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700">
                      {item.billNo || "-"}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-600">
                      {item.orderStatus || "-"}
                    </td>

                    <td className="px-4 py-3">
                      {editing ? (
                        <select
                          value={draft.dispatchedFromUae}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              dispatchedFromUae: event.target.value,
                            }))
                          }
                          disabled={savingId === item.id}
                          className="h-10 min-w-36 rounded-xl border border-blue-300 bg-white px-3 font-bold outline-none focus:border-blue-600"
                        >
                          <option value="">Blank</option>
                          <option value="Yes">Yes</option>
                        </select>
                      ) : (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${
                            dispatched
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {dispatched ? "Yes" : "Not Dispatched"}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {editing ? (
                        <input
                          type="date"
                          value={draft.dispatchDate}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              dispatchDate: event.target.value,
                            }))
                          }
                          disabled={savingId === item.id}
                          className="h-10 rounded-xl border border-blue-300 bg-white px-3 font-bold outline-none focus:border-blue-600"
                        />
                      ) : (
                        <span className="font-bold text-slate-700">
                          {item.dispatchDate || "-"}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-nowrap justify-end gap-2">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={markYesToday}
                              disabled={savingId === item.id}
                              title="Set Yes and today's UAE date"
                              aria-label="Set Yes and today's UAE date"
                              className="inline-flex h-9 items-center justify-center rounded-lg border border-violet-300 bg-violet-50 px-3 text-xs font-black text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                            >
                              Yes + Today
                            </button>
                            <button
                              type="button"
                              onClick={() => saveRow(item)}
                              disabled={savingId === item.id}
                              title="Save"
                              aria-label="Save UAE dispatch update"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-base font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {savingId === item.id ? "…" : "✓"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={savingId === item.id}
                              title="Cancel"
                              aria-label="Cancel editing"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            disabled={
                              Boolean(savingId) ||
                              bulkSaving ||
                              !capabilities.hasDispatchedField ||
                              !capabilities.hasDispatchDateField
                            }
                            title="Edit UAE dispatch"
                            aria-label="Edit UAE dispatch"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 text-base font-black text-white hover:bg-blue-700 disabled:opacity-40"
                          >
                            ✏
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && items.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-4 py-12 text-center font-bold text-slate-500"
                  >
                    No order items found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-4 py-12 text-center font-black text-blue-600"
                  >
                    Loading UAE dispatch items...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {nextOffset && (
          <div className="flex justify-center border-t border-slate-200 p-5">
            <button
              type="button"
              onClick={() => loadItems(nextOffset, true)}
              disabled={loadingMore}
              className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-black text-white disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          </div>
        )}
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={previewImage.label}
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-h-[92vh] max-w-4xl overflow-hidden rounded-3xl bg-white p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/80 text-xl font-black text-white hover:bg-slate-950"
              aria-label="Close image preview"
              title="Close"
            >
              ✕
            </button>
            <img
              src={previewImage.url}
              alt={previewImage.label}
              className="max-h-[86vh] max-w-full rounded-2xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
