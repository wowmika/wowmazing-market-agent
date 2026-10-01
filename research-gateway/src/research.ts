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
    UPSTREAM_TIMEOUT_MS,
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
/* NSE HELPERS                                                                */
/* -------------------------------------------------------------------------- */

/**
 * NSE expects dates in DD-MM-YYYY format.
 *
 * We deliberately use Asia/Kolkata rather than the Worker runtime timezone.
 */
function getNseDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const day =
    parts.find((part) => part.type === "day")?.value ?? "";

  const month =
    parts.find((part) => part.type === "month")?.value ?? "";

  const year =
    parts.find((part) => part.type === "year")?.value ?? "";

  return `${day}-${month}-${year}`;
}

function getNseDateRange(): {
  fromDate: string;
  toDate: string;
} {
  const now = new Date();

  const previousDay = new Date(
    now.getTime() - 24 * 60 * 60 * 1000,
  );

  return {
    fromDate: getNseDateString(previousDay),
    toDate: getNseDateString(now),
  };
}

/* -------------------------------------------------------------------------- */
/* NSE CORPORATE ANNOUNCEMENT TYPES                                           */
/* -------------------------------------------------------------------------- */

type NseAnnouncement = {
  an_dt?: string;
  attchmntFile?: string;
  attchmntText?: string;
  desc?: string;
  seq_id?: string;
  sm_isin?: string;
  sm_name?: string;
  sort_date?: string;
  symbol?: string;
};

/* -------------------------------------------------------------------------- */
/* NSE RESPONSE NORMALIZATION                                                 */
/* -------------------------------------------------------------------------- */

function parseNseAnnouncements(
  payload: unknown,
  fallbackSymbol: string | null,
): ResearchItem[] {
  if (!Array.isArray(payload)) {
    throw new ResearchGatewayError(
      "NSE_INVALID_RESPONSE",
      "NSE returned an unexpected response format.",
      502,
    );
  }

  return payload
    .slice(0, MAX_ITEMS)
    .map((item, index) => {
      const announcement = item as NseAnnouncement;

      const title =
        announcement.desc?.trim() ||
        "NSE corporate announcement";

      const publishedAt =
        announcement.sort_date?.trim() ||
        announcement.an_dt?.trim() ||
        null;

      const symbol =
        announcement.symbol?.trim() ||
        fallbackSymbol;

      const company =
        announcement.sm_name?.trim() ||
        null;

      const text =
        announcement.attchmntText?.trim() ||
        title;

      const url =
        announcement.attchmntFile?.trim() ||
        "https://www.nseindia.com/companies-listing/corporate-filings-announcements";

      const id =
        announcement.seq_id?.trim()
          ? `nse-${announcement.seq_id.trim()}`
          : `nse-${index + 1}-${btoa(
              `${title}|${publishedAt ?? ""}|${symbol ?? ""}`,
            )
              .replace(/[^a-zA-Z0-9]/g, "")
              .slice(0, 24)}`;

      return {
        id,
        title,
        source: "NSE",
        url,
        published_at: publishedAt,
        text,
        symbol,
        company,
        category: title,
      };
    })
    .filter((item) => item.url);
}

/* -------------------------------------------------------------------------- */
/* NSE CORPORATE ANNOUNCEMENT FETCH                                           */
/* -------------------------------------------------------------------------- */

async function fetchNseResearch(
  symbol: string | null,
  query: string | null,
  limit: number,
): Promise<ResearchItem[]> {
  if (!symbol) {
    throw new ResearchGatewayError(
      "NSE_SYMBOL_REQUIRED",
      "NSE research requires a symbol.",
      400,
    );
  }

  const { fromDate, toDate } = getNseDateRange();

  const params = new URLSearchParams({
    index: "equities",
    from_date: fromDate,
    to_date: toDate,
    symbol,
  });

  const url =
    `https://www.nseindia.com/api/corporate-announcements?${params.toString()}`;

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    UPSTREAM_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent":
          "Mozilla/5.0 (compatible; WowmazingResearchGateway/1.0)",
        Referer:
          "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ResearchGatewayError(
        "UPSTREAM_HTTP_ERROR",
        `NSE returned HTTP ${response.status}.`,
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
        "NSE response exceeded the size limit.",
        502,
      );
    }

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new ResearchGatewayError(
        "UPSTREAM_TOO_LARGE",
        "NSE response exceeded the size limit.",
        502,
      );
    }

    const text = new TextDecoder().decode(bytes);

    let payload: unknown;

    try {
      payload = JSON.parse(text);
    } catch {
      throw new ResearchGatewayError(
        "NSE_INVALID_JSON",
        "NSE returned invalid JSON.",
        502,
      );
    }

    let items = parseNseAnnouncements(
      payload,
      symbol,
    );

    const normalizedQuery =
      query?.trim().toLowerCase() ?? "";

    if (normalizedQuery) {
      items = items.filter((item) => {
        const haystack = [
          item.title,
          item.text,
          item.category,
          item.company ?? "",
          item.symbol ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      });
    }

    return items.slice(0, Math.min(limit, MAX_ITEMS));
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
        "NSE request timed out.",
        504,
      );
    }

    throw new ResearchGatewayError(
      "UPSTREAM_FETCH_FAILED",
      "Unable to fetch NSE corporate announcements.",
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
): Promise<ResearchItem[]> {
  /* ------------------------------------------------------------------------ */
  /* NSE                                                                     */
  /* ------------------------------------------------------------------------ */

  if (source === "nse") {
    return fetchNseResearch(
      options.symbol ?? null,
      options.query ?? null,
      options.limit,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* SEBI                                                                    */
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

  return items.slice(0, Math.min(options.limit, MAX_ITEMS));
}