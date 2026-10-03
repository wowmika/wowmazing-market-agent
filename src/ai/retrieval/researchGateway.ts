import { RESEARCH_GATEWAY_URL } from "../../config";

export type ResearchGatewayItem = {
  id: string;
  title: string;
  text: string;
  source: string;
  url?: string | null;
  published_at?: string | null;
};

type ResearchGatewayResponse = {
  status?: string;
  source?: string;
  source_name?: string;
  symbol?: string;
  count?: number;
  items?: unknown;
  error?: string;
  message?: string;
};

export type ResearchGatewayResearch = ResearchGatewayItem[];

// Render free-tier cold starts can take tens of seconds.
// Keep this above the Worker -> Render backend timeout.
const REQUEST_TIMEOUT_MS = 70_000;

const MAX_LIMIT = 20;

function normalizeItem(
  value: unknown,
): ResearchGatewayItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item =
    value as Record<string, unknown>;

  const id =
    String(item.id ?? "").trim();

  const title =
    String(item.title ?? "").trim();

  const text =
    String(item.text ?? "").trim();

  if (!id || !title || !text) {
    return null;
  }

  const source =
    String(item.source ?? "NSE").trim() ||
    "NSE";

  return {
    id,
    title,
    text,
    source,
    url:
      typeof item.url === "string" &&
      item.url.trim()
        ? item.url.trim()
        : null,
    published_at:
      typeof item.published_at === "string" &&
      item.published_at.trim()
        ? item.published_at.trim()
        : null,
  };
}

export async function fetchNseResearch(
  symbol: string,
  query?: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<ResearchGatewayResearch> {
  const cleanSymbol =
    symbol.trim();

  const cleanQuery =
    query?.trim() || "";

  if (!cleanSymbol) {
    return [];
  }

  const boundedLimit =
    Math.max(
      1,
      Math.min(
        MAX_LIMIT,
        Math.floor(limit),
      ),
    );

  const url =
    new URL(
      "/v1/research",
      RESEARCH_GATEWAY_URL,
    );

  url.searchParams.set(
    "source",
    "nse",
  );

  url.searchParams.set(
    "symbol",
    cleanSymbol,
  );

  url.searchParams.set(
    "limit",
    String(boundedLimit),
  );

  if (cleanQuery) {
    url.searchParams.set(
      "query",
      cleanQuery,
    );
  }

  const controller =
    new AbortController();

  const timeoutId =
    window.setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

  const onAbort =
    () =>
      controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener(
      "abort",
      onAbort,
      {
        once: true,
      },
    );
  }

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          headers: {
            Accept:
              "application/json",
          },
          signal:
            controller.signal,
        },
      );

    let payload: ResearchGatewayResponse =
      {};

    try {
      payload =
        (await response.json()) as ResearchGatewayResponse;
    } catch {
      throw new Error(
        `Research gateway returned a non-JSON response (HTTP ${response.status}).`,
      );
    }

    if (!response.ok) {
      throw new Error(
        payload.message ||
          payload.error ||
          `Research gateway returned HTTP ${response.status}.`,
      );
    }

    if (!Array.isArray(payload.items)) {
      throw new Error(
        "Research gateway returned an invalid response.",
      );
    }

    return payload.items
      .map(normalizeItem)
      .filter(
        (
          item,
        ): item is ResearchGatewayItem =>
          item !== null,
      );
  } finally {
    window.clearTimeout(
      timeoutId,
    );

    signal?.removeEventListener(
      "abort",
      onAbort,
    );
  }
}