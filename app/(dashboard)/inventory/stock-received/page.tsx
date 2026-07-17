"use client";

import { useSearchParams } from "next/navigation";
import DQStockReceiveForm from "./components/DQStockReceiveForm";
import FABStockReceiveForm from "./components/FABStockReceiveForm";

export default function StockReceivedPage() {
  const searchParams = useSearchParams();

  const selectedBase = String(
    searchParams.get("type") || "dq"
  )
    .trim()
    .toLowerCase();

  switch (selectedBase) {
    case "i5q-dq":
    case "i5q":
    case "dq":
      return <DQStockReceiveForm />;

    case "fab-stock":
    case "fab-doha-stock":
    case "fab":
      return <FABStockReceiveForm />;

    default:
      return (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-8">
          <h1 className="text-2xl font-bold">
            Stock Receive
          </h1>

          <p className="mt-3">
            Invalid stock receive type. Use either:
          </p>

          <div className="mt-4 space-y-2 text-sm">
            <div>
              <strong>DQ:</strong>{" "}
              <code>
                /inventory/stock-received?type=dq
              </code>
            </div>

            <div>
              <strong>FAB Doha Stock:</strong>{" "}
              <code>
                /inventory/stock-received?type=fab-stock
              </code>
            </div>
          </div>
        </div>
      );
  }
}
