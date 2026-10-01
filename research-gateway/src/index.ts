const ALLOWED_SOURCES = {
  nse: {
    name: "NSE",
    host: "www.nseindia.com",
  },
  sebi: {
    name: "SEBI",
    host: "www.sebi.gov.in",
  },
} as const;

type SourceKey = keyof typeof ALLOWED_SOURCES;

const MAX_SYMBOL_LENGTH = 32;
const MAX_LIMIT = 20;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isSourceKey(value: string): value is SourceKey {
  return Object.prototype.hasOwnProperty.call(ALLOWED_SOURCES, value);
}

function isValidSymbol(symbol: string): boolean {
  return (
    symbol.length > 0 &&
    symbol.length <= MAX_SYMBOL_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(symbol)
  );
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

export interface Env {}

export default {
  async fetch(
    request: Request,
    _env: Env,
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
        version: "0.2.0",
      });
    }

    if (url.pathname === "/v1/research") {
      const source = url.searchParams
        .get("source")
        ?.trim()
        .toLowerCase();

      const symbol = url.searchParams
        .get("symbol")
        ?.trim()
        .toUpperCase();

      const limitValue = url.searchParams.get("limit");

      if (!source || !isSourceKey(source)) {
        return json(
          {
            error: "Invalid source",
            allowed_sources: Object.keys(ALLOWED_SOURCES),
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

      return json({
        status: "accepted",
        source,
        source_name: ALLOWED_SOURCES[source].name,
        symbol,
        limit,
        upstream_host: ALLOWED_SOURCES[source].host,
        message: "Research fetch is not enabled yet.",
      });
    }

    return json(
      {
        error: "Not found",
      },
      404,
    );
  },
} satisfies ExportedHandler<Env>;

