import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchComponentDetail, normalizeLcsc } from "../live-client.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("normalizeLcsc", () => {
  it.each([
    ["17976", "C17976"],
    ["c17976", "C17976"],
    ["C17976", "C17976"],
    ["  c1337 ", "C1337"],
  ])("normalizes %j -> %s", (input, expected) => {
    expect(normalizeLcsc(input)).toBe(expected);
  });
});

describe("fetchComponentDetail", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the wmsc endpoint with the normalized part code and browser headers", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ code: 200, result: { stockNumber: 42 } })
    );

    const result = await fetchComponentDetail("17976");

    expect(result).toEqual({ stockNumber: 42 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain(
      "https://wmsc.lcsc.com/ftps/wm/product/detail?productCode=C17976"
    );
    expect((opts as RequestInit).headers).toMatchObject({
      Referer: "https://jlcpcb.com/",
      Accept: "application/json",
    });
  });

  it("returns the result object on a 200 body code", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ code: 200, result: { pdfUrl: "http://x/ds.pdf" } })
    );
    expect(await fetchComponentDetail("C1")).toEqual({ pdfUrl: "http://x/ds.pdf" });
  });

  it("returns null when the body code is not 200", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 404, result: null }));
    expect(await fetchComponentDetail("C1")).toBeNull();
  });

  it("returns null on a non-ok HTTP status", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 500));
    expect(await fetchComponentDetail("C1")).toBeNull();
  });

  it("returns null on a network/timeout error", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    expect(await fetchComponentDetail("C1")).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    expect(await fetchComponentDetail("C1")).toBeNull();
  });
});
