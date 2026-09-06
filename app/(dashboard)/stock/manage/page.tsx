"use client";

import { useEffect, useState } from "react";

export default function StockManagePage() {
  const [items, setItems] = useState<any[]>([]);
  const [values, setValues] = useState<any>({});

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    const res = await fetch("/api/stock/manage");
    const data = await res.json();

    const list = data.items || [];
    setItems(list);

    const initial: any = {};
    list.forEach((item: any) => {
      initial[item.key] = {
        price: item.price || "",
        size: item.size || "",
        fabric: item.fabric || "",
      };
    });

    setValues(initial);
  }

  function changeValue(key: string, field: string, value: string) {
    setValues((prev: any) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  }

  async function saveItem(item: any, field: string) {
    await fetch("/api/stock/manage", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: item.id,
        [field]: values[item.key][field],
      }),
    });

    loadItems();
  }

  async function remove(key: string) {
    await fetch("/api/stock/manage", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key }),
    });

    loadItems();
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-black mb-5">Stock Manage</h1>

      {items.map((item) => (
        <div
          key={item.url}
          className="border rounded p-4 mb-3 flex gap-4"
        >
          <img
            src={item.url}
            className="w-32 h-32 object-cover"
          />

          <div className="space-y-3">
            <div>SKU: {item.sku}</div>

            <div>
              Price:
              <input
                className="border ml-2 px-2"
                value={values[item.key]?.price || ""}
                onChange={(e) =>
                  changeValue(item.key, "price", e.target.value)
                }
              />
              <button
                className="ml-2 bg-green-600 text-white px-3 py-1 rounded"
                onClick={() => saveItem(item, "price")}
              >
                Save
              </button>
            </div>

            <div>
              Size:
              <input
                className="border ml-2 px-2"
                value={values[item.key]?.size || ""}
                onChange={(e) =>
                  changeValue(item.key, "size", e.target.value)
                }
              />
              <button
                className="ml-2 bg-green-600 text-white px-3 py-1 rounded"
                onClick={() => saveItem(item, "size")}
              >
                Save
              </button>
            </div>

            <div>
              Fabric:
              <input
                className="border ml-2 px-2"
                value={values[item.key]?.fabric || ""}
                onChange={(e) =>
                  changeValue(item.key, "fabric", e.target.value)
                }
              />
              <button
                className="ml-2 bg-green-600 text-white px-3 py-1 rounded"
                onClick={() => saveItem(item, "fabric")}
              >
                Save
              </button>
            </div>

            <button
              className="bg-red-600 text-white px-3 py-1 rounded"
              onClick={() => remove(item.key)}
            >
              Delete Image
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
