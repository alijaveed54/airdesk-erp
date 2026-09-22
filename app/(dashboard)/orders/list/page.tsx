"use client";

import OrderDetailsModal from "@/components/orders/OrderDetailsModal";
import type { OrderRecord } from "@/types/order";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Filters = {
  customer: string;
  phone: string;
  store: string;
  status: string;
  courier: string;
  dateFrom: string;
  dateTo: string;
};

type InlineDraft = {
  status: string;
  courier: string;
};

type ReadyProcessReportOrder = {
  orderNo: string;
  formatted: string;
};

type ReadyProcessReportResponse = {
  success: boolean;
  message?: string;
  orders?: ReadyProcessReportOrder[];
};

type ReadyProcessActionResponse = {
  success: boolean;
  message?: string;
  processedOrderNos?: string[];
  skippedOrderNos?: string[];
};

function getCustomerName(order: OrderRecord) {
  return order.fields.Consignee?.[0] ?? "-";
}

function getPhone(order: OrderRecord) {
  return order.fields.Telephone1 ?? "-";
}

function getOrderNo(order: OrderRecord) {
  return order.fields["order_no."] ?? "-";
}

function getCourierStatus(order: OrderRecord) {
  const fields = order.fields as Record<string, unknown>;
  const value = fields.__courierStatus;
  const resolved = Array.isArray(value) ? value[0] : value;

  // Direct source from /api/orders/list:
  // Airtable TFM Status -> __courierStatus -> badge.
  // No second API call and no Order Status fallback.
  return String(resolved ?? "").trim();
}

function getCourierStatusBadgeClass(status: string) {
  const normalized = status.trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized.includes("delivered")) {
    return "border-emerald-200 bg-emerald-100 text-emerald-800";
  }

  if (
    normalized === "ofd" ||
    normalized.includes("out for delivery") ||
    normalized.includes("out-for-delivery")
  ) {
    return "border-violet-200 bg-violet-100 text-violet-800";
  }

  if (
    normalized.includes("returned") ||
    normalized.includes("return to origin") ||
    normalized === "rto"
  ) {
    return "border-red-200 bg-red-100 text-red-800";
  }

  if (normalized.includes("cancel")) {
    return "border-slate-300 bg-slate-200 text-slate-800";
  }

  if (
    normalized.includes("hold") ||
    normalized.includes("failed") ||
    normalized.includes("exception")
  ) {
    return "border-amber-200 bg-amber-100 text-amber-800";
  }

  return "border-blue-200 bg-blue-100 text-blue-800";
}

function getStore(order: OrderRecord) {
  return order.fields["Select Store"] ?? "-";
}

function getTotal(order: OrderRecord) {
  return Number(order.fields.total_order_value ?? 0);
}

function getCurrency(order: OrderRecord) {
  return String(order.fields.__currency || "AED");
}

function getSource(order: OrderRecord) {
  return String(order.fields.__source || "");
}

function getRowCapability(
  order: OrderRecord,
  field: "__canUpdateStatus" | "__canUpdateCourier",
  fallback: boolean
) {
  const value = (order.fields as Record<string, unknown>)[field];
  return typeof value === "boolean" ? value : fallback;
}

function getRowOptions(
  order: OrderRecord,
  field: "__statusOptions" | "__courierOptions",
  fallback: string[]
) {
  const value = (order.fields as Record<string, unknown>)[field];

  if (!Array.isArray(value)) return fallback;

  const options = value
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return options.length > 0 ? options : fallback;
}

function getInStockStatus(order: OrderRecord) {
  const value = (order.fields as Record<string, unknown>).Instock;
  return String(Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();
}

function isReadyFullInStockOrder(order: OrderRecord) {
  const fields = order.fields as Record<string, unknown>;

  const orderStatus =
    String(order.fields.order_status || "")
      .trim()
      .toLowerCase();

  const isOrderReceived =
    orderStatus === "order received";

  // UPDATED BS READY RULE:
  // Item is considered ready if available in WH OR Received in UAE.
  // Bill Number must be blank.
  // Order Status must be Order Received.

  const updatedRule =
    fields.__allItemsWhOrUaeReadyBillBlank;

  if (typeof updatedRule === "boolean") {
    return updatedRule && isOrderReceived;
  }

  // Backward compatibility with old backend rule
  const oldRule =
    fields.__allItemsWhYesBillBlank;

  if (typeof oldRule === "boolean") {
    return oldRule && isOrderReceived;
  }

  const inStockIsFull =
    getInStockStatus(order).toLowerCase() === "full";

  return (
    inStockIsFull &&
    isOrderReceived
  );
}

function isPartialInStockOrder(order: OrderRecord) {
  const inStockStatus = getInStockStatus(order).toLowerCase();
  return inStockStatus === "partial" || inStockStatus === "partially";
}


function getReadyProcessStatus(
  order: OrderRecord
): "green" | "orange" | "" {
  const value = (
    order.fields as Record<
      string,
      unknown
    >
  ).__readyProcessStatus;

  const normalized = String(
    value || ""
  )
    .trim()
    .toLowerCase();

  if (normalized === "green") {
    return "green";
  }

  if (normalized === "orange") {
    return "orange";
  }

  return "";
}

function getReadyProcessCounts(
  order: OrderRecord
) {
  const value = (
    order.fields as Record<
      string,
      unknown
    >
  ).__readyProcessCounts;

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const counts =
    value as Record<string, unknown>;

  return {
    totalItems: Number(
      counts.totalItems || 0
    ),
    inStockItems: Number(
      counts.inStockItems || 0
    ),
    receivedItems: Number(
      counts.receivedItems || 0
    ),
    soldOutItems: Number(
      counts.soldOutItems || 0
    ),
  };
}

function getOrderProcessingPriority(
  order: OrderRecord
) {
  if (
    isReadyFullInStockOrder(order)
  ) {
    return 0;
  }

  const readyStatus =
    getReadyProcessStatus(order);

  if (readyStatus === "green") {
    return 1;
  }

  if (readyStatus === "orange") {
    return 2;
  }

  return 3;
}

function getReadyProcessTitle(
  order: OrderRecord
) {
  const counts =
    getReadyProcessCounts(order);

  if (!counts) {
    return "";
  }

  return [
    `Total: ${counts.totalItems}`,
    `In stock: ${counts.inStockItems}`,
    `Received UAE: ${counts.receivedItems}`,
    `Sold out: ${counts.soldOutItems}`,
  ].join(" • ");
}

function isReturnOrder(order: OrderRecord) {
  const fields = order.fields as Record<string, unknown>;

  const replacementValue =
    fields.Replacement ??
    fields["Replacement Order"] ??
    fields["Is Replacement"] ??
    fields["replacement"];

  if (Array.isArray(replacementValue)) {
    return replacementValue.some((value) => {
      const normalized = String(value).trim().toLowerCase();
      return normalized === "true" || normalized === "yes" || normalized === "checked" || normalized === "1";
    });
  }

  if (typeof replacementValue === "boolean") {
    return replacementValue;
  }

  const normalized = String(replacementValue ?? "").trim().toLowerCase();

  return (
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "checked" ||
    normalized === "1"
  );
}

function getOrderDate(order: OrderRecord) {
  return order.fields.date
    ? new Date(order.fields.date).toLocaleDateString("en-GB")
    : "-";
}

const emptyFilters: Filters = {
  customer: "",
  phone: "",
  store: "",
  status: "",
  courier: "",
  dateFrom: "",
  dateTo: "",
};

export default function OrdersListPage() {
  const router = useRouter();

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [courierOptions, setCourierOptions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [editingOrderId, setEditingOrderId] = useState("");
  const [inlineDraft, setInlineDraft] = useState<InlineDraft>({
    status: "",
    courier: "",
  });
  const [nextOffset, setNextOffset] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [bulkCourier, setBulkCourier] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [downloadingDriverSheet, setDownloadingDriverSheet] = useState(false);
  const [downloadingCourierFiles, setDownloadingCourierFiles] = useState(false);
  const [processingReadyOrderId, setProcessingReadyOrderId] = useState("");
  const [bulkProcessingReady, setBulkProcessingReady] = useState(false);
  const [copyingSelectedReady, setCopyingSelectedReady] = useState(false);
  const [baseName, setBaseName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [movingOrderId, setMovingOrderId] = useState("");
  const [movedOrderIds, setMovedOrderIds] = useState<string[]>([]);
  const [deletingOrderId, setDeletingOrderId] = useState("");
  const [capabilities, setCapabilities] = useState({
    hasStore: true,
    hasStatus: true,
    hasCourier: true,
    canUpdateStatus: true,
    canUpdateCourier: true,
  });

  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await response.json();

        if (response.ok && data.success) {
          setUserRole(String(data.user?.role || data.role || ""));
        } else {
          setUserRole("");
        }
      } catch {
        setUserRole("");
      }
    }

    loadCurrentUser();
  }, []);

  useEffect(() => {
    async function loadOrders() {
      setLoading(true);

      const params = new URLSearchParams();

      if (appliedSearch.trim()) {
        params.set("q", appliedSearch.trim());
      }

      Object.entries(appliedFilters).forEach(([key, value]) => {
        if (value.trim()) {
          params.set(key, value.trim());
        }
      });

      const query = params.toString();
      const res = await fetch(`/api/orders/list${query ? `?${query}` : ""}`);
      const data = await res.json();

      if (res.ok && data.success) {
        setOrders(data.records || []);
        setNextOffset(data.nextOffset || "");
        setSelectedRows([]);
        setStatusOptions(data.statusOptions || []);
        setCourierOptions(data.courierOptions || []);
        setBaseName(data.baseName || "");
        setCapabilities(
          data.capabilities || {
            hasStore: true,
            hasStatus: true,
            hasCourier: true,
            canUpdateStatus: true,
            canUpdateCourier: true,
          }
        );
      } else {
        setOrders([]);
        setNextOffset("");
      }

      setLoading(false);
    }

    loadOrders();
  }, [appliedSearch, appliedFilters]);

  function startInlineEdit(order: OrderRecord) {
    setEditingOrderId(order.id);
    setInlineDraft({
      status: String(order.fields.order_status || ""),
      courier: String(order.fields.Courier || ""),
    });
  }

  function cancelInlineEdit() {
    if (savingKey) return;

    setEditingOrderId("");
    setInlineDraft({
      status: "",
      courier: "",
    });
  }

  async function saveInlineEdit(order: OrderRecord) {
    const currentStatus = String(order.fields.order_status || "");
    const currentCourier = String(order.fields.Courier || "");

    const rowCanUpdateStatus = getRowCapability(
      order,
      "__canUpdateStatus",
      capabilities.canUpdateStatus
    );
    const rowCanUpdateCourier = getRowCapability(
      order,
      "__canUpdateCourier",
      capabilities.canUpdateCourier
    );

    const statusChanged =
      rowCanUpdateStatus &&
      inlineDraft.status !== currentStatus;

    const courierChanged =
      rowCanUpdateCourier &&
      inlineDraft.courier !== currentCourier;

    if (!statusChanged && !courierChanged) {
      cancelInlineEdit();
      return;
    }

    const tableName = String(
      (order.fields as Record<string, unknown>).__tableName || ""
    ).trim();

    if (!tableName) {
      alert("Source table was not found for this order.");
      return;
    }

    const savingId = `${order.id}-inline`;
    setSavingKey(savingId);

    try {
      const response = await fetch("/api/orders/list", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: order.id,
          tableName,
          ...(statusChanged ? { status: inlineDraft.status } : {}),
          ...(courierChanged ? { courier: inlineDraft.courier } : {}),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        alert(data?.message || "Inline update failed");
        return;
      }

      setOrders((previous) =>
        previous.map((item) =>
          item.id === order.id
            ? {
                ...item,
                fields: {
                  ...item.fields,
                  ...(statusChanged
                    ? { order_status: inlineDraft.status }
                    : {}),
                  ...(courierChanged
                    ? { Courier: inlineDraft.courier }
                    : {}),
                },
              }
            : item
        )
      );

      setEditingOrderId("");
      setInlineDraft({
        status: "",
        courier: "",
      });
    } catch {
      alert("Inline update failed");
    } finally {
      setSavingKey("");
    }
  }

  function applyFilters() {
    setAppliedSearch(search);
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setSearch("");
    setAppliedSearch("");
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setNextOffset("");
    setSelectedRows([]);
  }

  async function loadMoreOrders() {
    if (!nextOffset || loadingMore) return;

    setLoadingMore(true);

    const params = new URLSearchParams();
    params.set("offset", nextOffset);

    if (appliedSearch.trim()) {
      params.set("q", appliedSearch.trim());
    }

    Object.entries(appliedFilters).forEach(([key, value]) => {
      if (value.trim()) {
        params.set(key, value.trim());
      }
    });

    const res = await fetch(`/api/orders/list?${params.toString()}`);
    const data = await res.json();

    if (res.ok && data.success) {
      setOrders((prev) => {
        const merged = [...prev, ...(data.records || [])];
        const uniqueOrders = new Map(
          merged.map((order) => [order.id, order])
        );

        return Array.from(uniqueOrders.values());
      });
      setNextOffset(data.nextOffset || "");
    }

    setLoadingMore(false);
  }

  function toggleRow(id: string) {
    setSelectedRows((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function toggleAllRows() {
    if (selectedRows.length === orders.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(orders.map((order) => order.id));
    }
  }

  async function bulkUpdateCourier() {
    if (selectedRows.length === 0) {
      alert("Please select at least one order.");
      return;
    }

    if (!bulkCourier) {
      alert("Please select courier.");
      return;
    }

    setBulkSaving(true);

    const res = await fetch("/api/orders/bulk-update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "courier",
        orderIds: selectedRows,
        courier: bulkCourier,
      }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      setOrders((prev) =>
        prev.map((order) =>
          selectedRows.includes(order.id)
            ? { ...order, fields: { ...order.fields, Courier: bulkCourier } }
            : order
        )
      );
      alert(`Courier updated: ${data.updated || 0}`);
    } else {
      alert(data.message || "Bulk courier update failed");
    }

    setBulkSaving(false);
  }

  async function dispatchReadyOrders() {
    const dispatchIds = orders
      .filter((order) => {
        const status = String(order.fields.order_status || "").toLowerCase();
        const courier = String(order.fields.Courier || "").trim();

        return status === "order received" && courier;
      })
      .map((order) => order.id);

    if (dispatchIds.length === 0) {
      alert("No ready orders found. Status must be Order Received and Courier must not be empty.");
      return;
    }

    if (!confirm(`Dispatch ${dispatchIds.length} ready orders?`)) return;

    setBulkSaving(true);

    const res = await fetch("/api/orders/bulk-update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "dispatch",
        orderIds: dispatchIds,
      }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      setOrders((prev) =>
        prev.map((order) =>
          dispatchIds.includes(order.id)
            ? { ...order, fields: { ...order.fields, order_status: "Dispatched" } }
            : order
        )
      );

      alert(`Dispatched: ${data.updated || 0}`);
    } else {
      alert(data.message || "Bulk dispatch failed");
    }

    setBulkSaving(false);
  }

  const isFabDohaNonStock = useMemo(() => {
    const normalized = baseName.trim().toLowerCase();

    return (
      (normalized.includes("fab") || normalized.includes("doha")) &&
      (normalized.includes("non stock") ||
        normalized.includes("non-stock") ||
        normalized.includes("without stock"))
    );
  }, [baseName]);

  const normalizedUserRole = userRole.trim().toLowerCase();
  const isAdmin = normalizedUserRole === "admin";
  const isSupplier = normalizedUserRole === "supplier";

  async function moveOrderToFabStock(order: OrderRecord) {
    const orderNo = getOrderNo(order);

    if (!orderNo || orderNo === "-") {
      alert("Order number not found.");
      return;
    }

    if (
      !confirm(
        `Move all items of ${orderNo} to FAB Doha Stock? This action must only be done once.`
      )
    ) {
      return;
    }

    setMovingOrderId(order.id);

    try {
      const response = await fetch("/api/orders/move-to-fab-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          orderNo,
          sourceTable: String(
            (order.fields as Record<string, unknown>).__tableName || ""
          ),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        alert(data?.message || "Move to FAB Stock failed");
        return;
      }

      setMovedOrderIds((previous) =>
        previous.includes(order.id) ? previous : [...previous, order.id]
      );

      alert(
        `${orderNo}: ${data.totalQuantity || 0} PCS added to FAB Doha Stock.`
      );
    } catch {
      alert("Move to FAB Stock failed");
    } finally {
      setMovingOrderId("");
    }
  }


  async function bulkMoveOrdersToFabStock() {
    if (selectedRows.length === 0) {
      alert("Please select at least one order.");
      return;
    }

    const selectedOrders = orders
      .filter((order) => selectedRows.includes(order.id))
      .map((order) => ({
        orderId: order.id,
        orderNo: getOrderNo(order),
        sourceTable: String(
          (order.fields as Record<string, unknown>).__tableName || ""
        ),
      }));

    if (
      !confirm(
        `Move ${selectedOrders.length} selected orders to FAB Doha Stock?`
      )
    ) {
      return;
    }

    setBulkSaving(true);

    try {
      const response = await fetch("/api/orders/move-to-fab-stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orders: selectedOrders,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        alert(data?.message || "Bulk shift to FAB Stock failed");
        return;
      }

      setMovedOrderIds((previous) => [
        ...previous,
        ...selectedOrders.map((item) => item.orderId),
      ]);

      setSelectedRows([]);

      alert(
        data.message ||
          `${selectedOrders.length} orders moved to FAB Doha Stock successfully`
      );
    } catch {
      alert("Bulk shift to FAB Stock failed");
    } finally {
      setBulkSaving(false);
    }
  }

  const isBSOrderEntry = useMemo(() => {
    const normalizedBaseName = baseName.toLowerCase();

    return (
      normalizedBaseName.includes("bs order") ||
      normalizedBaseName.includes("bs invoice") ||
      normalizedBaseName.trim() === "bs"
    );
  }, [baseName]);

  const supportsCourierDownload = useMemo(() => {
    const normalizedBaseName = baseName.trim().toLowerCase();

    return (
      isBSOrderEntry ||
      normalizedBaseName.includes("tatlumput") ||
      normalizedBaseName.includes("siyam") ||
      normalizedBaseName === "tat" ||
      normalizedBaseName === "ts" ||
      normalizedBaseName.startsWith("ts ")
    );
  }, [baseName, isBSOrderEntry]);

  function selectedOrderNumbers() {
    const selectedIds = new Set(selectedRows);

    return orders
      .filter((order) => selectedIds.has(order.id))
      .map((order) => String(getOrderNo(order) || "").trim())
      .filter((orderNo) => orderNo && orderNo !== "-");
  }

  async function processReadyOrderNumbers(
    orderNos: string[],
    rowOrderId = "",
  ) {
    if (!isBSOrderEntry) {
      alert("Ready-to-Process action is available only in BS Order Entry.");
      return;
    }

    const uniqueOrderNos = Array.from(
      new Set(orderNos.map((value) => String(value || "").trim()).filter(Boolean)),
    );

    if (uniqueOrderNos.length === 0) {
      alert("Please select at least one order.");
      return;
    }

    if (rowOrderId) {
      setProcessingReadyOrderId(rowOrderId);
    } else {
      setBulkProcessingReady(true);
    }

    try {
      const response = await fetch("/api/reports/ready-to-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNos: uniqueOrderNos,
          requireReady: true,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | ReadyProcessActionResponse
        | null;

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message ||
            "Selected order Ready-to-Process rule pass nahi karta.",
        );
      }

      const processedOrderNos = new Set(
        (data.processedOrderNos || []).map((value) =>
          String(value || "").trim().toLowerCase(),
        ),
      );

      if (processedOrderNos.size > 0) {
        setOrders((current) =>
          current.map((order) => {
            const orderNo = String(getOrderNo(order) || "")
              .trim()
              .toLowerCase();

            if (!processedOrderNos.has(orderNo)) return order;

            return {
              ...order,
              fields: {
                ...order.fields,
                Processing: "Add",
                __readyProcessStatus: "",
              },
            };
          }),
        );

        setSelectedRows((current) =>
          current.filter((recordId) => {
            const order = orders.find((item) => item.id === recordId);
            if (!order) return true;
            return !processedOrderNos.has(
              String(getOrderNo(order) || "").trim().toLowerCase(),
            );
          }),
        );
      }

      const skippedCount = Array.isArray(data.skippedOrderNos)
        ? data.skippedOrderNos.length
        : Math.max(0, uniqueOrderNos.length - processedOrderNos.size);

      alert(
        skippedCount > 0
          ? `${data.message || `${processedOrderNos.size} order(s) sent to Processing`}. ${skippedCount} selected order(s) Ready-to-Process rule pass nahi karte, is liye skip kiye gaye.`
          : data.message || `${processedOrderNos.size} order(s) sent to Processing`,
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Ready-to-Process action failed",
      );
    } finally {
      setProcessingReadyOrderId("");
      setBulkProcessingReady(false);
    }
  }

  async function copySelectedReadyOrders() {
    if (!isBSOrderEntry) return;

    const selectedNos = selectedOrderNumbers();
    if (selectedNos.length === 0) {
      alert("Please select at least one order.");
      return;
    }

    setCopyingSelectedReady(true);

    try {
      const response = await fetch("/api/reports/ready-to-process", {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as
        | ReadyProcessReportResponse
        | null;

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || "Ready-to-Process details load failed",
        );
      }

      const readyByOrderNo = new Map(
        (data.orders || []).map((order) => [
          String(order.orderNo || "").trim().toLowerCase(),
          order,
        ]),
      );

      const formatted = selectedNos
        .map((orderNo) =>
          readyByOrderNo.get(orderNo.trim().toLowerCase())?.formatted || "",
        )
        .filter(Boolean);

      if (formatted.length === 0) {
        alert(
          "Selected orders mein koi order current Ready-to-Process rule pass nahi karta.",
        );
        return;
      }

      await navigator.clipboard.writeText(formatted.join("\n"));

      const skipped = selectedNos.length - formatted.length;
      alert(
        skipped > 0
          ? `${formatted.length} ready selected order(s) copied. ${skipped} non-ready order(s) skip hue.`
          : `${formatted.length} selected ready order(s) copied.`,
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Selected ready orders copy failed",
      );
    } finally {
      setCopyingSelectedReady(false);
    }
  }

  const displayedOrders = useMemo(() => {
    if (!isBSOrderEntry) {
      return orders;
    }

    return orders
      .map((order, index) => ({
        order,
        index,
      }))
      .sort((first, second) => {
        const priorityDifference =
          getOrderProcessingPriority(
            first.order
          ) -
          getOrderProcessingPriority(
            second.order
          );

        if (
          priorityDifference !== 0
        ) {
          return priorityDifference;
        }

        return first.index - second.index;
      })
      .map((item) => item.order);
  }, [orders, isBSOrderEntry]);

  const supportsDriverSheet =
    baseName.toLowerCase().includes("fab") ||
    baseName.toLowerCase().includes("doha") ||
    baseName.toLowerCase().includes("i5q") ||
    baseName.toLowerCase().includes("dq");

  async function downloadDriverSheet() {
    setDownloadingDriverSheet(true);

    try {
      const response = await fetch(
        "/api/orders/driver-sheet",
        { cache: "no-store" }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        alert(
          data?.message ||
            "Driver sheet download failed"
        );
        return;
      }

      const blob = await response.blob();
      const contentDisposition =
        response.headers.get("Content-Disposition") || "";

      const fileNameMatch = contentDisposition.match(
        /filename="?([^"]+)"?/
      );

      const fileName =
        fileNameMatch?.[1] ||
        `Driver_Sheets_${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);
    } catch {
      alert("Driver sheet download failed");
    } finally {
      setDownloadingDriverSheet(false);
    }
  }

  async function downloadCourierFiles() {
    setDownloadingCourierFiles(true);

    try {
      let downloadedFiles = 0;
      const emptyCouriers: string[] = [];

      for (const courier of ["TFM", "EWE"]) {
        const response = await fetch(
          `/api/orders/courier-download?courier=${courier}`,
          { cache: "no-store" }
        );

        if (response.status === 404) {
          emptyCouriers.push(courier);
          continue;
        }

        if (!response.ok) {
          const data = await response
            .json()
            .catch(() => null);

          throw new Error(
            data?.message ||
              `${courier} courier download failed`
          );
        }

        const blob = await response.blob();
        const contentDisposition =
          response.headers.get("Content-Disposition") ||
          "";

        const fileNameMatch = contentDisposition.match(
          /filename="?([^"]+)"?/
        );

        const fileName =
          fileNameMatch?.[1] ||
          `${courier}_Courier_${new Date()
            .toISOString()
            .slice(0, 10)}.${
              courier === "EWE" ? "xls" : "xlsx"
            }`;

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
        downloadedFiles += 1;

        await new Promise((resolve) =>
          setTimeout(resolve, 500)
        );
      }

      if (downloadedFiles === 0) {
        alert(
          "TFM ya EWE ka koi Order Received order nahi mila."
        );
      } else if (emptyCouriers.length > 0) {
        alert(
          `${downloadedFiles} courier file download ho gayi. ${emptyCouriers.join(
            " aur "
          )} ke matching orders nahi mile.`
        );
      }
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Courier download failed"
      );
    } finally {
      setDownloadingCourierFiles(false);
    }
  }

  // ADMIN_ORDER_DELETE_V1: Admin-only order deletion from Orders List.
  async function deleteOrder(order: OrderRecord) {
    if (!isAdmin) {
      alert("Only Admin can delete orders.");
      return;
    }

    const orderNo = getOrderNo(order);
    const tableName = String(
      (order.fields as Record<string, unknown>).__tableName || ""
    ).trim();

    if (!order.id || !tableName) {
      alert("Order source information is missing.");
      return;
    }

    const confirmed = window.confirm(
      `Delete order ${orderNo}?\n\nThis permanently deletes the invoice and its linked order items. This action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingOrderId(order.id);

    try {
      const response = await fetch("/api/orders/list", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: order.id,
          tableName,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        alert(data?.message || "Order delete failed");
        return;
      }

      setOrders((previous) =>
        previous.filter((item) => item.id !== order.id)
      );
      setSelectedRows((previous) =>
        previous.filter((id) => id !== order.id)
      );
      setSelectedOrder((current) =>
        current?.id === order.id ? null : current
      );

      alert(
        `${orderNo} deleted. Linked item lines deleted: ${Number(
          data.deletedItemCount || 0
        )}.`
      );
    } catch {
      alert("Order delete failed");
    } finally {
      setDeletingOrderId("");
    }
  }
  function handlePrint(order: OrderRecord) {
    const payload = {
      orderNo: getOrderNo(order),
      store: getStore(order),
      customer: {
        fields: {
          "Customer Name": getCustomerName(order),
          "Contact No.": getPhone(order),
          Address:
            order.fields.address_bak?.[0] ??
            order.fields["Consignee Address 1"]?.[0] ??
            "",
        },
      },
      items: (order.fields.sku || []).map((skuId: string, index: number) => ({
        id: `${order.id}-${index}`,
        sku: order.fields["OR NO"] || getOrderNo(order),
        qty: order.fields.Qt?.[index] ?? 1,
        price: order.fields.price?.[index] ?? 0,
        productId: skuId,
      })),
      summary: {
        discount: Number(order.fields.discount ?? 0),
        shipping: Number(order.fields.shipping ?? 0),
        vat: Number(order.fields.vat ?? 0),
        advancePayment: 0,
      },
    };

    const encoded = encodeURIComponent(JSON.stringify(payload));
    window.open(`/orders/print?data=${encoded}`, "_blank");
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900">
              Orders List
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {baseName ? `${baseName} — ` : ""}
              Search by order number and use available filters for this base.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 lg:w-[560px]">
            <label className="block text-sm font-bold text-slate-600">
              Search Order No.
            </label>

            <div className="flex gap-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applyFilters();
                  }
                }}
                placeholder="BUS26661, 26661, or 1917"
                className="h-12 flex-1 rounded-2xl border border-slate-200 bg-white px-4 font-bold outline-none focus:border-blue-500"
              />

              <button
                type="button"
                onClick={applyFilters}
                style={{
                  background: "#2563eb",
                  color: "#ffffff",
                  height: "48px",
                  padding: "0 18px",
                  borderRadius: "16px",
                  fontWeight: 900,
                }}
              >
                Search
              </button>

              <button
                type="button"
                onClick={() => setShowFilters((value) => !value)}
                className="h-12 rounded-2xl border border-slate-300 bg-white px-4 font-black hover:bg-slate-50"
              >
                Filters
              </button>
            </div>
          </div>
        </div>

        {showFilters && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Customer
                </label>
                <input
                  value={filters.customer}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      customer: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                  placeholder="Customer name"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Phone
                </label>
                <input
                  value={filters.phone}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      phone: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                  placeholder="Phone number"
                />
              </div>

              {capabilities.hasStore && (
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Store
                </label>
                <input
                  value={filters.store}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      store: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                  placeholder="Store name"
                />
              </div>
              )}

              {capabilities.hasStatus && (
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      status: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500"
                >
                  <option value="">Any Status</option>
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              )}

              {capabilities.hasCourier && (
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Courier
                </label>
                <select
                  value={filters.courier}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      courier: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500"
                >
                  <option value="">Any Courier</option>
                  {courierOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Date From
                </label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      dateFrom: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Date To
                </label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      dateTo: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={applyFilters}
                  style={{
                    background: "#16a34a",
                    color: "#ffffff",
                    height: "44px",
                    padding: "0 18px",
                    borderRadius: "12px",
                    fontWeight: 900,
                  }}
                >
                  Apply
                </button>

                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-4 font-black hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-black text-slate-700">
              Showing {orders.length} orders
            </p>

            {savingKey && (
              <p className="text-sm font-black text-blue-600">Saving...</p>
            )}
          </div>

          {orders.length > 0 && capabilities.canUpdateCourier && !isSupplier && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-black text-slate-700">
                Selected: {selectedRows.length}
              </p>

              <select
                value={bulkCourier}
                onChange={(event) => setBulkCourier(event.target.value)}
                className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold"
              >
                <option value="">Select Courier</option>
                {courierOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={bulkUpdateCourier}
                disabled={selectedRows.length === 0 || !bulkCourier || bulkSaving}
                className="h-10 rounded-xl border border-blue-300 bg-blue-50 px-4 text-sm font-black text-blue-700 disabled:opacity-50"
              >
                Update Courier
              </button>


              {isFabDohaNonStock && (
                <button
                  type="button"
                  onClick={bulkMoveOrdersToFabStock}
                  disabled={selectedRows.length === 0 || bulkSaving}
                  className="h-10 rounded-xl border border-purple-700 bg-purple-600 px-4 text-sm font-black text-white disabled:opacity-50"
                >
                  {bulkSaving ? "Shifting..." : "Bulk Shift to FAB Stock"}
                </button>
              )}

              {isBSOrderEntry && (
                <>
                  <button
                    type="button"
                    onClick={() => void copySelectedReadyOrders()}
                    disabled={
                      selectedRows.length === 0 ||
                      copyingSelectedReady ||
                      bulkProcessingReady ||
                      bulkSaving
                    }
                    className="h-10 rounded-xl border border-violet-300 bg-violet-50 px-4 text-sm font-black text-violet-700 disabled:opacity-50"
                  >
                    {copyingSelectedReady ? "Copying..." : "Copy Selected Ready"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void processReadyOrderNumbers(selectedOrderNumbers())
                    }
                    disabled={
                      selectedRows.length === 0 ||
                      bulkProcessingReady ||
                      copyingSelectedReady ||
                      bulkSaving
                    }
                    className="h-10 rounded-xl border border-emerald-700 bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50"
                  >
                    {bulkProcessingReady
                      ? "Processing Selected..."
                      : "Process Selected Ready"}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={dispatchReadyOrders}
                disabled={bulkSaving}
                className="h-10 rounded-xl border border-green-700 bg-green-600 px-4 text-sm font-black text-white disabled:opacity-50"
              >
                Dispatch Ready Orders
              </button>

              {supportsCourierDownload && (
                <button
                  type="button"
                  onClick={downloadCourierFiles}
                  disabled={downloadingCourierFiles || bulkSaving}
                  className="h-10 rounded-xl border border-cyan-700 bg-cyan-600 px-4 text-sm font-black text-white disabled:opacity-50"
                >
                  {downloadingCourierFiles
                    ? "Preparing Courier Files..."
                    : "Courier Download"}
                </button>
              )}

              {supportsDriverSheet && (
                <button
                  type="button"
                  onClick={downloadDriverSheet}
                  disabled={downloadingDriverSheet || bulkSaving}
                  className="h-10 rounded-xl border border-purple-700 bg-purple-600 px-4 text-sm font-black text-white disabled:opacity-50"
                >
                  {downloadingDriverSheet
                    ? "Preparing..."
                    : "Download Driver Sheet"}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setAppliedSearch(search);
                  setAppliedFilters({ ...filters });
                }}
                disabled={loading || bulkSaving}
                className="h-10 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-black text-amber-700 disabled:opacity-50"
              >
                Refresh
              </button>

              <button
                type="button"
                onClick={() => setSelectedRows([])}
                disabled={selectedRows.length === 0 || bulkSaving}
                className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          )}

          <div className="max-h-[75vh] overflow-auto rounded-2xl border border-slate-200">
            {loading ? (
              <div className="p-6 font-bold text-slate-500">
                Loading orders...
              </div>
            ) : (
              <>
                <table className="w-full min-w-[1320px] border-collapse text-sm">
                  <thead className="sticky top-0 z-20 bg-slate-200 text-slate-900 shadow-sm">
                    <tr>
                      <th className="w-[60px] px-4 py-4 text-left">
                        {capabilities.canUpdateCourier && !isSupplier && (
                          <input
                            type="checkbox"
                            checked={
                              orders.length > 0 &&
                              selectedRows.length === orders.length
                            }
                            onChange={toggleAllRows}
                          />
                        )}
                      </th>
                      <th className="w-[240px] px-4 py-4 text-left">
                        Order No
                      </th>
                      <th className="w-[210px] px-4 py-4 text-left">
                        Customer
                      </th>
                      <th className="w-[150px] px-4 py-4 text-left">Phone</th>
                      <th className="w-[120px] px-4 py-4 text-left">
                        Order Date
                      </th>
                      <th className="w-[150px] px-4 py-4 text-left">Store</th>
                      <th className="w-[220px] px-4 py-4 text-left">
                        Status
                      </th>
                      <th className="w-[120px] px-4 py-4 text-right">
                        Total
                      </th>
                      <th className="w-[190px] px-4 py-4 text-left">
                        Courier
                      </th>
                      <th className="w-[240px] px-4 py-4 text-right">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {displayedOrders.map((order, index) => (
                      <tr
                        key={order.id}
                        className={`border-t transition ${
                          editingOrderId === order.id
                            ? "border-amber-300 bg-amber-50"
                            : isBSOrderEntry &&
                                isReadyFullInStockOrder(order)
                              ? "border-blue-300 bg-blue-100 hover:bg-blue-200"
                              : isBSOrderEntry &&
                                  getReadyProcessStatus(order) === "green"
                                ? "border-emerald-300 bg-emerald-100 hover:bg-emerald-200"
                                : isBSOrderEntry &&
                                    getReadyProcessStatus(order) === "orange"
                                  ? "border-orange-300 bg-orange-100 hover:bg-orange-200"
                                  : index % 2 === 0
                                    ? "bg-white hover:bg-blue-50"
                                    : "bg-slate-50 hover:bg-blue-50"
                        }`}
                      >
                        <td className="px-4 py-3">
                          {capabilities.canUpdateCourier && !isSupplier && (
                            <input
                              type="checkbox"
                              checked={selectedRows.includes(order.id)}
                              onChange={() => toggleRow(order.id)}
                            />
                          )}
                        </td>

                        <td className="px-4 py-3 font-black text-slate-900">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{getOrderNo(order)}</span>
                            {getCourierStatus(order) && (
                              <span
                                title={`Courier status: ${getCourierStatus(order)}`}
                                className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase ${getCourierStatusBadgeClass(
                                  getCourierStatus(order)
                                )}`}
                              >
                                {getCourierStatus(order)}
                              </span>
                            )}
                            {isBSOrderEntry &&
                              isReadyFullInStockOrder(order) && (
                                <span className="rounded-full bg-blue-600 px-2 py-1 text-[10px] font-black text-white">
                                  IN STOCK FULL
                                </span>
                              )}

                            {isBSOrderEntry &&
                              !isReadyFullInStockOrder(order) &&
                              getReadyProcessStatus(order) === "green" && (
                                <span
                                  title={getReadyProcessTitle(order)}
                                  className="rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-black text-white"
                                >
                                  READY TO PROCESS
                                </span>
                              )}

                            {isBSOrderEntry &&
                              !isReadyFullInStockOrder(order) &&
                              getReadyProcessStatus(order) === "orange" && (
                                <span
                                  title={getReadyProcessTitle(order)}
                                  className="rounded-full bg-orange-600 px-2 py-1 text-[10px] font-black text-white"
                                >
                                  READY — PARTIAL / SOLD OUT
                                </span>
                              )}

                            {isBSOrderEntry &&
                              !getReadyProcessStatus(order) &&
                              isPartialInStockOrder(order) && (
                                <span className="rounded-full bg-amber-500 px-2 py-1 text-[10px] font-black text-white">
                                  IN STOCK PARTIAL
                                </span>
                              )}

                            {isBSOrderEntry && isReturnOrder(order) && (
                              <span className="rounded-full bg-red-600 px-2 py-1 text-[10px] font-black text-white">
                                RTS
                              </span>
                            )}
                            {getSource(order) &&
                              !["BS Invoice", "FAB Invoice", "Invoice"].includes(
                                getSource(order)
                              ) && (
                                <span className="rounded-full bg-cyan-100 px-2 py-1 text-[10px] font-black text-cyan-700">
                                  {getSource(order)}
                                </span>
                              )}
                          </div>
                        </td>

                        <td className="px-4 py-3 font-bold text-slate-800">
                          {getCustomerName(order)}
                        </td>

                        <td className="px-4 py-3 font-semibold text-slate-600">
                          {getPhone(order)}
                        </td>

                        <td className="px-4 py-3 font-semibold text-slate-600">
                          {getOrderDate(order)}
                        </td>

                        <td className="px-4 py-3 font-semibold text-slate-700">
                          {getStore(order)}
                        </td>

                        <td className="px-4 py-3 font-bold text-slate-700">
                          {editingOrderId === order.id &&
                          getRowCapability(
                            order,
                            "__canUpdateStatus",
                            capabilities.canUpdateStatus
                          ) ? (
                            <select
                              value={inlineDraft.status}
                              onChange={(event) =>
                                setInlineDraft((previous) => ({
                                  ...previous,
                                  status: event.target.value,
                                }))
                              }
                              disabled={savingKey === `${order.id}-inline`}
                              className="h-10 w-full rounded-xl border border-blue-300 bg-white px-3 text-sm font-bold outline-none focus:border-blue-600 disabled:opacity-60"
                            >
                              <option value="">Blank</option>
                              {getRowOptions(
                                order,
                                "__statusOptions",
                                statusOptions
                              ).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            order.fields.order_status ?? "-"
                          )}
                        </td>

                        <td className="px-4 py-3 text-right font-black text-slate-900">
                          {getCurrency(order)} {getTotal(order).toFixed(2)}
                        </td>

                        <td className="px-4 py-3 font-bold text-slate-700">
                          {editingOrderId === order.id &&
                          getRowCapability(
                            order,
                            "__canUpdateCourier",
                            capabilities.canUpdateCourier
                          ) ? (
                            <select
                              value={inlineDraft.courier}
                              onChange={(event) =>
                                setInlineDraft((previous) => ({
                                  ...previous,
                                  courier: event.target.value,
                                }))
                              }
                              disabled={savingKey === `${order.id}-inline`}
                              className="h-10 w-full rounded-xl border border-blue-300 bg-white px-3 text-sm font-bold outline-none focus:border-blue-600 disabled:opacity-60"
                            >
                              <option value="">Blank</option>
                              {getRowOptions(
                                order,
                                "__courierOptions",
                                courierOptions
                              ).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            order.fields.Courier ?? "-"
                          )}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-nowrap justify-end gap-2">
                            {editingOrderId === order.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => saveInlineEdit(order)}
                                  disabled={savingKey === `${order.id}-inline`}
                                  title={savingKey === `${order.id}-inline` ? "Saving" : "Save changes"}
                                  aria-label={savingKey === `${order.id}-inline` ? "Saving changes" : "Save changes"}
                                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-green-700 bg-green-600 text-lg font-black text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {savingKey === `${order.id}-inline` ? "⏳" : "✓"}
                                </button>

                                <button
                                  type="button"
                                  onClick={cancelInlineEdit}
                                  disabled={savingKey === `${order.id}-inline`}
                                  title="Cancel editing"
                                  aria-label="Cancel editing"
                                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg font-black text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    router.push(
                                  `/orders/view/${encodeURIComponent(
                                    getOrderNo(order)
                                  )}`
                                )
                              }
                              title="View order"
                              aria-label="View order"
                              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg text-slate-800 hover:bg-slate-100"
                            >
                              👁
                            </button>

                            {!isSupplier &&
                              (getRowCapability(
                                order,
                                "__canUpdateStatus",
                                capabilities.canUpdateStatus
                              ) ||
                                getRowCapability(
                                  order,
                                  "__canUpdateCourier",
                                  capabilities.canUpdateCourier
                                )) && (
                              <button
                                type="button"
                                onClick={() => startInlineEdit(order)}
                                disabled={Boolean(savingKey)}
                                title="Quick edit"
                                aria-label="Quick edit order"
                                className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400 bg-amber-50 text-lg font-black text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                ⚡
                              </button>
                            )}

                            {isBSOrderEntry && !isSupplier && (
                              <button
                                type="button"
                                onClick={() =>
                                  void processReadyOrderNumbers(
                                    [String(getOrderNo(order) || "")],
                                    order.id,
                                  )
                                }
                                disabled={
                                  processingReadyOrderId === order.id ||
                                  bulkProcessingReady ||
                                  Boolean(savingKey)
                                }
                                title="Apply Ready-to-Process rule; process only if eligible"
                                aria-label="Process order if Ready to Process"
                                className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-700 bg-emerald-600 text-base font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {processingReadyOrderId === order.id ? "⏳" : "▶"}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                router.push(`/orders/edit/${encodeURIComponent(getOrderNo(order))}`)
                              }
                              title="Open full edit"
                              aria-label="Open full edit"
                              className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-black text-white hover:bg-blue-700"
                            >
                              ✏
                            </button>

                            {isAdmin && isFabDohaNonStock && (
                              <button
                                type="button"
                                onClick={() => moveOrderToFabStock(order)}
                                disabled={
                                  movingOrderId === order.id ||
                                  movedOrderIds.includes(order.id)
                                }
                                title={
                                  movedOrderIds.includes(order.id)
                                    ? "Added to FAB Stock"
                                    : movingOrderId === order.id
                                      ? "Adding to FAB Stock"
                                      : "Add to FAB Stock"
                                }
                                aria-label={
                                  movedOrderIds.includes(order.id)
                                    ? "Added to FAB Stock"
                                    : movingOrderId === order.id
                                      ? "Adding to FAB Stock"
                                      : "Add to FAB Stock"
                                }
                                className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-700 bg-emerald-600 text-lg font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {movedOrderIds.includes(order.id)
                                  ? "✓"
                                  : movingOrderId === order.id
                                    ? "⏳"
                                    : "📦"}
                              </button>
                            )}                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => deleteOrder(order)}
                                disabled={deletingOrderId === order.id || Boolean(savingKey)}
                                title={
                                  deletingOrderId === order.id
                                    ? "Deleting order"
                                    : "Delete order"
                                }
                                aria-label="Delete order"
                                className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-700 bg-red-600 text-lg font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {deletingOrderId === order.id ? "⏳" : "🗑"}
                              </button>
                            )}


                            <button
                              type="button"
                              onClick={() => handlePrint(order)}
                              title="Print order"
                              aria-label="Print order"
                              className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-lg font-black text-white hover:bg-slate-800"
                            >
                              🖨
                            </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}

                    {orders.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-4 py-10 text-center font-bold text-slate-500"
                        >
                          No orders found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {nextOffset && (
                  <div className="flex justify-center border-t bg-white p-5">
                    <button
                      type="button"
                      onClick={loadMoreOrders}
                      disabled={loadingMore}
                      style={{
                        background: "#2563eb",
                        color: "#ffffff",
                        height: "44px",
                        padding: "0 22px",
                        borderRadius: "12px",
                        fontWeight: 900,
                        opacity: loadingMore ? 0.6 : 1,
                      }}
                    >
                      {loadingMore ? "Loading..." : "Load More Orders"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <OrderDetailsModal
        open={Boolean(selectedOrder)}
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onPrint={handlePrint}
      />
    </>
  );
}
