import {
  fetchResearch,
  isSourceKey,
  ResearchGatewayError,
  SOURCE_CONFIG,
  type ResearchBackendEnv,
} from "./research";

const MAX_SYMBOL_LENGTH = 32;
const MAX_QUERY_LENGTH = 160;
const MAX_LIMIT = 20;

function getAllowedOrigins(
  env: Env,
): string[] {
  return (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getCorsOrigin(
  request: Request,
  env: Env,
): string | null {
  const requestOrigin =
    request.headers.get("Origin");

  if (!requestOrigin) {
    return null;
  }

  const allowedOrigins =
    getAllowedOrigins(env);

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

function json(
  data: unknown,
  status = 200,
  corsOrigin?: string | null,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });

  if (corsOrigin) {
    headers.set(
      "Access-Control-Allow-Origin",
      corsOrigin,
    );

    headers.set(
      "Access-Control-Allow-Methods",
      "GET, OPTIONS",
    );

    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type",
    );

    headers.set(
      "Vary",
      "Origin",
    );
  }

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    },
  );
}

function isValidSymbol(
  symbol: string,
): boolean {
  return (
    symbol.length > 0 &&
    symbol.length <= MAX_SYMBOL_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(symbol)
  );
}

function isValidQuery(
  query: string,
): boolean {
  return query.length <= MAX_QUERY_LENGTH;
}

function parseLimit(
  value: string | null,
): number {
  if (!value) {
    return 10;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return 0;
  }

  return Math.min(
    Math.max(parsed, 1),
    MAX_LIMIT,
  );
}

export interface Env
  extends ResearchBackendEnv {
  RESEARCH_UPSTREAM_ENABLED?: string;
  CORS_ORIGINS?: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    const corsOrigin =
      getCorsOrigin(request, env);

    /* ---------------------------------------------------------------------- */
    /* OPTIONS / CORS                                                         */
    /* ---------------------------------------------------------------------- */

    if (request.method === "OPTIONS") {
      if (!corsOrigin) {
        return json(
          {
            error:
              "CORS origin not allowed",
          },
          403,
        );
      }

      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":
            corsOrigin,
          "Access-Control-Allow-Methods":
            "GET, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type",
          "Access-Control-Max-Age":
            "86400",
          Vary: "Origin",
        },
      });
    }

    /* ---------------------------------------------------------------------- */
    /* METHOD GUARD                                                           */
    /* ---------------------------------------------------------------------- */

    if (request.method !== "GET") {
      return json(
        {
          error: "Method not allowed",
        },
        405,
        corsOrigin,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* BROWSER ORIGIN GUARD                                                   */
    /* ---------------------------------------------------------------------- */

    if (
      request.headers.has("Origin") &&
      !corsOrigin
    ) {
      return json(
        {
          error: "CORS origin not allowed",
        },
        403,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* HEALTH                                                                 */
    /* ---------------------------------------------------------------------- */

    if (url.pathname === "/health") {
      return json(
        {
          status: "ok",
          service:
            "WOWMAZING Research Gateway",
          version: "0.5.0",
          upstream_enabled:
            env.RESEARCH_UPSTREAM_ENABLED ===
            "true",
          backend_configured:
            Boolean(
              env.RESEARCH_BACKEND_URL?.trim() &&
              env.RESEARCH_GATEWAY_KEY?.trim(),
            ),
        },
        200,
        corsOrigin,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* RESEARCH ROUTE                                                         */
    /* ---------------------------------------------------------------------- */

    if (url.pathname !== "/v1/research") {
      return json(
        {
          error: "Not found",
        },
        404,
        corsOrigin,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* QUERY PARAMETERS                                                        */
    /* ---------------------------------------------------------------------- */

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

    const limitValue =
      url.searchParams.get("limit");

    /* ---------------------------------------------------------------------- */
    /* SOURCE VALIDATION                                                       */
    /* ---------------------------------------------------------------------- */

    if (
      !source ||
      !isSourceKey(source)
    ) {
      return json(
        {
          error: "Invalid source",
          allowed_sources:
            Object.keys(SOURCE_CONFIG),
        },
        400,
        corsOrigin,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* SYMBOL VALIDATION                                                       */
    /* ---------------------------------------------------------------------- */

    if (
      !symbol ||
      !isValidSymbol(symbol)
    ) {
      return json(
        {
          error: "Invalid symbol",
        },
        400,
        corsOrigin,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* QUERY VALIDATION                                                        */
    /* ---------------------------------------------------------------------- */

    if (
      query &&
      !isValidQuery(query)
    ) {
      return json(
        {
          error: "Query is too long",
          max_query_length:
            MAX_QUERY_LENGTH,
        },
        400,
        corsOrigin,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* LIMIT VALIDATION                                                        */
    /* ---------------------------------------------------------------------- */

    const limit =
      parseLimit(limitValue);

    if (limit === 0) {
      return json(
        {
          error: "Invalid limit",
          max_limit: MAX_LIMIT,
        },
        400,
        corsOrigin,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* UPSTREAM ENABLEMENT                                                     */
    /* ---------------------------------------------------------------------- */

    if (
      env.RESEARCH_UPSTREAM_ENABLED !==
      "true"
    ) {
      return json(
        {
          error:
            "Research upstream is disabled",
        },
        503,
        corsOrigin,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* RESEARCH DISPATCH                                                      */
    /* ---------------------------------------------------------------------- */

    try {
      const items =
        await fetchResearch(
          source,
          {
            symbol,
            query: query || null,
            limit,
          },
          env,
        );

      return json(
        {
          status: "ok",
          source,
          source_name:
            SOURCE_CONFIG[source].name,
          symbol,
          count: items.length,
          items,
        },
        200,
        corsOrigin,
      );
    } catch (error) {
      /* -------------------------------------------------------------------- */
      /* EXPECTED GATEWAY ERRORS                                               */
      /* -------------------------------------------------------------------- */

      if (
        error instanceof
        ResearchGatewayError
      ) {
        return json(
          {
            error: error.code,
            message: error.message,
          },
          error.status,
          corsOrigin,
        );
      }

      /* -------------------------------------------------------------------- */
      /* UNEXPECTED ERROR                                                      */
      /* -------------------------------------------------------------------- */

      return json(
        {
          error:
            "RESEARCH_GATEWAY_ERROR",
          message:
            "Unexpected research gateway failure.",
        },
        500,
        corsOrigin,
      );
    }
  },
};