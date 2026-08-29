"use client";

type ProductData = {
  name?: string;
  sku?: string;
  price?: string | number;
  category?: string;
  color?: string;
};

export function generateProductCaption(
  template: string,
  product: ProductData
) {
  return template
    .replaceAll("{name}", String(product.name || ""))
    .replaceAll("{sku}", String(product.sku || ""))
    .replaceAll("{price}", String(product.price || ""))
    .replaceAll("{category}", String(product.category || ""))
    .replaceAll("{color}", String(product.color || ""));
}

export default generateProductCaption;
