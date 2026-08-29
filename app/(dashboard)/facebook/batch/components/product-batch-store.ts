"use client";

import { useSyncExternalStore } from "react";

export type ProductBatchItem = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  color: string;
  price: number;
  images: string[];
  caption: string;
};

type ProductBatchState = {
  products: ProductBatchItem[];
  selectedIds: Set<string>;
  loading: boolean;
  error: string;
  batchName: string;
  pageRecordIds: string[];
  intervalMinutes: number;
  startAt: string;
  submitting: boolean;
};

const defaultState: ProductBatchState = {
  products: [],
  selectedIds: new Set(),
  loading: false,
  error: "",
  batchName: "",
  pageRecordIds: [],
  intervalMinutes: 10,
  startAt: "",
  submitting: false,
};

let state = defaultState;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(partial: Partial<ProductBatchState>) {
  state = { ...state, ...partial };
  emit();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProductBatchState() {
  return state;
}

export function setProductBatchProducts(products: ProductBatchItem[]) {
  setState({ products, selectedIds: new Set() });
}

export function toggleProductSelection(productId: string) {
  const selectedIds = new Set(state.selectedIds);
  if (selectedIds.has(productId)) {
    selectedIds.delete(productId);
  } else {
    selectedIds.add(productId);
  }
  setState({ selectedIds });
}

export function selectAllProducts() {
  const allSelected =
    state.products.length > 0 &&
    state.selectedIds.size === state.products.length;

  setState({
    selectedIds: allSelected
      ? new Set()
      : new Set(state.products.map((product) => product.productId)),
  });
}

export function updateProductCaption(productId: string, caption: string) {
  setState({
    products: state.products.map((product) =>
      product.productId === productId ? { ...product, caption } : product
    ),
  });
}

export function setProductBatchField<K extends keyof ProductBatchState>(
  key: K,
  value: ProductBatchState[K]
) {
  setState({ [key]: value } as Partial<ProductBatchState>);
}

export function toggleProductBatchPage(pageRecordId: string) {
  const pageRecordIds = state.pageRecordIds.includes(pageRecordId)
    ? state.pageRecordIds.filter((id) => id !== pageRecordId)
    : [...state.pageRecordIds, pageRecordId];

  setState({ pageRecordIds });
}

export function useProductBatchStore() {
  return useSyncExternalStore(subscribe, getProductBatchState, getProductBatchState);
}

export function getSelectedProducts() {
  return state.products.filter((product) =>
    state.selectedIds.has(product.productId)
  );
}
