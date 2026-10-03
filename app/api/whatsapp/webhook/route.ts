import { NextRequest, NextResponse } from "next/server";
import { airtableHeaders, airtableUrl } from "@/lib/airtable";

// BS Base constants
const BS_BASE_ID = "app2hjpuQoeEL1Rn2";
const BS_ORDER_ENTRY_TABLE = "BS Order Entry";

// Security rule: Allowed numbers jo cancel kar sakte hain
const ALLOWED_NUMBERS = ["92300XXXXXXX", "9715XXXXXXX"];

function escapeFormula(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function sendWhatsAppReply(to: string, msg: string) {
  const phoneId = process.env.WA_PHONE_ID;
  const token = process.env.WA_TOKEN;

  if (!phoneId || !token) {
    console.error("WhatsApp credentials missing in environment variables");
    return;
  }

  try {
    await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body: msg },
      }),
    });
  } catch (error) {
    console.error("WhatsApp reply failed:", error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messageObj = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!messageObj) {
      return NextResponse.json({ ok: true });
    }

    const from = String(messageObj.from || "");
    const text = String(messageObj.text?.body || "");

    // 1. Number check
    if (!ALLOWED_NUMBERS.some((n) => from.includes(n))) {
      return NextResponse.json({ reply: "Not authorized" });
    }

    // 2. Order Number extract (e.g., BUS28669)
    const orderMatch = text.match(/BUS\d+/i);
    if (!orderMatch) {
      return NextResponse.json({ reply: "Order Number nahi mila" });
    }
    const orderNumber = orderMatch[0].toUpperCase();

    // 3. Cancel intent check
    if (!text.toLowerCase().includes("cancel")) {
      return NextResponse.json({ reply: "Kya karna hai? Cancel likho" });
    }

    // 4. Airtable update via REST API
    const token =
      process.env.AIRTABLE_TOKEN ||
      process.env.AUTH_AIRTABLE_TOKEN ||
      "";

    if (!token) {
      await sendWhatsAppReply(from, "Airtable token missing in server");
      return NextResponse.json({ ok: false, message: "Token missing" });
    }

    const params = new URLSearchParams({
      pageSize: "1",
      filterByFormula: `{Order Number} = '${escapeFormula(orderNumber)}'`,
    });

    const searchResponse = await fetch(
      airtableUrl(BS_BASE_ID, BS_ORDER_ENTRY_TABLE, params),
      {
        headers: airtableHeaders(token),
        cache: "no-store",
      }
    );

    const searchData = await searchResponse.json();
    const records = searchData?.records || [];

    if (records.length === 0) {
      await sendWhatsAppReply(from, `Order ${orderNumber} nahi mila ❌`);
      return NextResponse.json({ ok: false, message: "Order not found" });
    }

    const recordId = records[0].id;

    const updateResponse = await fetch(
      `${airtableUrl(BS_BASE_ID, BS_ORDER_ENTRY_TABLE)}/${encodeURIComponent(recordId)}`,
      {
        method: "PATCH",
        headers: {
          ...airtableHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            "Order Status": "Cancelled",
          },
          typecast: true,
        }),
      }
    );

    if (!updateResponse.ok) {
      await sendWhatsAppReply(from, `Error: ${orderNumber} cancel nahi hua`);
      return NextResponse.json({ ok: false });
    }

    await sendWhatsAppReply(
      from,
      `Done ✅ Order ${orderNumber} Cancel kar diya hai.`
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("WhatsApp webhook execution error:", e);
    return NextResponse.json({ ok: false });
  }
}

// GET for Webhook Verification - Meta ke liye zaroori
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  if (searchParams.get("hub.verify_token") === process.env.WA_VERIFY_TOKEN) {
    return new NextResponse(searchParams.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}