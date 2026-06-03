/**
 * Official JLCPCB Open API client (authenticated).
 *
 * Unlike the public catalog/live endpoints, this uses your approved JLCPCB API
 * credentials (apply at https://api.jlcpcb.com) and the HMAC-SHA256 "JOP"
 * signing scheme to reach the official Parts API at https://open.jlcpcb.com.
 *
 * Signing is verified against the official documentation sample vector in the
 * test suite. Ported from the reverse-engineered Java SDK behaviour
 * (i2cjak/jlcpcb_api).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ENDPOINT = "https://open.jlcpcb.com";
const NONCE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/** Shared message shown by tools when official-API credentials are absent. */
export const CREDENTIALS_MESSAGE =
  "Official JLCPCB API credentials are not configured. Set JLCPCB_APP_ID, " +
  "JLCPCB_ACCESS_KEY, and JLCPCB_SECRET_KEY (apply for access at https://api.jlcpcb.com). " +
  "The catalog/live tools work without credentials.";

export interface OfficialCredentials {
  appId: string;
  accessKey: string;
  secretKey: string;
  /** API base, e.g. https://open.jlcpcb.com (no trailing slash). */
  endpoint: string;
  /** Optional context path stripped from the signed URI. */
  contextPath?: string;
}

export interface OfficialResponse<T = unknown> {
  code: number;
  message?: string;
  data?: T;
  requestId?: string;
}

/** Read official-API credentials from the environment, or `null` if unset. */
export function getCredentials(): OfficialCredentials | null {
  const appId = process.env.JLCPCB_APP_ID;
  const accessKey = process.env.JLCPCB_ACCESS_KEY;
  const secretKey = process.env.JLCPCB_SECRET_KEY;
  if (!appId || !accessKey || !secretKey) return null;
  return {
    appId,
    accessKey,
    secretKey,
    endpoint: (process.env.JLCPCB_ENDPOINT || DEFAULT_ENDPOINT).replace(
      /\/+$/,
      ""
    ),
    contextPath: process.env.JLCPCB_CONTEXT_PATH || undefined,
  };
}

/** Whether official-API credentials are configured. */
export function hasOfficialCredentials(): boolean {
  return getCredentials() !== null;
}

/** Generate a random alphanumeric nonce (32 chars by default). */
export function generateNonce(length = 32): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += NONCE_ALPHABET[bytes[i] % NONCE_ALPHABET.length];
  }
  return out;
}

/** Canonical request URI for signing: path + query, with contextPath removed. */
export function canonicalUri(url: string, contextPath?: string): string {
  const parsed = new URL(url);
  let uri = parsed.pathname;
  if (parsed.search) uri += parsed.search; // includes leading "?"
  if (contextPath && uri.startsWith(contextPath)) {
    uri = uri.slice(contextPath.length);
  }
  return uri;
}

/** Build the string-to-sign: METHOD\nURI\nTIMESTAMP\nNONCE\nBODY\n */
export function buildStringToSign(
  method: string,
  canonical: string,
  timestamp: number | string,
  nonce: string,
  body: string
): string {
  return `${method.toUpperCase()}\n${canonical}\n${timestamp}\n${nonce}\n${body}\n`;
}

/** HMAC-SHA256(secret, stringToSign), base64-encoded. */
export function sign(secretKey: string, stringToSign: string): string {
  return crypto
    .createHmac("sha256", secretKey)
    .update(stringToSign, "utf8")
    .digest("base64");
}

/** Build the `JOP ...` Authorization header for a request. */
export function buildAuthorizationHeader(
  creds: OfficialCredentials,
  opts: {
    method: string;
    url: string;
    body?: string;
    nonce?: string;
    timestamp?: number;
  }
): string {
  const nonce = opts.nonce ?? generateNonce();
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const canonical = canonicalUri(opts.url, creds.contextPath);
  const stringToSign = buildStringToSign(
    opts.method,
    canonical,
    timestamp,
    nonce,
    opts.body ?? ""
  );
  const signature = sign(creds.secretKey, stringToSign);
  return (
    `JOP appid="${creds.appId}",` +
    `accesskey="${creds.accessKey}",` +
    `timestamp="${timestamp}",` +
    `nonce="${nonce}",` +
    `signature="${signature}"`
  );
}

/**
 * Make a signed request to the official JLCPCB API and return its `data`.
 *
 * Throws if credentials are missing, the HTTP status is not OK, or the body's
 * business `code` is not 200.
 */
export async function officialRequest<T = unknown>(
  uri: string,
  opts: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<T> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      "Official JLCPCB API credentials not configured. Set JLCPCB_APP_ID, JLCPCB_ACCESS_KEY, and JLCPCB_SECRET_KEY."
    );
  }

  const method = opts.method ?? "POST";
  const url = new URL(creds.endpoint + uri);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  // The signed body must be byte-identical to what is sent. For POST we always
  // serialize an object (an empty body becomes "{}").
  const isPost = method === "POST";
  const bodyStr = isPost ? JSON.stringify(opts.body ?? {}) : "";

  const authorization = buildAuthorizationHeader(creds, {
    method,
    url: url.toString(),
    body: bodyStr,
  });

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization,
    },
    body: isPost ? bodyStr : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `JLCPCB official API HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`
    );
  }

  const json = (await res.json()) as OfficialResponse<T>;
  if (json.code !== 200) {
    throw new Error(
      `JLCPCB official API error ${json.code}: ${json.message ?? "unknown error"}`
    );
  }
  return json.data as T;
}

/**
 * Whether order-*creation* tools are explicitly enabled. These place real,
 * paid orders, so they are opt-in via `JLCPCB_ENABLE_ORDERS` (1/true/yes).
 */
export function ordersEnabled(): boolean {
  const value = (process.env.JLCPCB_ENABLE_ORDERS ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Upload a file to a signed multipart endpoint (gerber/blind-via image/3D model).
 *
 * Signing matches the official scheme for uploads: the signed body is the JSON
 * `meta` string sent as a form field (not the file bytes). The multipart
 * Content-Type/boundary is set automatically by `fetch`.
 */
export async function officialUpload<T = unknown>(
  uri: string,
  opts: { filePath: string; fileName?: string; meta?: Record<string, unknown> }
): Promise<T> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      "Official JLCPCB API credentials not configured. Set JLCPCB_APP_ID, JLCPCB_ACCESS_KEY, and JLCPCB_SECRET_KEY."
    );
  }
  if (!fs.existsSync(opts.filePath)) {
    throw new Error(`Upload file not found: ${opts.filePath}`);
  }

  const metaStr = JSON.stringify(opts.meta ?? {});
  const url = creds.endpoint + uri;
  const fileName = opts.fileName ?? path.basename(opts.filePath);

  const authorization = buildAuthorizationHeader(creds, {
    method: "POST",
    url,
    body: metaStr,
  });

  const form = new FormData();
  form.append("meta", metaStr);
  form.append("file", new Blob([fs.readFileSync(opts.filePath)]), fileName);

  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: authorization },
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `JLCPCB official API HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`
    );
  }

  const json = (await res.json()) as OfficialResponse<T>;
  if (json.code !== 200) {
    throw new Error(
      `JLCPCB official API error ${json.code}: ${json.message ?? "unknown error"}`
    );
  }
  return json.data as T;
}
