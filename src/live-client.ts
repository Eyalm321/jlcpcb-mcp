/**
 * Live JLCPCB/LCSC product API client.
 *
 * Fetches real-time stock, pricing tiers, datasheet URL, specifications, and
 * images for a single LCSC part. No authentication is required — this is the
 * same endpoint the JLCPCB parts browser uses.
 */

const API_BASE_URL = "https://wmsc.lcsc.com/ftps/wm/product/detail";
const REQUEST_TIMEOUT_MS = 10_000;

export interface LivePriceTier {
  /** Quantity threshold at which this unit price applies. */
  ladder: number;
  /** Unit price in USD at this quantity tier. */
  usdPrice: number;
  /** Unit price in the account's local currency, when provided. */
  currencyPrice?: number;
}

export interface LiveParam {
  paramNameEn?: string;
  paramValueEn?: string;
}

export interface LiveComponentDetail {
  productCode?: string;
  productModel?: string;
  /** Current total available stock. */
  stockNumber?: number;
  /** Quantity-break pricing tiers. */
  productPriceList?: LivePriceTier[];
  /** Datasheet PDF URL. */
  pdfUrl?: string;
  /** Parametric specifications (English names/values). */
  paramVOList?: LiveParam[];
  /** Product image URLs. */
  productImages?: string[];
  [key: string]: unknown;
}

/**
 * Normalize an LCSC part number to the canonical `C#####` form.
 * Accepts `"17976"`, `"c17976"`, or `"C17976"`.
 */
export function normalizeLcsc(lcsc: string): string {
  const s = lcsc.trim().toUpperCase();
  return s.startsWith("C") ? s : `C${s}`;
}

/**
 * Fetch live component details for an LCSC part number.
 *
 * Returns the API `result` object, or `null` when the part is unknown or the
 * request fails (network error, non-200 HTTP status, non-200 body code,
 * timeout, or malformed JSON). Callers treat `null` as "no live data" and
 * fall back to catalog values.
 */
export async function fetchComponentDetail(
  lcsc: string
): Promise<LiveComponentDetail | null> {
  const code = normalizeLcsc(lcsc);
  const url = `${API_BASE_URL}?productCode=${encodeURIComponent(code)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
        Referer: "https://jlcpcb.com/",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      code?: number;
      result?: LiveComponentDetail;
    };

    if (data && data.code === 200 && data.result) {
      return data.result;
    }
    return null;
  } catch {
    // Network failure, timeout, or malformed JSON — treat as "no live data".
    return null;
  }
}
