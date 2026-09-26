import { NextResponse } from "next/server";

const ID_INSTANCE = (process.env.GREEN_API_ID_INSTANCE || "").trim();
const API_TOKEN_INSTANCE = (process.env.GREEN_API_TOKEN_INSTANCE || "").trim();

async function sendWhatsAppMessage(chatId: string, message: string) {
  if (!ID_INSTANCE || !API_TOKEN_INSTANCE) {
    console.error("DEBUG: Credentials missing in env variables!", {
      idLength: ID_INSTANCE.length,
      tokenLength: API_TOKEN_INSTANCE.length,
    });
    return null;
  }

  const url = `https://api.green-api.com/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN_INSTANCE}`;
  console.log("DEBUG: Calling Green API URL ->", url);

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
    console.log("DEBUG: Green API sendMessage response ->", data);
    return data;
  } catch (error) {
    console.error("DEBUG: Error sending WhatsApp reply ->", error);
    return null;
  }
}

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

    // 1. Status notifications ko drop karein taake Vercel limits zaya na hon
    const isValidEvent =
      webhookType === "incomingMessageReceived" ||
      webhookType === "outgoingMessageReceived";

    if (!isValidEvent || typeMessage !== "textMessage") {
      console.log("DEBUG: Dropped non-message event ->", { webhookType, typeMessage });
      return NextResponse.json({ status: "ignored_non_target_event" });
    }

    // 2. Bot ke apne API messages ko drop karein taake infinite loop na banay
    if (webhookType === "outgoingAPIMessageReceived") {
      return NextResponse.json({ status: "ignored_api_outgoing" });
    }

    // Chat ID aur text extract karein (Phone aur Web dono formats handle)
    const rawChatId =
      body?.senderData?.chatId ||
      body?.senderData?.sender ||
      body?.senderData?.senderContactId ||
      body?.instanceData?.wid ||
      "";

    const incomingText = (
      body?.messageData?.textMessageData?.textMessage ||
      body?.messageData?.extendedTextMessageData?.text ||
      ""
    ).trim();

    console.log("DEBUG: Webhook parsed ->", {
      webhookType,
      rawChatId,
      incomingText,
    });

    // Loop rokna
    if (incomingText.startsWith("Assalam-o-Alaikum!")) {
      return NextResponse.json({ status: "ignored_self_echo" });
    }

    // Number check: Agar rawChatId mein 923097979959 maujood ho
    const isAuthorized =
      rawChatId.includes("923097979959") || rawChatId === "923097979959@c.us";

    if (!isAuthorized) {
      console.log("DEBUG: Unauthorized sender ->", rawChatId);
      return NextResponse.json({ status: "unauthorized_user", rawChatId });
    }

    const replyTarget = rawChatId.includes("@") ? rawChatId : `${rawChatId}@c.us`;

    const replyText =
      `Assalam-o-Alaikum!\n` +
      `Aapka message mil gaya: "${incomingText}"\n\n` +
      `Airtable Task Menu:\n` +
      `1️⃣ BS Order Entry\n` +
      `2️⃣ FAB Doha\n` +
      `3️⃣ Tatlumput\n\n` +
      `Base select karne ke liye number likh kar bhejein.`;

    const apiResponse = await sendWhatsAppMessage(replyTarget, replyText);

    return NextResponse.json({
      status: "success",
      replyTarget,
      apiResponse,
    });
  } catch (error) {
    console.error("DEBUG: Webhook execution failed ->", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}