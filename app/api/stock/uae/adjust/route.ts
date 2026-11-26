import { NextRequest, NextResponse } from "next/server";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";
const UAE_STOCK_BASE_ID =
  process.env.AIRTABLE_UAE_STOCK_BASE_ID || process.env.AIRTABLE_BASE_ID || "";
const PRODUCTS_TABLE =
  process.env.AIRTABLE_UAE_PRODUCTS_TABLE || "Products";
const MOVEMENTS_TABLE =
  process.env.AIRTABLE_UAE_MOVEMENTS_TABLE || "Stock Movements";

async function getSessionUser(req: NextRequest) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const meUrl = new URL("/api/auth/me", req.url);
    const res = await fetch(meUrl, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.success && data?.user ? data.user : null;
  } catch {
    return null;
  }
}

async function resolveMovementType(mode: "add" | "reduce"): Promise<string> {
  const preferred =
    mode === "add"
      ? ["Add", "Stock In", "In", "Addition", "+"]
      : ["Reduce", "Stock Out", "Out", "Deduction", "-"];

  try {
    const metaRes = await fetch(
      `https://api.airtable.com/v0/meta/bases/${UAE_STOCK_BASE_ID}/tables`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        cache: "no-store",
      },
    );
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      const movTable = (metaData.tables || []).find(
        (t: any) => t.name === MOVEMENTS_TABLE,
      );
      const typeField = (movTable?.fields || []).find(
        (f: any) => f.name === "Type",
      );
      const choices: Array<{ name: string }> =
        typeField?.options?.choices || [];

      for (const candidate of preferred) {
        const match = choices.find(
          (c) => c.name.trim().toLowerCase() === candidate.toLowerCase(),
        );
        if (match) return match.name;
      }

      if (choices.length > 0) {
        return mode === "add" ? choices[0].name : choices[choices.length - 1].name;
      }
    }
  } catch {
    // Fallback below
  }

  return mode === "add" ? "Add" : "Reduce";
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "ERP ID se login zaroori hai." },
        { status: 401 },
      );
    }

    if (!AIRTABLE_API_KEY || !UAE_STOCK_BASE_ID) {
      return NextResponse.json(
        { success: false, message: "Airtable UAE base env variables missing hain." },
        { status: 500 },
      );
    }

    const body = await req.json();
    const id = String(body?.id || "").trim();
    const mode = body?.mode === "reduce" ? "reduce" : "add";
    const quantity = Math.max(1, Math.floor(Number(body?.quantity) || 1));

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Product ID required hai." },
        { status: 400 },
      );
    }

    const productRes = await fetch(
      `https://api.airtable.com/v0/${UAE_STOCK_BASE_ID}/${encodeURIComponent(PRODUCTS_TABLE)}/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        cache: "no-store",
      },
    );
    const productData = await productRes.json();
    if (!productRes.ok) {
      return NextResponse.json(
        { success: false, message: productData?.error?.message || "Product nahi mila." },
        { status: productRes.status },
      );
    }

    const currentStock = Number(productData?.fields?.["Quantity in Stock"] ?? 0);
    if (mode === "reduce" && quantity > currentStock) {
      return NextResponse.json(
        {
          success: false,
          message: `Current stock sirf ${currentStock} hai, is se zyada reduce nahi ho sakta.`,
        },
        { status: 400 },
      );
    }

    const movementType = await resolveMovementType(mode);
    const todayIso = new Date().toISOString().slice(0, 10);
    const actorName = user.name || user.email || user.role || "ERP User";

    const createMovRes = await fetch(
      `https://api.airtable.com/v0/${UAE_STOCK_BASE_ID}/${encodeURIComponent(MOVEMENTS_TABLE)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          typecast: true,
          fields: {
            Product: [id],
            Type: movementType,
            Quantity: quantity,
            Date: todayIso,
            Note: `UAE Stock Report (${mode}) by ${actorName}`,
          },
        }),
      },
    );
    const createMovData = await createMovRes.json();
    if (!createMovRes.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            createMovData?.error?.message || "Stock movement create nahi ho saki.",
        },
        { status: createMovRes.status },
      );
    }

    // Updated rollup value read karne ke liye product dobara fetch karein
    const updatedRes = await fetch(
      `https://api.airtable.com/v0/${UAE_STOCK_BASE_ID}/${encodeURIComponent(PRODUCTS_TABLE)}/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        cache: "no-store",
      },
    );
    const updatedData = await updatedRes.json();
    const nextStock = updatedRes.ok
      ? Number(updatedData?.fields?.["Quantity in Stock"] ?? 0)
      : mode === "add"
        ? currentStock + quantity
        : Math.max(0, currentStock - quantity);

    return NextResponse.json({
      success: true,
      stock: nextStock,
      movementId: createMovData?.id,
      message: `${productData?.fields?.["Product Name"] || id}: stock ${
        mode === "add" ? `+${quantity} add` : `-${quantity} reduce`
      } ho gaya (Current Stock: ${nextStock}).`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: err instanceof Error ? err.message : "Stock adjust error",
      },
      { status: 500 },
    );
  }
}