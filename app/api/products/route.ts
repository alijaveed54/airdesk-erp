import { NextResponse } from "next/server";
import { getProducts } from "@/lib/airtable";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") || "";
    const offset = searchParams.get("offset") || "";
    const pageSize = searchParams.get("pageSize") || "50";
    const stockOnly = ["1", "true", "yes"].includes(
      String(searchParams.get("stockOnly") || "")
        .trim()
        .toLowerCase(),
    );

    if (!stockOnly) {
      const data = await getProducts({
        search,
        offset,
        pageSize,
      });

      return NextResponse.json({
        success: true,
        ...data,
      });
    }

    // Order Entry stock-aware search:
    // Airtable may have many matching historical/zero-stock SKU records.
    // Loading only the first 10 raw matches and filtering stock in the browser
    // can hide valid in-stock variants on later Airtable pages.
    const requestedSize = Math.min(
      Math.max(Number(pageSize) || 10, 1),
      100,
    );

    const inStockRecords: any[] = [];
    let currentOffset = offset;
    let nextOffset = "";
    let pagesScanned = 0;
    const maxPagesToScan = 20;

    do {
      const data = await getProducts({
        search,
        offset: currentOffset,
        pageSize: "100",
      });

      for (const record of data.records || []) {
        const rawStock = record?.fields?.["Balance Stock"];
        const stockValue = Array.isArray(rawStock) ? rawStock[0] : rawStock;
        const stock = Number(stockValue || 0);

        if (Number.isFinite(stock) && stock > 0) {
          inStockRecords.push(record);
        }
      }

      nextOffset = String(data.offset || "");
      currentOffset = nextOffset;
      pagesScanned += 1;
    } while (
      inStockRecords.length < requestedSize &&
      currentOffset &&
      pagesScanned < maxPagesToScan
    );

    return NextResponse.json({
      success: true,
      records: inStockRecords.slice(0, requestedSize),
      offset: nextOffset,
      stockOnly: true,
      pagesScanned,
    });
  } catch (error) {
    console.error("Products API Error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      {
        status: 500,
      },
    );
  }
}
