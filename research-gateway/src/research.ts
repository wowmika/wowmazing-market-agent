export type SourceKey = "nse" | "sebi";

export type ResearchItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  published_at: string | null;
  text: string;
  symbol?: string | null;
  company?: string | null;
  category: string;
};

export const SOURCE_CONFIG = {
  nse: {
    name: "NSE",
    host: "www.nseindia.com",
  },
  sebi: {
    name: "SEBI",
    host: "www.sebi.gov.in",
  },
} as const;

const MAX_RESPONSE_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 5_000;
const RESEARCH_BACKEND_TIMEOUT_MS = 65_000;
const MAX_ITEMS = 20;

export class ResearchGatewayError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ResearchGatewayError";
    this.code = code;
    this.status = status;
  }
}

export function isSourceKey(value: string): value is SourceKey {
  return Object.prototype.hasOwnProperty.call(SOURCE_CONFIG, value);
}

/* -------------------------------------------------------------------------- */
/* XML / TEXT HELPERS                                                         */
/* -------------------------------------------------------------------------- */

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanText(value: string): string {
  return decodeXml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(xml: string, tag: string): string {
  const match = xml.match(
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
      "i",
    ),
  );

  return match ? cleanText(match[1]) : "";
}

/* -------------------------------------------------------------------------- */
/* SEBI RSS PARSER                                                           */
/* -------------------------------------------------------------------------- */

function parseRss(xml: string): ResearchItem[] {
  const itemMatches = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
  ];

  return itemMatches
    .slice(0, MAX_ITEMS)
    .map((match, index) => {
      const itemXml = match[1];

      const title =
        firstTag(itemXml, "title") ||
        "SEBI research update";

      const url = firstTag(itemXml, "link");

      const publishedAt =
        firstTag(itemXml, "pubDate") ||
        firstTag(itemXml, "dc:date") ||
        firstTag(itemXml, "date");

      const description =
        firstTag(itemXml, "description") ||
        firstTag(itemXml, "content:encoded");

      return {
        id: `sebi-rss-${index + 1}-${btoa(
          `${title}|${publishedAt}|${url}`,
        )
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 24)}`,

        title,
        source: "SEBI",
        url,
        published_at: publishedAt || null,
        text: description || title,
        symbol: null,
        company: null,
        category: "regulatory",
      };
    })
    .filter((item) => item.url);
}

/* -------------------------------------------------------------------------- */
/* GENERIC UPSTREAM FETCH GUARD                                               */
/* -------------------------------------------------------------------------- */

async function fetchWithGuards(
  url: string,
  headers: Record<string, string> = {
    Accept:
      "application/rss+xml, application/xml, text/xml, text/plain;q=0.9",
  },
): Promise<string> {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
     RESEARCH_BACKEND_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ResearchGatewayError(
        "UPSTREAM_HTTP_ERROR",
        `Upstream returned HTTP ${response.status}.`,
        502,
      );
    }

    const contentLength = Number(
      response.headers.get("content-length") ?? "0",
    );

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_RESPONSE_BYTES
    ) {
      throw new ResearchGatewayError(
        "UPSTREAM_TOO_LARGE",
        "Upstream response exceeded the size limit.",
        502,
      );
    }

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new ResearchGatewayError(
        "UPSTREAM_TOO_LARGE",
        "Upstream response exceeded the size limit.",
        502,
      );
    }

    return new TextDecoder().decode(bytes);
  } catch (error) {
    if (error instanceof ResearchGatewayError) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new ResearchGatewayError(
        "UPSTREAM_TIMEOUT",
        "Upstream request timed out.",
        504,
      );
    }

    throw new ResearchGatewayError(
      "UPSTREAM_FETCH_FAILED",
      "Unable to fetch the upstream research source.",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* NSE BACKEND CONFIGURATION                                                  */
/* -------------------------------------------------------------------------- */

export type ResearchBackendEnv = {
  RESEARCH_BACKEND_URL?: string;
  RESEARCH_GATEWAY_KEY?: string;
};

/* -------------------------------------------------------------------------- */
/* NSE RESPONSE NORMALIZATION                                                 */
/* -------------------------------------------------------------------------- */

function normalizeBackendNseItems(
  payload: unknown,
  fallbackSymbol: string,
): ResearchItem[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray(
      (payload as { items?: unknown }).items,
    )
  ) {
    throw new ResearchGatewayError(
      "NSE_INVALID_RESPONSE",
      "Research backend returned an unexpected NSE response.",
      502,
    );
  }

  const items =
    (payload as { items: unknown[] }).items;

  return items
    .slice(0, MAX_ITEMS)
    .map((raw, index) => {
      if (!raw || typeof raw !== "object") {
        return null;
      }

      const item = raw as Record<string, unknown>;

      const title =
        typeof item.title === "string" &&
        item.title.trim()
          ? item.title.trim()
          : "NSE corporate announcement";

      const url =
        typeof item.url === "string"
          ? item.url.trim()
          : "";

      const text =
        typeof item.text === "string" &&
        item.text.trim()
          ? item.text.trim()
          : title;

      if (!url) {
        return null;
      }

      return {
        id:
          typeof item.id === "string" &&
          item.id.trim()
            ? item.id.trim()
            : `nse-backend-${index + 1}`,

        title,

        source: "NSE",

        url,

        published_at:
          typeof item.published_at === "string"
            ? item.published_at
            : null,

        text,

        symbol:
          typeof item.symbol === "string" &&
          item.symbol.trim()
            ? item.symbol.trim()
            : fallbackSymbol,

        company:
          typeof item.company === "string"
            ? item.company
            : null,

        category:
          typeof item.category === "string" &&
          item.category.trim()
            ? item.category.trim()
            : title,
      };
    })
    .filter(
      (item): item is ResearchItem =>
        item !== null,
    );
}

/* -------------------------------------------------------------------------- */
/* NSE RESEARCH VIA AUTHENTICATED FASTAPI BACKEND                             */
/* -------------------------------------------------------------------------- */

async function fetchNseResearch(
  symbol: string | null,
  query: string | null,
  limit: number,
  env: ResearchBackendEnv,
): Promise<ResearchItem[]> {
  if (!symbol) {
    throw new ResearchGatewayError(
      "NSE_SYMBOL_REQUIRED",
      "NSE research requires a symbol.",
      400,
    );
  }

  const backendUrl =
    env.RESEARCH_BACKEND_URL?.trim();

  const gatewayKey =
    env.RESEARCH_GATEWAY_KEY?.trim();

  if (!backendUrl || !gatewayKey) {
    throw new ResearchGatewayError(
      "RESEARCH_BACKEND_NOT_CONFIGURED",
      "Research backend configuration is missing.",
      500,
    );
  }

  let url: URL;

  try {
    url = new URL(
      "/research/nse",
      backendUrl,
    );
  } catch {
    throw new ResearchGatewayError(
      "RESEARCH_BACKEND_CONFIG_INVALID",
      "Research backend URL is invalid.",
      500,
    );
  }

  url.searchParams.set(
    "symbol",
    symbol,
  );

  url.searchParams.set(
    "limit",
    String(Math.min(limit, MAX_ITEMS)),
  );

  if (query?.trim()) {
    url.searchParams.set(
      "query",
      query.trim(),
    );
  }

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    UPSTREAM_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Research-Gateway-Key":
            gatewayKey,
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new ResearchGatewayError(
        "UPSTREAM_HTTP_ERROR",
        `Research backend returned HTTP ${response.status}.`,
        502,
      );
    }

    const contentLength = Number(
      response.headers.get(
        "content-length",
      ) ?? "0",
    );

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_RESPONSE_BYTES
    ) {
      throw new ResearchGatewayError(
        "UPSTREAM_TOO_LARGE",
        "Research backend response exceeded the size limit.",
        502,
      );
    }

    const bytes =
      await response.arrayBuffer();

    if (
      bytes.byteLength >
      MAX_RESPONSE_BYTES
    ) {
      throw new ResearchGatewayError(
        "UPSTREAM_TOO_LARGE",
        "Research backend response exceeded the size limit.",
        502,
      );
    }

    let payload: unknown;

    try {
      payload = JSON.parse(
        new TextDecoder().decode(bytes),
      );
    } catch {
      throw new ResearchGatewayError(
        "NSE_INVALID_JSON",
        "Research backend returned invalid JSON.",
        502,
      );
    }

    return normalizeBackendNseItems(
      payload,
      symbol,
    );
  } catch (error) {
    if (
      error instanceof
      ResearchGatewayError
    ) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new ResearchGatewayError(
        "UPSTREAM_TIMEOUT",
        "Research backend request timed out.",
        504,
      );
    }

    throw new ResearchGatewayError(
      "UPSTREAM_FETCH_FAILED",
      "Unable to reach the research backend.",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* MAIN RESEARCH DISPATCH                                                     */
/* -------------------------------------------------------------------------- */

export async function fetchResearch(
  source: SourceKey,
  options: {
    symbol?: string | null;
    query?: string | null;
    limit: number;
  },
  env: ResearchBackendEnv = {},
): Promise<ResearchItem[]> {
  /* ------------------------------------------------------------------------ */
  /* NSE                                                                       */
  /* ------------------------------------------------------------------------ */

  if (source === "nse") {
    return fetchNseResearch(
      options.symbol ?? null,
      options.query ?? null,
      options.limit,
      env,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* SEBI                                                                      */
  /* ------------------------------------------------------------------------ */

  const xml = await fetchWithGuards(
    "https://www.sebi.gov.in/sebirss.xml",
  );

  let items = parseRss(xml);

  const symbol =
    options.symbol?.trim().toLowerCase() ?? "";

  const query =
    options.query?.trim().toLowerCase() ?? "";

  if (symbol || query) {
    items = items.filter((item) => {
      const haystack =
        `${item.title} ${item.text}`.toLowerCase();

      const symbolMatches =
        !symbol || haystack.includes(symbol);

      const queryMatches =
        !query || haystack.includes(query);

      return symbolMatches && queryMatches;
    });
  }

  return items.slice(
    0,
    Math.min(options.limit, MAX_ITEMS),
  );
}