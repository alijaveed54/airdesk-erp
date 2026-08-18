export type GreenApiTarget = "soldOut" | "dispatch" | "timelines";
export type GreenApiAccount = "primary" | "secondary";

type GreenApiConfig = {
  apiUrl: string;
  idInstance: string;
  apiTokenInstance: string;
};

export type GreenApiResponse = {
  idMessage?: string;
  [key: string]: unknown;
};

export type GreenApiHistoryMessage = {
  type?: "incoming" | "outgoing" | string;
  idMessage?: string;
  timestamp?: number;
  typeMessage?: string;
  chatId?: string;
  senderId?: string;
  senderName?: string;
  senderContactName?: string;
  textMessage?: string;
  caption?: string;
  downloadUrl?: string;
  fileName?: string;
  mimeType?: string;
  jpegThumbnail?: string;
  isForwarded?: boolean;
  sendByApi?: boolean;
  statusMessage?: string;
  extendedTextMessage?: {
    text?: string;
    stanzaId?: string;
    participant?: string;
    [key: string]: unknown;
  };
  quotedMessage?: {
    stanzaId?: string;
    participant?: string;
    typeMessage?: string;
    textMessage?: string;
    caption?: string;
    downloadUrl?: string;
    fileName?: string;
    mimeType?: string;
    jpegThumbnail?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getGreenApiConfig(
  account: GreenApiAccount = "primary",
): GreenApiConfig {
  if (account === "secondary") {
    return {
      apiUrl: requiredEnv("GREEN_API_URL1_1").replace(/\/+$/, ""),
      idInstance: requiredEnv("GREEN_API_ID_INSTANCE1_1"),
      apiTokenInstance: requiredEnv("GREEN_API_TOKEN_INSTANCE1_1"),
    };
  }

  return {
    apiUrl: requiredEnv("GREEN_API_URL").replace(/\/+$/, ""),
    idInstance: requiredEnv("GREEN_API_ID_INSTANCE"),
    apiTokenInstance: requiredEnv("GREEN_API_TOKEN_INSTANCE"),
  };
}

export function getGreenApiGroups(
  account: GreenApiAccount = "primary",
) {
  if (account === "secondary") {
    return {
      soldOut: String(process.env.GREEN_API_SOLD_OUT_GROUP_ID_1 || "").trim(),
      dispatch: String(process.env.GREEN_API_DISPATCH_GROUP_ID_1 || "").trim(),
      timelines: String(process.env.GREEN_API_TIMELINES_GROUP_ID_1 || "").trim(),
    };
  }

  return {
    soldOut: String(process.env.GREEN_API_SOLD_OUT_GROUP_ID || "").trim(),
    dispatch: String(process.env.GREEN_API_DISPATCH_GROUP_ID || "").trim(),
    timelines: String(process.env.GREEN_API_TIMELINES_GROUP_ID || "").trim(),
  };
}

export function getGreenApiGroup(
  target: GreenApiTarget,
  account: GreenApiAccount = "primary",
) {
  const groupId = getGreenApiGroups(account)[target];
  const suffix = account === "secondary" ? "_1" : "";
  if (!groupId) {
    throw new Error(
      `GREEN_API_${target.toUpperCase()}_GROUP_ID${suffix} is not configured`,
    );
  }
  if (!groupId.endsWith("@g.us")) {
    throw new Error(`Invalid WhatsApp group ID for ${target}`);
  }
  return groupId;
}

function endpoint(
  method: string,
  account: GreenApiAccount = "primary",
) {
  const config = getGreenApiConfig(account);
  return `${config.apiUrl}/waInstance${encodeURIComponent(config.idInstance)}/${method}/${encodeURIComponent(config.apiTokenInstance)}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`GREEN-API returned invalid JSON (${response.status})`);
  }
}

async function greenRequest<T = GreenApiResponse>(
  method: string,
  init?: RequestInit,
  account: GreenApiAccount = "primary",
): Promise<T> {
  const response = await fetch(endpoint(method, account), {
    ...init,
    cache: "no-store",
  });
  const data = await parseResponse<T>(response);

  if (!response.ok) {
    const object = data as Record<string, unknown>;
    const message = String(
      object?.message ||
        object?.error ||
        object?.description ||
        `GREEN-API ${method} failed with HTTP ${response.status}`,
    );
    throw new Error(message);
  }

  return data;
}

export async function getGreenApiState(
  account: GreenApiAccount = "primary",
) {
  return greenRequest("getStateInstance", { method: "GET" }, account);
}

export async function getGreenApiChatHistory(input: {
  account?: GreenApiAccount;
  chatId: string;
  count?: number;
}) {
  if (!input.chatId.endsWith("@g.us")) {
    throw new Error("GREEN-API target must be a WhatsApp group");
  }

  const count = Math.max(1, Math.min(Math.trunc(Number(input.count || 100)), 10000));

  const data = await greenRequest<GreenApiHistoryMessage[]>(
    "getChatHistory",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: input.chatId,
        count,
      }),
    },
    input.account || "primary",
  );

  return Array.isArray(data) ? data : [];
}


export async function getGreenApiMessage(input: {
  account?: GreenApiAccount;
  chatId: string;
  idMessage: string;
}) {
  if (!input.chatId.endsWith("@g.us")) {
    throw new Error("GREEN-API target must be a WhatsApp group");
  }

  const idMessage = String(input.idMessage || "").trim();
  if (!idMessage) {
    throw new Error("GREEN-API message ID is required");
  }

  return greenRequest<GreenApiHistoryMessage>(
    "getMessage",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: input.chatId,
        idMessage,
      }),
    },
    input.account || "primary",
  );
}

export async function getGreenApiMessageDownloadUrl(input: {
  account?: GreenApiAccount;
  chatId: string;
  idMessage: string;
}) {
  const message = await getGreenApiMessage(input);
  const downloadUrl = String(message?.downloadUrl || "").trim();
  if (!/^https?:\/\//i.test(downloadUrl)) {
    throw new Error("GREEN-API GetMessage did not return a valid media download URL");
  }
  return downloadUrl;
}

export async function getGreenApiDownloadFileUrl(input: {
  account?: GreenApiAccount;
  chatId: string;
  idMessage: string;
}) {
  if (!input.chatId.endsWith("@g.us")) {
    throw new Error("GREEN-API target must be a WhatsApp group");
  }

  const idMessage = String(input.idMessage || "").trim();
  if (!idMessage) {
    throw new Error("GREEN-API message ID is required");
  }

  const data = await greenRequest<{ downloadUrl?: string }>(
    "downloadFile",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: input.chatId,
        idMessage,
      }),
    },
    input.account || "primary",
  );

  const downloadUrl = String(data?.downloadUrl || "").trim();
  if (!/^https?:\/\//i.test(downloadUrl)) {
    throw new Error("GREEN-API did not return a valid media download URL");
  }

  return downloadUrl;
}

export async function sendGreenApiText(input: {
  account?: GreenApiAccount;
  chatId: string;
  message: string;
  quotedMessageId?: string;
}) {
  if (!input.chatId.endsWith("@g.us")) {
    throw new Error("GREEN-API target must be a WhatsApp group");
  }

  const payload: Record<string, unknown> = {
    chatId: input.chatId,
    message: input.message.slice(0, 20000),
  };

  if (String(input.quotedMessageId || "").trim()) {
    payload.quotedMessageId = String(input.quotedMessageId).trim();
  }

  return greenRequest(
    "sendMessage",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    input.account || "primary",
  );
}

export async function sendGreenApiFileByUrl(input: {
  account?: GreenApiAccount;
  chatId: string;
  urlFile: string;
  fileName: string;
  caption: string;
}) {
  if (!input.chatId.endsWith("@g.us")) {
    throw new Error("GREEN-API target must be a WhatsApp group");
  }
  if (!/^https?:\/\//i.test(input.urlFile)) {
    throw new Error("A public http(s) image URL is required");
  }

  return greenRequest(
    "sendFileByUrl",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: input.chatId,
        urlFile: input.urlFile,
        fileName: input.fileName,
        caption: input.caption.slice(0, 1024),
      }),
    },
    input.account || "primary",
  );
}

