import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import worker from "./index";

import {
  fetchResearch,
  ResearchGatewayError,
} from "./research";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const request = (
  path: string,
  init?: RequestInit,
) =>
  new Request(
    `http://localhost:8787${path}`,
    init,
  );

const TEST_BACKEND_URL =
  "https://wowmazing-market-agent-api.onrender.com";

const TEST_GATEWAY_KEY =
  "test-research-gateway-key";

const TEST_ENV = {
  RESEARCH_UPSTREAM_ENABLED: "true",
  RESEARCH_BACKEND_URL:
    TEST_BACKEND_URL,
  RESEARCH_GATEWAY_KEY:
    TEST_GATEWAY_KEY,
};

/* -------------------------------------------------------------------------- */
/* RESEARCH GATEWAY HTTP BOUNDARY                                             */
/* -------------------------------------------------------------------------- */

describe("research gateway HTTP boundary", () => {
  it("returns a healthy response", async () => {
    const response = await worker.fetch(
      request("/health"),
      {
        RESEARCH_UPSTREAM_ENABLED:
          "false",
        RESEARCH_BACKEND_URL:
          TEST_BACKEND_URL,
        RESEARCH_GATEWAY_KEY:
          TEST_GATEWAY_KEY,
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body).toMatchObject({
      status: "ok",
      service:
        "WOWMAZING Research Gateway",
      version: "0.5.0",
      upstream_enabled: false,
      backend_configured: true,
    });
  });

  it("allows configured browser origins", async () => {
    const response = await worker.fetch(
      new Request(
        "http://localhost:8787/health",
        {
          headers: {
            Origin:
              "https://market.wowmazingstudios.com",
          },
        },
      ),
      {
        RESEARCH_UPSTREAM_ENABLED:
          "false",
        RESEARCH_BACKEND_URL:
          TEST_BACKEND_URL,
        RESEARCH_GATEWAY_KEY:
          TEST_GATEWAY_KEY,
        CORS_ORIGINS:
          "https://market.wowmazingstudios.com",
      },
    );

    expect(response.status).toBe(200);

    expect(
      response.headers.get(
        "Access-Control-Allow-Origin",
      ),
    ).toBe(
      "https://market.wowmazingstudios.com",
    );
  });

  it("rejects unconfigured browser origins", async () => {
    const response = await worker.fetch(
      new Request(
        "http://localhost:8787/health",
        {
          headers: {
            Origin:
              "https://evil.example.com",
          },
        },
      ),
      {
        RESEARCH_UPSTREAM_ENABLED:
          "false",
        RESEARCH_BACKEND_URL:
          TEST_BACKEND_URL,
        RESEARCH_GATEWAY_KEY:
          TEST_GATEWAY_KEY,
        CORS_ORIGINS:
          "https://market.wowmazingstudios.com",
      },
    );

    expect(response.status).toBe(403);
  });

  it("rejects unsupported sources", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=google&symbol=RELIANCE",
      ),
      TEST_ENV,
    );

    expect(response.status).toBe(400);

    const body = await response.json();

    expect(body.error).toBe(
      "Invalid source",
    );
  });

  it("rejects invalid symbols", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=sebi&symbol=INVALID%20SYMBOL",
      ),
      TEST_ENV,
    );

    expect(response.status).toBe(400);
  });

  it("rejects oversized queries", async () => {
    const query = "x".repeat(161);

    const response = await worker.fetch(
      request(
        `/v1/research?source=sebi&symbol=RELIANCE&query=${query}`,
      ),
      TEST_ENV,
    );

    expect(response.status).toBe(400);

    const body = await response.json();

    expect(body.error).toBe(
      "Query is too long",
    );
  });

  it("rejects invalid limits", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=sebi&symbol=RELIANCE&limit=abc",
      ),
      TEST_ENV,
    );

    expect(response.status).toBe(400);

    const body = await response.json();

    expect(body.error).toBe(
      "Invalid limit",
    );
  });

  it("blocks research when upstream access is disabled", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=sebi&symbol=RELIANCE",
      ),
      {
        RESEARCH_UPSTREAM_ENABLED:
          "false",
        RESEARCH_BACKEND_URL:
          TEST_BACKEND_URL,
        RESEARCH_GATEWAY_KEY:
          TEST_GATEWAY_KEY,
      },
    );

    expect(response.status).toBe(503);

    const body = await response.json();

    expect(body.error).toBe(
      "Research upstream is disabled",
    );
  });

  it("fetches and normalizes NSE announcements from the research backend", async () => {
    const backendPayload = {
      success: true,
      source: "nse",
      source_name: "NSE",
      symbol: "RELIANCE",
      count: 1,
      items: [
        {
          id: "nse-106804744",
          title:
            "Allotment of Securities",
          source: "NSE",
          url:
            "https://nsearchives.nseindia.com/example/106804744.pdf",
          published_at:
            "2026-10-01 15:02:20",
          text:
            "Allotment of 13,00,000 non-convertible debentures.",
          symbol: "RELIANCE",
          company:
            "RELIANCE INDUSTRIES LIMITED",
          category:
            "Allotment of Securities",
        },
      ],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify(
            backendPayload,
          ),
          {
            status: 200,
            headers: {
              "content-type":
                "application/json",
            },
          },
        ),
      );

    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    const response = await worker.fetch(
      request(
        "/v1/research?source=nse&symbol=RELIANCE&limit=5",
      ),
      TEST_ENV,
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body).toMatchObject({
      status: "ok",
      source: "nse",
      source_name: "NSE",
      symbol: "RELIANCE",
      count: 1,
    });

    expect(body.items[0]).toMatchObject({
      id: "nse-106804744",
      title:
        "Allotment of Securities",
      source: "NSE",
      symbol: "RELIANCE",
      company:
        "RELIANCE INDUSTRIES LIMITED",
      category:
        "Allotment of Securities",
    });

    expect(
      body.items[0].text,
    ).toContain(
      "Allotment of 13,00,000 non-convertible debentures.",
    );

    expect(
      body.items[0].published_at,
    ).toBe(
      "2026-10-01 15:02:20",
    );

    expect(fetchMock).toHaveBeenCalledTimes(
      1,
    );

    const [calledUrl, calledOptions] =
      fetchMock.mock.calls[0];

    expect(String(calledUrl)).toBe(
      `${TEST_BACKEND_URL}/research/nse?symbol=RELIANCE&limit=5`,
    );

    expect(
      (
        calledOptions as RequestInit
      )?.headers,
    ).toMatchObject({
      Accept: "application/json",
      "X-Research-Gateway-Key":
        TEST_GATEWAY_KEY,
    });
  });
  it("forwards NSE query to the research backend", async () => {
    const backendPayload = {
      success: true,
      source: "nse",
      source_name: "NSE",
      symbol: "RELIANCE",
      count: 2,
      items: [
        {
          id: "nse-100001",
          title:
            "Allotment of Securities",
          source: "NSE",
          url:
            "https://www.nseindia.com/example/1",
          published_at:
            "2026-10-01 15:02:20",
          text:
            "Allotment of securities announcement.",
          symbol: "RELIANCE",
          company:
            "RELIANCE INDUSTRIES LIMITED",
          category:
            "Allotment of Securities",
        },
        {
          id: "nse-100002",
          title: "Trading Window",
          source: "NSE",
          url:
            "https://www.nseindia.com/example/2",
          published_at:
            "2026-09-30 17:19:17",
          text:
            "Trading window closure announcement.",
          symbol: "RELIANCE",
          company:
            "RELIANCE INDUSTRIES LIMITED",
          category: "Trading Window",
        },
      ],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify(
            backendPayload,
          ),
          {
            status: 200,
            headers: {
              "content-type":
                "application/json",
            },
          },
        ),
      );

    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    const items =
      await fetchResearch(
        "nse",
        {
          symbol: "RELIANCE",
          query: "Trading Window",
          limit: 5,
        },
        {
          RESEARCH_BACKEND_URL:
            TEST_BACKEND_URL,
          RESEARCH_GATEWAY_KEY:
            TEST_GATEWAY_KEY,
        },
      );

    expect(items).toHaveLength(2);

    /*
     * Query filtering is authoritative in
     * the Render backend. The Worker
     * forwards the query unchanged.
     */
    expect(
      fetchMock,
    ).toHaveBeenCalledTimes(1);

    const [
      calledUrl,
      calledOptions,
    ] = fetchMock.mock.calls[0];

    expect(String(calledUrl)).toBe(
      `${TEST_BACKEND_URL}/research/nse?symbol=RELIANCE&limit=5&query=Trading+Window`,
    );

    expect(
      (
        calledOptions as RequestInit
      )?.headers,
    ).toMatchObject({
      "X-Research-Gateway-Key":
        TEST_GATEWAY_KEY,
    });
  });

  it("converts research backend HTTP failures into a controlled 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          "backend failure",
          {
            status: 500,
          },
        ),
      ),
    );

    await expect(
      fetchResearch(
        "nse",
        {
          symbol: "RELIANCE",
          query: null,
          limit: 5,
        },
        {
          RESEARCH_BACKEND_URL:
            TEST_BACKEND_URL,
          RESEARCH_GATEWAY_KEY:
            TEST_GATEWAY_KEY,
        },
      ),
    ).rejects.toMatchObject<
      Partial<ResearchGatewayError>
    >({
      code:
        "UPSTREAM_HTTP_ERROR",
      status: 502,
    });
  });

  it("rejects oversized research backend responses", async () => {
    const oversized =
      new Uint8Array(
        256 * 1024 + 1,
      );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          oversized,
          {
            status: 200,
          },
        ),
      ),
    );

    await expect(
      fetchResearch(
        "nse",
        {
          symbol: "RELIANCE",
          query: null,
          limit: 5,
        },
        {
          RESEARCH_BACKEND_URL:
            TEST_BACKEND_URL,
          RESEARCH_GATEWAY_KEY:
            TEST_GATEWAY_KEY,
        },
      ),
    ).rejects.toMatchObject<
      Partial<ResearchGatewayError>
    >({
      code:
        "UPSTREAM_TOO_LARGE",
      status: 502,
    });
  });

  it("rejects missing NSE backend configuration", async () => {
    await expect(
      fetchResearch("nse", {
        symbol: "RELIANCE",
        query: null,
        limit: 5,
      }),
    ).rejects.toMatchObject<
      Partial<ResearchGatewayError>
    >({
      code:
        "RESEARCH_BACKEND_NOT_CONFIGURED",
      status: 500,
    });
  });

  it("rejects unsupported methods", async () => {
    const response = await worker.fetch(
      request("/health", {
        method: "POST",
      }),
      {
        RESEARCH_UPSTREAM_ENABLED:
          "false",
        RESEARCH_BACKEND_URL:
          TEST_BACKEND_URL,
        RESEARCH_GATEWAY_KEY:
          TEST_GATEWAY_KEY,
      },
    );

    expect(response.status).toBe(405);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(
      request("/does-not-exist"),
      {
        RESEARCH_UPSTREAM_ENABLED:
          "false",
        RESEARCH_BACKEND_URL:
          TEST_BACKEND_URL,
        RESEARCH_GATEWAY_KEY:
          TEST_GATEWAY_KEY,
      },
    );

    expect(response.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* SEBI UPSTREAM PROTECTION                                                   */
/* -------------------------------------------------------------------------- */

describe("SEBI upstream protection", () => {
  it("converts upstream HTTP failures into a controlled 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          "upstream failure",
          {
            status: 500,
          },
        ),
      ),
    );

    await expect(
      fetchResearch("sebi", {
        symbol: "RELIANCE",
        query: null,
        limit: 5,
      }),
    ).rejects.toMatchObject<
      Partial<ResearchGatewayError>
    >({
      code:
        "UPSTREAM_HTTP_ERROR",
      status: 502,
    });
  });

  it("rejects oversized upstream responses", async () => {
    const oversized =
      new Uint8Array(
        256 * 1024 + 1,
      );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          oversized,
          {
            status: 200,
          },
        ),
      ),
    );

    await expect(
      fetchResearch("sebi", {
        symbol: "RELIANCE",
        query: null,
        limit: 5,
      }),
    ).rejects.toMatchObject<
      Partial<ResearchGatewayError>
    >({
      code:
        "UPSTREAM_TOO_LARGE",
      status: 502,
    });
  });

  it("normalizes a valid SEBI RSS response", async () => {
    const rss = `
      <rss>
        <channel>
          <item>
            <title>Reliance regulatory update</title>
            <link>https://www.sebi.gov.in/example</link>
            <pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate>
            <description><![CDATA[
              Regulatory information related to Reliance.
            ]]></description>
          </item>
        </channel>
      </rss>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          rss,
          {
            status: 200,
            headers: {
              "content-type":
                "application/rss+xml",
            },
          },
        ),
      ),
    );

    const items =
      await fetchResearch("sebi", {
        symbol: "RELIANCE",
        query: null,
        limit: 5,
      });

    expect(items).toHaveLength(1);

    expect(items[0]).toMatchObject({
      source: "SEBI",
      title:
        "Reliance regulatory update",
      url:
        "https://www.sebi.gov.in/example",
      category: "regulatory",
      symbol: null,
    });
  });
});