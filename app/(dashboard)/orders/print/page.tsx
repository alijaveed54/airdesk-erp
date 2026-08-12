"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function PrintOrderContent() {
  const searchParams = useSearchParams();
  const data = searchParams.get("data");

  if (!data) {
    return <div className="p-8">No invoice data found.</div>;
  }

  const invoice = JSON.parse(decodeURIComponent(data));

  useEffect(() => {
    setTimeout(() => {
      window.print();
    }, 300);
  }, []);

  return (
    <>
      <style jsx global>{`
  body {
    background: white !important;
  }

  @page {
    size: A4;
    margin: 10mm;
  }

  @media print {
    html,
    body {
      width: 210mm;
      min-height: 297mm;
      background: white !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    main {
      max-width: none !important;
      padding: 0 !important;
      box-shadow: none !important;
    }

    table {
      page-break-inside: auto;
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    thead {
      display: table-header-group;
    }
  }
`}</style>

      <main className="mx-auto max-w-3xl bg-white p-10 text-slate-900">
        <div className="mb-8 border-b-2 border-slate-900 pb-5">
  <div className="flex items-start justify-between">
    <div>
      <h1 className="text-3xl font-black tracking-tight">
  {invoice.store}
</h1>
      <p className="mt-1 text-sm font-bold text-slate-500">
        Customer Invoice
      </p>
    </div>

    <div className="text-right">
      <p className="text-sm font-bold text-slate-500">Order No.</p>
      <p className="text-2xl font-black">{invoice.orderNo}</p>
      <p className="mt-2 text-xs text-slate-500">
        Print Date: {new Date().toLocaleDateString()}
      </p>
    </div>
  </div>
</div>

        <div className="mb-8 rounded-lg border border-slate-300 p-5">
  <h2 className="mb-4 border-b pb-2 text-lg font-black">
    Customer Details
  </h2>

  <div className="grid grid-cols-[140px_1fr] gap-y-3">

    <span className="font-bold text-slate-500">
      Customer
    </span>

    <span className="font-semibold">
      {invoice.customer?.fields?.["Customer Name"]}
    </span>

    <span className="font-bold text-slate-500">
      Phone
    </span>

    <span>
      {invoice.customer?.fields?.["Contact No."]}
    </span>

    <span className="font-bold text-slate-500">
      Address
    </span>

    <span>
      {invoice.customer?.fields?.Address}
    </span>

  </div>
</div>

        <table className="w-full border-collapse text-sm">
  <thead>
    <tr className="border-y-2 border-slate-900 bg-slate-100">
      <th className="py-3 text-left font-black">
        SKU / Product
      </th>
      <th className="w-20 py-3 text-center font-black">
        Qty
      </th>
      <th className="w-28 py-3 text-right font-black">
        Price
      </th>
      <th className="w-28 py-3 text-right font-black">
        Total
      </th>
    </tr>
  </thead>

  <tbody>
    {invoice.items.map((item: any) => (
      <tr key={item.id} className="border-b border-slate-200">
        <td className="py-2 pr-4 font-bold">
          {item.sku}
        </td>

        <td className="py-2 text-center">
          {item.qty}
        </td>

        <td className="py-2 text-right">
          AED {item.price.toFixed(2)}
        </td>

        <td className="py-2 text-right font-bold">
          AED {(item.qty * item.price).toFixed(2)}
        </td>
      </tr>
    ))}
  </tbody>
</table>

        <div className="mt-8 flex justify-end">
  <div className="w-80 rounded-lg border border-slate-300">

    <div className="flex justify-between border-b px-4 py-2">
      <span>Subtotal</span>
      <span>
        AED{" "}
        {invoice.items
          .reduce((t: number, i: any) => t + i.qty * i.price, 0)
          .toFixed(2)}
      </span>
    </div>

    <div className="flex justify-between border-b px-4 py-2">
      <span>Discount</span>
      <span>AED {invoice.summary.discount.toFixed(2)}</span>
    </div>

    <div className="flex justify-between border-b px-4 py-2">
      <span>Shipping</span>
      <span>AED {invoice.summary.shipping.toFixed(2)}</span>
    </div>

    <div className="flex justify-between border-b px-4 py-2">
      <span>VAT</span>
      <span>AED {invoice.summary.vat.toFixed(2)}</span>
    </div>

    <div className="flex justify-between border-b px-4 py-2">
      <span>Advance Payment</span>
      <span>AED {invoice.summary.advancePayment.toFixed(2)}</span>
    </div>

    <div className="flex justify-between border-t-2 border-slate-900 px-4 py-3 text-lg font-black text-slate-950">
      <span>Grand Total</span>

      <span>
        AED{" "}
        {(
          invoice.items.reduce(
            (t: number, i: any) => t + i.qty * i.price,
            0
          ) -
          invoice.summary.discount +
          invoice.summary.shipping +
          invoice.summary.vat -
          invoice.summary.advancePayment
        ).toFixed(2)}
      </span>
    </div>

  </div>
</div>
<div className="mt-10 border-t pt-5 text-center">
  <p className="text-lg font-black">Thank you for shopping ❤️</p>
  <p className="mt-1 text-xs text-slate-500">
    This is a computer-generated invoice.
  </p>
</div>
      </main>
    </>
  );
}

export default function PrintOrderPage() {
  return (
    <Suspense fallback={<div className="p-8 font-bold">Loading...</div>}>
      <PrintOrderContent />
    </Suspense>
  );
}
