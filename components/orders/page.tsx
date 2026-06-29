"use client";

import CustomerSearch from "@/components/orders/CustomerSearch";
import InvoiceSection from "@/components/orders/InvoiceSection";
import ProductSearch from "@/components/orders/ProductSearch";
import OrderSummary from "@/components/orders/OrderSummary";

export default function OrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900">BS Order Entry</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create customer orders quickly using mobile search and SKU entry.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <CustomerSearch />
          <InvoiceSection />
          <ProductSearch />
        </div>

        <OrderSummary />
      </div>
    </div>
  );
}