"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  orderNo: string;
  sku: string;
  image: Array<{ url?: string; thumbnails?: { small?: { url?: string } } }>;
  quantity: number;
  supplier: string;
  supplierCode: string;
  billNo: string;
  dispatchedFromIndia: string | boolean;
  receivedInUae: string | boolean;
  soldOut: string | boolean;
  date: string;
  status: string;
  store: string;
};

type EditableField = {
  key: keyof Item;
  airtableName: string;
  type: string;
  choices: string[];
};

type OrderSuggestion = {
  id: string;
  orderNo: string;
  customer: string;
};

function imageUrl(item: Item) {
  return item.image?.[0]?.thumbnails?.small?.url || item.image?.[0]?.url || "";
}

function yesNo(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "";
  return String(value || "");
}

function isReceivedInUae(value: unknown) {
  if (value === true) return true;

  return ["yes", "true", "1", "received"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

export default function OrdersQuickEditPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [editableFields, setEditableFields] = useState<EditableField[]>([]);
  const [baseName, setBaseName] = useState("");
  const [tableName, setTableName] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<Partial<Item>>({});
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [orderSuggestions, setOrderSuggestions] = useState<OrderSuggestion[]>([]);
  const [orderSearchLoading, setOrderSearchLoading] = useState(false);
  const [orderDropdownOpen, setOrderDropdownOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  const loadItems = useCallback(async (offset = "", append = false) => {
    try {
      append ? setLoadingMore(true) : setLoading(true);
      setError("");
      const params = new URLSearchParams({
        pageSize: append ? "100" : "300",
      });
      if (offset) params.set("offset", offset);
      if (appliedQuery) params.set("q", appliedQuery);
      const response = await fetch(`/api/orders/quick-edit?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (response.status === 403) {
        setAccessDenied(true);
        throw new Error(data.message || "Access denied");
      }
      setAccessDenied(false);
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to load order items");
      setItems((current) => (append ? [...current, ...(data.items || [])] : data.items || []));
      setEditableFields(data.editableFields || []);
      setBaseName(data.baseName || "");
      setTableName(data.tableName || "");
      setNextOffset(data.nextOffset || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load order items");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [appliedQuery]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!editingId) {
      setOrderSuggestions([]);
      setOrderDropdownOpen(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const searchText = String(draft.orderNo ?? "").trim();

    if (!searchText) {
      setOrderSuggestions([]);
      setOrderDropdownOpen(false);
      setActiveSuggestionIndex(-1);
      setOrderSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setOrderSearchLoading(true);

        const response = await fetch(
          `/api/orders/quick-edit/search-orders?q=${encodeURIComponent(searchText)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to search orders");
        }

        const results = Array.isArray(data.results) ? data.results : [];
        setOrderSuggestions(results);
        setOrderDropdownOpen(true);
        setActiveSuggestionIndex(results.length ? 0 : -1);
      } catch (searchError) {
        if (searchError instanceof DOMException && searchError.name === "AbortError") {
          return;
        }

        setOrderSuggestions([]);
        setOrderDropdownOpen(true);
        setActiveSuggestionIndex(-1);
      } finally {
        if (!controller.signal.aborted) {
          setOrderSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.orderNo, editingId]);

  const fieldMap = useMemo(
    () => new Map(editableFields.map((field) => [field.key, field])),
    [editableFields]
  );

  function startEdit(item: Item) {
    setMessage("");
    setOrderSuggestions([]);
    setOrderDropdownOpen(false);
    setActiveSuggestionIndex(-1);
    setEditingId(item.id);
    setDraft({
      orderNo: item.orderNo,
      quantity: item.quantity,
      supplier: item.supplier,
      billNo: item.billNo,
      dispatchedFromIndia: item.dispatchedFromIndia,
      receivedInUae: item.receivedInUae,
      soldOut: item.soldOut,
    });
  }

  function cancelEdit() {
    setEditingId("");
    setDraft({});
    setOrderSuggestions([]);
    setOrderDropdownOpen(false);
    setActiveSuggestionIndex(-1);
  }

  function selectOrderSuggestion(suggestion: OrderSuggestion) {
    setDraft((current) => ({
      ...current,
      orderNo: suggestion.orderNo,
    }));
    setOrderDropdownOpen(false);
    setActiveSuggestionIndex(-1);
  }

  async function saveRow(item: Item) {
    try {
      setSavingId(item.id);
      setError("");
      setMessage("");
      const changes: Record<string, unknown> = {};
      for (const field of editableFields) {
        const key = field.key;
        if (key in draft) changes[key] = draft[key];
      }
      const response = await fetch("/api/orders/quick-edit/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: item.id, changes }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Update failed");
      const updatedOrderNo = String(draft.orderNo ?? item.orderNo).trim();
      setItems((current) =>
        updatedOrderNo
          ? current.map((row) => (row.id === item.id ? ({ ...row, ...draft } as Item) : row))
          : current.filter((row) => row.id !== item.id)
      );
      setEditingId("");
      setDraft({});
      setMessage(
        updatedOrderNo
          ? `${item.sku || "Order item"} moved/updated successfully.`
          : `${item.sku || "Order item"} removed from the order successfully.`
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Update failed");
    } finally {
      setSavingId("");
    }
  }

  function renderEditor(key: keyof Item, value: unknown) {
    const field = fieldMap.get(key);
    if (!field) return <span>{yesNo(value) || "—"}</span>;

    if (key === "orderNo") {
      return (
        <div className="relative min-w-64">
          <input
            type="text"
            value={String(draft.orderNo ?? "")}
            onFocus={() => {
              if (String(draft.orderNo ?? "").trim()) {
                setOrderDropdownOpen(true);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => setOrderDropdownOpen(false), 150);
            }}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                orderNo: event.target.value,
              }));
              setOrderDropdownOpen(true);
            }}
            onKeyDown={(event) => {
              if (!orderDropdownOpen) return;

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestionIndex((current) =>
                  orderSuggestions.length
                    ? (current + 1) % orderSuggestions.length
                    : -1
                );
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestionIndex((current) =>
                  orderSuggestions.length
                    ? (current <= 0 ? orderSuggestions.length - 1 : current - 1)
                    : -1
                );
              }

              if (event.key === "Enter" && activeSuggestionIndex >= 0) {
                event.preventDefault();
                const selected = orderSuggestions[activeSuggestionIndex];
                if (selected) selectOrderSuggestion(selected);
              }

              if (event.key === "Escape") {
                setOrderDropdownOpen(false);
                setActiveSuggestionIndex(-1);
              }
            }}
            placeholder="Search order number or customer..."
            autoComplete="off"
            className="w-full rounded border border-slate-300 px-2 py-1.5 pr-8 text-sm"
          />

          {orderSearchLoading && (
            <span className="absolute right-2 top-2 text-xs text-slate-400">
              ...
            </span>
          )}

          {orderDropdownOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-[360px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
              {orderSearchLoading ? (
                <div className="px-3 py-3 text-sm text-slate-500">
                  Searching orders...
                </div>
              ) : orderSuggestions.length ? (
                orderSuggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOrderSuggestion(suggestion)}
                    className={[
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                      index === activeSuggestionIndex
                        ? "bg-emerald-50 text-emerald-800"
                        : "hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span className="font-semibold">{suggestion.orderNo}</span>
                    <span className="truncate text-xs text-slate-500">
                      {suggestion.customer || "Customer name unavailable"}
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-sm text-slate-500">
                  No matching order found.
                </div>
              )}
            </div>
          )}

          <p className="mt-1 text-[11px] text-slate-500">
            Blank save karne se item current order se remove hoga.
          </p>
        </div>
      );
    }

    if (field.type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={Boolean(draft[key])}
          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))}
          className="h-4 w-4"
        />
      );
    }

    if (field.type === "singleSelect") {
      return (
        <select
          value={String(draft[key] ?? "")}
          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
          className="min-w-28 rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Blank</option>
          {field.choices.map((choice) => (
            <option key={choice} value={choice}>{choice}</option>
          ))}
        </select>
      );
    }

    return (
      <input
        type={field.type === "number" ? "number" : "text"}
        value={String(draft[key] ?? "")}
        onChange={(event) => setDraft((current) => ({
          ...current,
          [key]: field.type === "number" ? Number(event.target.value) : event.target.value,
        }))}
        className="min-w-24 rounded border border-slate-300 px-2 py-1 text-sm"
      />
    );
  }

  if (accessDenied) {
    return (
      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-red-800">Access Denied</h1>
          <p className="mt-2 text-sm text-red-700">Supplier accounts cannot access Order Items Quick Edit.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Order Items Quick Edit</h1>
          <p className="text-sm text-slate-500">{baseName || "Current base"} · {tableName || "Order Entry"}</p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedQuery(query.trim());
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Order, SKU, supplier, bill no..."
            className="w-full min-w-0 rounded-lg border px-3 py-2 text-sm md:w-80"
          />
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Search</button>
          <button
            type="button"
            onClick={() => { setQuery(""); setAppliedQuery(""); }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            Clear
          </button>
        </form>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1280px] w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-3">Image</th><th className="px-3 py-3">Order</th><th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">SKU</th><th className="px-3 py-3">Qty</th><th className="px-3 py-3">Supplier</th>
                <th className="px-3 py-3">Supplier Code</th><th className="px-3 py-3">Bill No.</th>
                <th className="px-3 py-3">Dispatched from India</th><th className="px-3 py-3">Received in UAE</th>
                <th className="px-3 py-3">Sold Out</th><th className="px-3 py-3">Status</th>
                <th className="sticky right-0 bg-slate-100 px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-slate-500">Loading order items...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-slate-500">No order items found.</td></tr>
              ) : items.map((item) => {
                const editing = editingId === item.id;
                const src = imageUrl(item);
                const receivedInUae = isReceivedInUae(
                  editing
                    ? draft.receivedInUae ?? item.receivedInUae
                    : item.receivedInUae,
                );
                const rowBackground = receivedInUae
                  ? ""
                  : editing
                    ? "bg-amber-50"
                    : "hover:bg-slate-50";
                return (
                  <tr
                    key={item.id}
                    style={
                      receivedInUae
                        ? { backgroundColor: "#90ee90" }
                        : undefined
                    }
                    className={`${rowBackground} ${
                      editing
                        ? "ring-2 ring-inset ring-amber-300"
                        : ""
                    } transition-colors`}
                  >
                    <td className="px-3 py-2">{src ? <img src={src} alt={item.sku} className="h-12 w-12 rounded object-cover" /> : <div className="h-12 w-12 rounded bg-slate-100" />}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {editing ? renderEditor("orderNo", item.orderNo) : item.orderNo || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{item.date || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{item.sku || "—"}</td>
                    <td className="px-3 py-2">{editing ? renderEditor("quantity", item.quantity) : item.quantity}</td>
                    <td className="px-3 py-2">{editing ? renderEditor("supplier", item.supplier) : item.supplier || "—"}</td>
                    <td className="px-3 py-2">{item.supplierCode || "—"}</td>
                    <td className="px-3 py-2">{editing ? renderEditor("billNo", item.billNo) : item.billNo || "—"}</td>
                    <td className="px-3 py-2">
                      {editing
                        ? renderEditor(
                            "dispatchedFromIndia",
                            item.dispatchedFromIndia,
                          )
                        : yesNo(item.dispatchedFromIndia) || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {editing
                        ? renderEditor(
                            "receivedInUae",
                            item.receivedInUae,
                          )
                        : yesNo(item.receivedInUae) || "—"}
                    </td>
                    <td className="px-3 py-2">{editing ? renderEditor("soldOut", item.soldOut) : yesNo(item.soldOut) || "—"}</td>
                    <td className="px-3 py-2">{item.status || "—"}</td>
                    <td
                      style={
                        receivedInUae
                          ? { backgroundColor: "#90ee90" }
                          : undefined
                      }
                      className={`sticky right-0 px-3 py-2 ${
                        receivedInUae
                          ? ""
                          : editing
                            ? "bg-amber-50"
                            : "bg-white"
                      }`}
                    >
                      {editing ? (
                        <div className="flex gap-2">
                          <button onClick={() => saveRow(item)} disabled={savingId === item.id} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{savingId === item.id ? "Saving..." : "Save"}</button>
                          <button onClick={cancelEdit} disabled={savingId === item.id} className="rounded border px-3 py-1.5 text-xs">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(item)} disabled={Boolean(editingId)} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Edit</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {nextOffset && (
          <div className="border-t p-4 text-center">
            <button onClick={() => loadItems(nextOffset, true)} disabled={loadingMore || Boolean(editingId)} className="rounded-lg border bg-white px-5 py-2 text-sm font-medium disabled:opacity-50">{loadingMore ? "Loading..." : "Load More"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
