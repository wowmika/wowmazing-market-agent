import {
  fetchResearch,
  isSourceKey,
  ResearchGatewayError,
  SOURCE_CONFIG,
} from "./research";

const MAX_SYMBOL_LENGTH = 32;
const MAX_QUERY_LENGTH = 160;
const MAX_LIMIT = 20;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isValidSymbol(symbol: string): boolean {
  return (
    symbol.length > 0 &&
    symbol.length <= MAX_SYMBOL_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(symbol)
  );
}

function isValidQuery(query: string): boolean {
  return query.length <= MAX_QUERY_LENGTH;
}

function parseLimit(value: string | null): number {
  if (!value) {
    return 10;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return 0;
  }

  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

export interface Env {
  RESEARCH_UPSTREAM_ENABLED?: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return json(
        {
          error: "Method not allowed",
        },
        405,
      );
    }

    if (url.pathname === "/health") {
      return json({
        status: "ok",
        service: "WOWMAZING Research Gateway",
        version: "0.3.0",
        upstream_enabled: env.RESEARCH_UPSTREAM_ENABLED === "true",
      });
    }

    if (url.pathname !== "/v1/research") {
      return json(
        {
          error: "Not found",
        },
        404,
      );
    }

    const source = url.searchParams
      .get("source")
      ?.trim()
      .toLowerCase();

    const symbol = url.searchParams
      .get("symbol")
      ?.trim()
      .toUpperCase();

    const query = url.searchParams
      .get("query")
      ?.trim();

    const limitValue = url.searchParams.get("limit");

    if (!source || !isSourceKey(source)) {
      return json(
        {
          error: "Invalid source",
          allowed_sources: Object.keys(SOURCE_CONFIG),
        },
        400,
      );
    }

    if (!symbol || !isValidSymbol(symbol)) {
      return json(
        {
          error: "Invalid symbol",
        },
        400,
      );
    }

    if (query && !isValidQuery(query)) {
      return json(
        {
          error: "Query is too long",
          max_query_length: MAX_QUERY_LENGTH,
        },
        400,
      );
    }

    const limit = parseLimit(limitValue);

    if (limit === 0) {
      return json(
        {
          error: "Invalid limit",
          max_limit: MAX_LIMIT,
        },
        400,
      );
    }

    if (env.RESEARCH_UPSTREAM_ENABLED !== "true") {
      return json(
        {
          error: "Research upstream is disabled",
        },
        503,
      );
    }

    try {
      const items = await fetchResearch(source, {
        symbol,
        query: query || null,
        limit,
      });

      return json({
        status: "ok",
        source,
        source_name: SOURCE_CONFIG[source].name,
        symbol,
        count: items.length,
        items,
      });
    } catch (error) {
      if (error instanceof ResearchGatewayError) {
        return json(
          {
            error: error.code,
            message: error.message,
          },
          error.status,
        );
      }

      return json(
        {
          error: "RESEARCH_GATEWAY_ERROR",
          message: "Unexpected research gateway failure.",
        },
        500,
      );
    }
  },
} satisfies ExportedHandler<Env>;
