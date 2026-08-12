export type GreenApiTarget = "soldOut" | "dispatch" | "timelines";

type GreenApiConfig = {
  apiUrl: string;
  idInstance: string;
  apiTokenInstance: string;
};

type GreenApiResponse = {
  idMessage?: string;
  [key: string]: unknown;
};

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getGreenApiConfig(): GreenApiConfig {
  return {
    apiUrl: requiredEnv("GREEN_API_URL").replace(/\/+$/, ""),
    idInstance: requiredEnv("GREEN_API_ID_INSTANCE"),
    apiTokenInstance: requiredEnv("GREEN_API_TOKEN_INSTANCE"),
  };
}

export function getGreenApiGroups() {
  return {
    soldOut: String(process.env.GREEN_API_SOLD_OUT_GROUP_ID || "").trim(),
    dispatch: String(process.env.GREEN_API_DISPATCH_GROUP_ID || "").trim(),
    timelines: String(process.env.GREEN_API_TIMELINES_GROUP_ID || "").trim(),
  };
}

export function getGreenApiGroup(target: GreenApiTarget) {
  const groupId = getGreenApiGroups()[target];
  if (!groupId) throw new Error(`GREEN_API_${target.toUpperCase()} group is not configured`);
  if (!groupId.endsWith("@g.us")) throw new Error(`Invalid WhatsApp group ID for ${target}`);
  return groupId;
}

function endpoint(method: string) {
  const config = getGreenApiConfig();
  return `${config.apiUrl}/waInstance${encodeURIComponent(config.idInstance)}/${method}/${encodeURIComponent(config.apiTokenInstance)}`;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {} as GreenApiResponse;

  try {
    return JSON.parse(text) as GreenApiResponse;
  } catch {
    throw new Error(`GREEN-API returned invalid JSON (${response.status})`);
  }
}

async function greenRequest(method: string, init?: RequestInit) {
  const response = await fetch(endpoint(method), {
    ...init,
    cache: "no-store",
  });
  const data = await parseResponse(response);

  if (!response.ok) {
    const message = String(
      (data as any)?.message ||
        (data as any)?.error ||
        (data as any)?.description ||
        `GREEN-API ${method} failed with HTTP ${response.status}`,
    );
    throw new Error(message);
  }

  return data;
}

export async function getGreenApiState() {
  return greenRequest("getStateInstance", { method: "GET" });
}

export async function sendGreenApiText(input: {
  chatId: string;
  message: string;
}) {
  if (!input.chatId.endsWith("@g.us")) {
    throw new Error("GREEN-API target must be a WhatsApp group");
  }

  return greenRequest("sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: input.chatId,
      message: input.message.slice(0, 20000),
    }),
  });
}

export async function sendGreenApiFileByUrl(input: {
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

  return greenRequest("sendFileByUrl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: input.chatId,
      urlFile: input.urlFile,
      fileName: input.fileName,
      caption: input.caption.slice(0, 1024),
    }),
  });
}
