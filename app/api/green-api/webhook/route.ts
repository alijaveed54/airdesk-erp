import { NextResponse } from "next/server";

const ID_INSTANCE = (process.env.GREEN_API_ID_INSTANCE || "").trim();
const API_TOKEN_INSTANCE = (process.env.GREEN_API_TOKEN_INSTANCE || "").trim();

async function sendWhatsAppMessage(chatId: string, message: string) {
  if (!ID_INSTANCE || !API_TOKEN_INSTANCE) {
    console.error("Missing Green API credentials in environment variables.");
    return;
  }

  const url = `https://api.green-api.com/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN_INSTANCE}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        message,
      }),
    });

    const data = await res.json().catch(() => null);
    console.log("Send message response:", data);
  } catch (error) {
    console.error("Error sending WhatsApp reply:", error);
  }
}

// Browser check ke liye GET route
export async function GET() {
  return NextResponse.json({
    status: "active",
    message: "Green API webhook endpoint theek kaam kar raha hai.",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const webhookType = body?.typeWebhook;
    const typeMessage = body?.messageData?.typeMessage;

    // 1. Faltu status webhooks (delivered, read ticks waghera) ko foran khatam karein taake Vercel limits zaya na hon
    const isValidEvent =
      webhookType === "incomingMessageReceived" ||
      webhookType === "outgoingMessageReceived";

    if (!isValidEvent || typeMessage !== "textMessage") {
      return NextResponse.json({ status: "ignored_non_target_event" });
    }

    // 2. Bot ke apne API messages ko drop karein taake infinite loop na banay
    if (webhookType === "outgoingAPIMessageReceived") {
      return NextResponse.json({ status: "ignored_api_outgoing" });
    }

    const senderChatId =
      body?.senderData?.chatId || body?.senderData?.sender;
    const incomingText =
      body?.messageData?.textMessageData?.textMessage?.trim() || "";

    // 3. Sirf aapke number ke sath process karein
    if (senderChatId === "923097979959@c.us") {
      // Agar bot ka apna bheja hua menu message wapas aaye to ignore karein
      if (incomingText.startsWith("Assalam-o-Alaikum!")) {
        return NextResponse.json({ status: "ignored_self_echo" });
      }

      console.log(`Processing text from ${senderChatId}: ${incomingText}`);

      const replyText =
        `Assalam-o-Alaikum!\n` +
        `Aapka message mil gaya: "${incomingText}"\n\n` +
        `Airtable Task Menu:\n` +
        `1️⃣ BS Order Entry\n` +
        `2️⃣ FAB Doha\n` +
        `3️⃣ Tatlumput\n\n` +
        `Base select karne ke liye number likh kar bhejein.`;

      await sendWhatsAppMessage(senderChatId, replyText);
    }

    return NextResponse.json({ status: "success" });
  } catch (error) {
    console.error("Webhook execution failed:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}