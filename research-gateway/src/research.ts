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
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"),
  );

  return match ? cleanText(match[1]) : "";
}

function parseRss(xml: string): ResearchItem[] {
  const itemMatches = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];

  return itemMatches.slice(0, MAX_ITEMS).map((match, index) => {
    const itemXml = match[1];

    const title = firstTag(itemXml, "title") || "SEBI research update";
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
      ).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
      title,
      source: "SEBI",
      url,
      published_at: publishedAt || null,
      text: description || title,
      symbol: null,
      company: null,
      category: "regulatory",
    };
  }).filter((item) => item.url);
}

async function fetchWithGuards(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    UPSTREAM_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, text/plain;q=0.9",
      },
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

    if (error instanceof Error && error.name === "AbortError") {
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

export async function fetchResearch(
  source: SourceKey,
  options: {
    symbol?: string | null;
    query?: string | null;
    limit: number;
  },
): Promise<ResearchItem[]> {
  if (source === "nse") {
    throw new ResearchGatewayError(
      "NSE_ADAPTER_PENDING",
      "NSE research adapter is not enabled yet.",
      501,
    );
  }

  const xml = await fetchWithGuards(
    "https://www.sebi.gov.in/sebirss.xml",
  );

  let items = parseRss(xml);

  const searchText = `${options.symbol ?? ""} ${options.query ?? ""}`
    .trim()
    .toLowerCase();

  if (searchText) {
    items = items.filter((item) => {
      const haystack =
        `${item.title} ${item.text}`.toLowerCase();

      return haystack.includes(searchText);
    });
  }

  return items.slice(0, options.limit);
}
