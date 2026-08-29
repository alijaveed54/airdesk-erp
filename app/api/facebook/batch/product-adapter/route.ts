import { NextRequest, NextResponse } from "next/server";

// Patch helper for Facebook Batch API
// Purpose:
// Accept product based batches and convert them into existing batch structure.
// Keep existing group/post batch flow unchanged.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Existing normal batch flow should continue.
    if (!body.products || !Array.isArray(body.products)) {
      return NextResponse.json({
        success: false,
        message: "Product batch payload required",
      }, { status: 400 });
    }

    const products = body.products;

    const groups = products.map((product: any, index: number) => ({
      id: crypto.randomUUID(),
      pageRecordIds: [],
      intervalMinutes: 10,
      autoShuffleImages: true,
      startAt: "",
      posts: [
        {
          id: crypto.randomUUID(),
          message:
            product.caption ||
            `New Product ${product.sku || index + 1}`,
          imageUrls: product.imageUrls || [],
          imageNames: [],
          videoUrl: "",
          videoName: "",
          videoPosition: "last",
        },
      ],
    }));

    return NextResponse.json({
      success: true,
      message: "Product batch payload prepared",
      groups,
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Product batch conversion failed",
      },
      { status: 500 }
    );
  }
}
