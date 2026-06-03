import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildAuthorizationHeader,
  canonicalUri,
  generateNonce,
  sign,
  getCredentials,
  hasOfficialCredentials,
  officialRequest,
  officialUpload,
  ordersEnabled,
  type OfficialCredentials,
} from "../official-client.js";

const ENV_KEYS = [
  "JLCPCB_APP_ID",
  "JLCPCB_ACCESS_KEY",
  "JLCPCB_SECRET_KEY",
  "JLCPCB_ENDPOINT",
  "JLCPCB_CONTEXT_PATH",
  "JLCPCB_ENABLE_ORDERS",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

const SAMPLE_CREDS: OfficialCredentials = {
  appId: "293992070061998081",
  accessKey: "b6713a535d56412f805afadd7e818455",
  secretKey: "z0BWlikshimuyiwBsH1i2qwnzMb3j3kA",
  endpoint: "https://open.jlcpcb.com",
};

describe("signing", () => {
  it("matches the official documentation sample vector", () => {
    const header = buildAuthorizationHeader(SAMPLE_CREDS, {
      method: "POST",
      url: "https://open.jlcpcb.com/order/v1/createOrder",
      body: '{"goodsId":100,"quantity":52,"createdTime":"2024-03-21 10:03:20"}',
      nonce: "IZHEJYNIHYZIE8S0LLC0VWTPJVRRTO50",
      timestamp: 1625208260,
    });
    expect(header).toBe(
      'JOP appid="293992070061998081",accesskey="b6713a535d56412f805afadd7e818455",timestamp="1625208260",nonce="IZHEJYNIHYZIE8S0LLC0VWTPJVRRTO50",signature="sygwKhKBkLwHVv0c7D+a/A7JTEJjGH/kLugFKh16918="'
    );
  });

  it("sign() is deterministic", () => {
    const sts = "POST\n/x\n1\nn\n{}\n";
    expect(sign("secret", sts)).toBe(sign("secret", sts));
  });
});

describe("canonicalUri", () => {
  it("includes the query string", () => {
    expect(canonicalUri("https://open.jlcpcb.com/a/b?x=1&y=2")).toBe("/a/b?x=1&y=2");
  });
  it("strips a configured context path", () => {
    expect(canonicalUri("https://open.jlcpcb.com/ctx/a/b", "/ctx")).toBe("/a/b");
  });
});

describe("generateNonce", () => {
  it("produces an alphanumeric string of the requested length", () => {
    const nonce = generateNonce(32);
    expect(nonce).toHaveLength(32);
    expect(nonce).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe("credentials", () => {
  it("reads credentials from env", () => {
    process.env.JLCPCB_APP_ID = "a";
    process.env.JLCPCB_ACCESS_KEY = "b";
    process.env.JLCPCB_SECRET_KEY = "c";
    expect(hasOfficialCredentials()).toBe(true);
    expect(getCredentials()?.endpoint).toBe("https://open.jlcpcb.com");
  });

  it("strips a trailing slash from a custom endpoint", () => {
    process.env.JLCPCB_APP_ID = "a";
    process.env.JLCPCB_ACCESS_KEY = "b";
    process.env.JLCPCB_SECRET_KEY = "c";
    process.env.JLCPCB_ENDPOINT = "https://example.com/";
    expect(getCredentials()?.endpoint).toBe("https://example.com");
  });

  it("returns null when credentials are incomplete", () => {
    delete process.env.JLCPCB_APP_ID;
    delete process.env.JLCPCB_ACCESS_KEY;
    delete process.env.JLCPCB_SECRET_KEY;
    expect(hasOfficialCredentials()).toBe(false);
    expect(getCredentials()).toBeNull();
  });
});

describe("officialRequest", () => {
  beforeEach(() => {
    process.env.JLCPCB_APP_ID = "a";
    process.env.JLCPCB_ACCESS_KEY = "b";
    process.env.JLCPCB_SECRET_KEY = "c";
    vi.stubGlobal("fetch", vi.fn());
  });

  it("signs the request and returns data on business code 200", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 200, data: { hello: "world" } }),
    } as unknown as Response);

    const data = await officialRequest(
      "/overseas/openapi/component/getComponentInfos",
      { method: "POST", body: {} }
    );

    expect(data).toEqual({ hello: "world" });
    const [url, opts] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("https://open.jlcpcb.com/overseas/openapi/component/getComponentInfos");
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^JOP appid="a",accesskey="b"/);
    // Signed body and sent body must be byte-identical ("{}" for an empty body).
    expect((opts as RequestInit).body).toBe("{}");
  });

  it("throws on a non-200 business code", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 403, message: "access denied" }),
    } as unknown as Response);
    await expect(officialRequest("/x", { body: {} })).rejects.toThrow(/403: access denied/);
  });

  it("throws on a non-ok HTTP status", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    } as unknown as Response);
    await expect(officialRequest("/x", { body: {} })).rejects.toThrow(/HTTP 500/);
  });

  it("throws when credentials are missing", async () => {
    delete process.env.JLCPCB_APP_ID;
    await expect(officialRequest("/x", { body: {} })).rejects.toThrow(
      /credentials not configured/
    );
  });
});

describe("ordersEnabled", () => {
  it.each(["1", "true", "TRUE", "yes"])("is true for %j", (value) => {
    process.env.JLCPCB_ENABLE_ORDERS = value;
    expect(ordersEnabled()).toBe(true);
  });

  it.each(["0", "false", "no", ""])("is false for %j", (value) => {
    process.env.JLCPCB_ENABLE_ORDERS = value;
    expect(ordersEnabled()).toBe(false);
  });

  it("is false when unset", () => {
    delete process.env.JLCPCB_ENABLE_ORDERS;
    expect(ordersEnabled()).toBe(false);
  });
});

describe("officialUpload", () => {
  let tmpFile: string;

  beforeEach(() => {
    process.env.JLCPCB_APP_ID = "a";
    process.env.JLCPCB_ACCESS_KEY = "b";
    process.env.JLCPCB_SECRET_KEY = "c";
    tmpFile = path.join(
      os.tmpdir(),
      `jlc-upload-${process.pid}-${Math.random().toString(36).slice(2)}.bin`
    );
    fs.writeFileSync(tmpFile, "hello gerber");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });

  it("posts multipart form data with a signed Authorization header", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 200, data: { fileKey: "FK1" } }),
    } as unknown as Response);

    const data = await officialUpload("/overseas/openapi/pcb/uploadGerber", {
      filePath: tmpFile,
    });

    expect(data).toEqual({ fileKey: "FK1" });
    const [, opts] = vi.mocked(fetch).mock.calls[0];
    expect((opts as RequestInit).body).toBeInstanceOf(FormData);
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^JOP appid="a"/);
    // Content-Type is left to fetch (multipart boundary), not set manually.
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("rejects when the file does not exist", async () => {
    await expect(
      officialUpload("/x", { filePath: path.join(os.tmpdir(), "nope-does-not-exist.bin") })
    ).rejects.toThrow(/not found/i);
  });

  it("rejects when credentials are missing", async () => {
    delete process.env.JLCPCB_APP_ID;
    await expect(officialUpload("/x", { filePath: tmpFile })).rejects.toThrow(
      /credentials not configured/
    );
  });
});
