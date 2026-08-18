"use client";

export type PublicStockProduct = {
  id: string;
  sku: string;
  price: number;
  image: string;
  balanceStock: number;
  category: string;
  color: string;
  size: string;
};

type Props = {
  product: PublicStockProduct;
  onImageClick: (product: PublicStockProduct) => void;
  currency?: string;
  whatsAppNumber?: string;
};

const DEFAULT_WHATSAPP_NUMBER = "97430454914";

export default function ProductCard({
  product,
  onImageClick,
  currency = "QAR",
  whatsAppNumber = DEFAULT_WHATSAPP_NUMBER,
}: Props) {
  function openWhatsApp() {
    const details = [
      "Hello, I am interested in this product:",
      "",
      `SKU: ${product.sku}`,
      `Price: ${currency} ${product.price.toLocaleString("en-US")}`,
      `Available Stock: ${product.balanceStock}`,
      product.category ? `Category: ${product.category}` : "",
      product.color ? `Color: ${product.color}` : "",
      product.size ? `Size: ${product.size}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const target = whatsAppNumber
      ? `https://wa.me/${whatsAppNumber}?text=${encodeURIComponent(details)}`
      : `https://wa.me/?text=${encodeURIComponent(details)}`;

    window.open(target, "_blank", "noopener,noreferrer");
  }

  return (
    <article className="flex h-full min-h-[430px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <button
        type="button"
        onClick={() => onImageClick(product)}
        className="block h-56 w-full shrink-0 cursor-zoom-in overflow-hidden bg-slate-100 sm:h-60"
        aria-label={`Open large image for ${product.sku}`}
      >
        {product.image ? (
          <img
            src={product.image}
            alt={product.sku}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs font-semibold text-slate-400">
            Image not available
          </div>
        )}
      </button>

      <div className="flex flex-1 flex-col p-3">
        <div className="flex min-h-12 items-start justify-between gap-2">
          <h2 className="line-clamp-2 break-all text-sm font-black leading-5 text-slate-900">
            {product.sku}
          </h2>

          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
            {product.balanceStock} in stock
          </span>
        </div>

        <p className="mt-1 text-lg font-black text-slate-950">
          {currency} {product.price.toLocaleString("en-US")}
        </p>

        <div className="mt-2 min-h-14">
          <div className="flex flex-wrap gap-1.5">
            {product.category && <Badge value={product.category} />}
            {product.color && <Badge value={product.color} />}
            {product.size && <Badge value={product.size} />}
          </div>
        </div>

        <button
          type="button"
          onClick={openWhatsApp}
          className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 py-2.5 text-xs font-black text-white transition hover:brightness-95 active:scale-[0.98]"
          aria-label={`Ask about ${product.sku} on WhatsApp`}
        >
          <WhatsAppIcon />
          WhatsApp
        </button>
      </div>
    </article>
  );
}

function Badge({ value }: { value: string }) {
  return (
    <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
      {value}
    </span>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className="h-4 w-4 fill-current"
    >
      <path d="M19.11 17.21c-.29-.15-1.72-.85-1.99-.95-.27-.1-.47-.15-.67.15-.2.29-.77.95-.94 1.14-.17.2-.35.22-.64.07-.29-.15-1.24-.46-2.36-1.45-.87-.78-1.46-1.74-1.63-2.03-.17-.29-.02-.45.13-.6.13-.13.29-.35.44-.52.15-.17.2-.29.29-.49.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.29-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.21 5.09 4.5.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.08 1.72-.7 1.96-1.38.24-.68.24-1.26.17-1.38-.07-.12-.27-.2-.57-.34Z" />
      <path d="M16.03 3.2c-7.05 0-12.78 5.72-12.78 12.76 0 2.25.59 4.45 1.7 6.38L3.14 28.8l6.61-1.73a12.77 12.77 0 0 0 6.27 1.6h.01c7.04 0 12.77-5.72 12.77-12.76S23.07 3.2 16.03 3.2Zm0 23.31h-.01a10.6 10.6 0 0 1-5.41-1.48l-.39-.23-3.92 1.03 1.05-3.82-.25-.4a10.58 10.58 0 1 1 8.93 4.9Z" />
    </svg>
  );
}
