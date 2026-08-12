export const TFM_SUPPORTED_BASES = {
  BS: {
    baseId: "app2hjpuQoeEL1Rn2",
    baseName: "BS Order Entry (UAE)",
    invoiceTable: "BS Invoice",
  },
  TAT: {
    baseId: "app4YLp41AMlWtCxK",
    baseName: "Tatlumput Siyam Order Entry",
    invoiceTable: "Invoice",
  },
} as const;

export type TfmSupportedBase =
  (typeof TFM_SUPPORTED_BASES)[keyof typeof TFM_SUPPORTED_BASES];

export type TfmOperation = "create" | "track" | "cancel" | "label";

export type TfmHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type TfmEndpointConfiguration = {
  operation: TfmOperation;
  path: string;
  method: TfmHttpMethod;
  bodyTemplate: unknown | null;
  bodyTemplateConfigured: boolean;
};

export const TFM_DEFAULT_API_BASE_URL =
  "https://sandbox-customerapi.tfmex.com";

export const TFM_DEFAULT_AUTH_PATH = "/api/v1/Token";
export const TFM_DEFAULT_CREATE_SHIPMENT_PATH = "/api/v1/SkyBill/new";

const TFM_DEFAULT_CREATE_SHIPMENT_BODY_TEMPLATE = {
  subAccountId: "{{subAccountId}}",
  consignee: "{{customerName}}",
  consigneeAddress: "{{fullAddress}}",
  consigneeCity: "{{city}}",
  consigneeBuildingName: "{{building}}",
  consigneeStreetName: "{{street}}",
  consigneeCountry: "{{consigneeCountry}}",
  deliveryServiceCode: "{{deliveryServiceCode}}",
  pieces: "{{pieces}}",
  totalWeight: "{{totalWeight}}",
  totalVolumeWeight: "{{totalVolumeWeight}}",
  shipperReferenceNo: "{{orderNo}}",
  consigneeArea: "{{area}}",
  consigneeEmail: "{{email}}",
  consigneeMobile: "{{mobileDigits}}",
  consigneeTelePhone: "{{telephoneDigits}}",
  consigneeLatitude: "{{latitude}}",
  consigneeLongitude: "{{longitude}}",
  valueAmount: "{{total}}",
  cod: "{{codAmount}}",
  content: "{{content}}",
  shipperRemarks: "{{note}}",
  handlingPack: "{{handlingPack}}",
  handlingCold: "{{handlingCold}}",
  handlingFragile: "{{handlingFragile}}",
  printMode: "{{printMode}}",
} as const;

const supportedBaseIds = new Set<string>(
  Object.values(TFM_SUPPORTED_BASES).map((base) => base.baseId),
);

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function booleanEnv(name: string, fallback: boolean) {
  const value = env(name).toLowerCase();

  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function numberEnv(name: string, fallback: number) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberEnv(name: string, fallback: number) {
  const value = Number(env(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseHttpMethod(name: string, fallback: TfmHttpMethod) {
  const method = env(name).toUpperCase();
  const allowed = new Set<TfmHttpMethod>([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ]);

  return allowed.has(method as TfmHttpMethod)
    ? (method as TfmHttpMethod)
    : fallback;
}

function parseJsonEnvironmentValue(name: string): unknown | null {
  const value = String(process.env[name] || "").trim();

  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

export function isTfmSupportedBase(baseId: string) {
  return supportedBaseIds.has(String(baseId || "").trim());
}

export function getTfmSupportedBase(baseId: string): TfmSupportedBase | null {
  return (
    Object.values(TFM_SUPPORTED_BASES).find(
      (base) => base.baseId === String(baseId || "").trim(),
    ) || null
  );
}

export function getTfmApiBaseUrl() {
  return env("TFM_API_BASE_URL") || TFM_DEFAULT_API_BASE_URL;
}

export function getTfmAuthPath() {
  return env("TFM_AUTH_PATH") || TFM_DEFAULT_AUTH_PATH;
}

function decodeBase64EnvironmentValue(name: string) {
  const encoded = String(process.env[name] || "").trim();

  if (!encoded) return "";

  try {
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    throw new Error(`${name} is not valid Base64`);
  }
}

export function getTfmCredentials() {
  const base64UserName = decodeBase64EnvironmentValue(
    "TFM_USERNAME_BASE64",
  );
  const base64Password = decodeBase64EnvironmentValue(
    "TFM_PASSWORD_BASE64",
  );

  return {
    userName:
      base64UserName ||
      String(process.env.TFM_USERNAME || "").trim(),
    // Do not trim passwords. Leading/trailing characters may be intentional.
    password:
      base64Password ||
      String(process.env.TFM_PASSWORD || ""),
    source:
      base64UserName || base64Password ? "base64" : "plain",
  };
}

export function joinTfmUrl(path: string) {
  const baseUrl = getTfmApiBaseUrl().replace(/\/+$/, "");
  const cleanPath = String(path || "").trim();

  if (!cleanPath) return baseUrl;
  if (/^https?:\/\//i.test(cleanPath)) return cleanPath;

  return `${baseUrl}/${cleanPath.replace(/^\/+/, "")}`;
}

export function getTfmRequestTimeoutMs() {
  return numberEnv("TFM_REQUEST_TIMEOUT_MS", 30_000);
}

export function getTfmAllowLiveRequests() {
  return booleanEnv("TFM_ALLOW_LIVE_REQUESTS", false);
}

export function getTfmExtraHeaders() {
  const value = parseJsonEnvironmentValue("TFM_EXTRA_HEADERS_JSON");

  if (value === null) return {} as Record<string, string>;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TFM_EXTRA_HEADERS_JSON must be a JSON object");
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, headerValue]) => [key.trim(), String(headerValue ?? "")])
      .filter(([key, headerValue]) => key && headerValue),
  );
}

export function getTfmLabelAllowedHosts() {
  return env("TFM_LABEL_ALLOWED_HOSTS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}


export function getTfmShipmentDefaults() {
  return {
    subAccountId: Math.trunc(
      nonNegativeNumberEnv("TFM_SUB_ACCOUNT_ID", 0),
    ),
    defaultCountry:
      env("TFM_DEFAULT_COUNTRY") || "United Arab Emirates",
    codServiceCode: env("TFM_COD_SERVICE_CODE") || "COD",
    prepaidServiceCode: env("TFM_PREPAID_SERVICE_CODE"),
    defaultContent:
      env("TFM_DEFAULT_CONTENT") || "General Merchandise",
    defaultWeight: numberEnv("TFM_DEFAULT_WEIGHT", 1),
    defaultVolumeWeight: numberEnv("TFM_DEFAULT_VOLUME_WEIGHT", 1),
    handlingPack: booleanEnv("TFM_HANDLING_PACK", false),
    handlingCold: booleanEnv("TFM_HANDLING_COLD", false),
    handlingFragile: booleanEnv("TFM_HANDLING_FRAGILE", false),
    printMode: Math.trunc(nonNegativeNumberEnv("TFM_PRINT_MODE", 1)),
  };
}

export function getTfmEndpointConfiguration(
  operation: TfmOperation,
): TfmEndpointConfiguration {
  const definitions: Record<
    TfmOperation,
    {
      pathEnvironment: string;
      methodEnvironment: string;
      templateEnvironment: string;
      defaultMethod: TfmHttpMethod;
    }
  > = {
    create: {
      pathEnvironment: "TFM_CREATE_SHIPMENT_PATH",
      methodEnvironment: "TFM_CREATE_SHIPMENT_METHOD",
      templateEnvironment: "TFM_CREATE_SHIPMENT_BODY_TEMPLATE",
      defaultMethod: "POST",
    },
    track: {
      pathEnvironment: "TFM_TRACK_SHIPMENT_PATH",
      methodEnvironment: "TFM_TRACK_SHIPMENT_METHOD",
      templateEnvironment: "TFM_TRACK_SHIPMENT_BODY_TEMPLATE",
      defaultMethod: "GET",
    },
    cancel: {
      pathEnvironment: "TFM_CANCEL_SHIPMENT_PATH",
      methodEnvironment: "TFM_CANCEL_SHIPMENT_METHOD",
      templateEnvironment: "TFM_CANCEL_SHIPMENT_BODY_TEMPLATE",
      defaultMethod: "POST",
    },
    label: {
      pathEnvironment: "TFM_LABEL_PATH",
      methodEnvironment: "TFM_LABEL_METHOD",
      templateEnvironment: "TFM_LABEL_BODY_TEMPLATE",
      defaultMethod: "GET",
    },
  };

  const definition = definitions[operation];
  const configuredPath = env(definition.pathEnvironment);
  const configuredBodyTemplate = parseJsonEnvironmentValue(
    definition.templateEnvironment,
  );
  const path =
    configuredPath ||
    (operation === "create" ? TFM_DEFAULT_CREATE_SHIPMENT_PATH : "");
  const bodyTemplate =
    configuredBodyTemplate ??
    (operation === "create"
      ? TFM_DEFAULT_CREATE_SHIPMENT_BODY_TEMPLATE
      : null);

  return {
    operation,
    path,
    method: parseHttpMethod(
      definition.methodEnvironment,
      definition.defaultMethod,
    ),
    bodyTemplate,
    bodyTemplateConfigured: bodyTemplate !== null,
  };
}

export function getTfmConfigurationStatus() {
  const apiBaseUrl = getTfmApiBaseUrl();
  const authPath = getTfmAuthPath();
  const credentials = getTfmCredentials();
  const create = getTfmEndpointConfiguration("create");
  const track = getTfmEndpointConfiguration("track");
  const cancel = getTfmEndpointConfiguration("cancel");
  const label = getTfmEndpointConfiguration("label");
  const liveRequestsAllowed = getTfmAllowLiveRequests();

  const credentialsConfigured = Boolean(
    credentials.userName && credentials.password,
  );
  const authenticationReady = Boolean(
    apiBaseUrl && authPath && credentialsConfigured,
  );

  const endpointReady = (endpoint: TfmEndpointConfiguration) =>
    Boolean(
      authenticationReady &&
        liveRequestsAllowed &&
        endpoint.path &&
        (endpoint.method === "GET" ||
          endpoint.method === "DELETE" ||
          endpoint.bodyTemplateConfigured),
    );

  return {
    apiBaseUrlConfigured: Boolean(apiBaseUrl),
    apiBaseUrl,
    authPathConfigured: Boolean(authPath),
    authPath,
    usernameConfigured: Boolean(credentials.userName),
    passwordConfigured: Boolean(credentials.password),
    credentialsConfigured,
    authenticationReady,
    liveRequestsAllowed,
    createShipmentPathConfigured: Boolean(create.path),
    createShipmentTemplateConfigured: create.bodyTemplateConfigured,
    trackShipmentPathConfigured: Boolean(track.path),
    trackShipmentTemplateConfigured: track.bodyTemplateConfigured,
    cancelShipmentPathConfigured: Boolean(cancel.path),
    cancelShipmentTemplateConfigured: cancel.bodyTemplateConfigured,
    labelPathConfigured: Boolean(label.path),
    labelTemplateConfigured: label.bodyTemplateConfigured,
    bookingReady: endpointReady(create),
    trackingReady: endpointReady(track),
    cancellationReady: endpointReady(cancel),
    labelReady: endpointReady(label),
    environment: apiBaseUrl.toLowerCase().includes("sandbox")
      ? "sandbox"
      : "production",
  };
}
