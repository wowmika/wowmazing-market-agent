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

describe("research gateway HTTP boundary", () => {
  it("returns a healthy response", async () => {
    const response = await worker.fetch(
      request("/health"),
      {
        RESEARCH_UPSTREAM_ENABLED: "false",
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body).toMatchObject({
      status: "ok",
      service: "WOWMAZING Research Gateway",
      version: "0.4.0",
      upstream_enabled: false,
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
        RESEARCH_UPSTREAM_ENABLED: "false",
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
        RESEARCH_UPSTREAM_ENABLED: "false",
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
      {
        RESEARCH_UPSTREAM_ENABLED: "true",
      },
    );

    expect(response.status).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("Invalid source");
  });

  it("rejects invalid symbols", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=sebi&symbol=INVALID%20SYMBOL",
      ),
      {
        RESEARCH_UPSTREAM_ENABLED: "true",
      },
    );

    expect(response.status).toBe(400);
  });

  it("rejects oversized queries", async () => {
    const query = "x".repeat(161);

    const response = await worker.fetch(
      request(
        `/v1/research?source=sebi&symbol=RELIANCE&query=${query}`,
      ),
      {
        RESEARCH_UPSTREAM_ENABLED: "true",
      },
    );

    expect(response.status).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("Query is too long");
  });

  it("rejects invalid limits", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=sebi&symbol=RELIANCE&limit=abc",
      ),
      {
        RESEARCH_UPSTREAM_ENABLED: "true",
      },
    );

    expect(response.status).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("Invalid limit");
  });

  it("blocks research when upstream access is disabled", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=sebi&symbol=RELIANCE",
      ),
      {
        RESEARCH_UPSTREAM_ENABLED: "false",
      },
    );

    expect(response.status).toBe(503);

    const body = await response.json();

    expect(body.error).toBe(
      "Research upstream is disabled",
    );
  });

  it("fetches and normalizes NSE corporate announcements", async () => {
    const nsePayload = [
      {
        an_dt: "01-Oct-2026 15:02:20",
        attchmntFile:
          "https://www.nseindia.com/api/corporate-announcements/attachment/106804744",
        attchmntText:
          "Allotment of 13,00,000 non-convertible debentures.",
        desc: "Allotment of Securities",
        seq_id: "106804744",
        sm_isin: "INE002A01018",
        sm_name: "RELIANCE INDUSTRIES LIMITED",
        sort_date: "2026-10-01 15:02:20",
        symbol: "RELIANCE",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(nsePayload),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const response = await worker.fetch(
      request(
        "/v1/research?source=nse&symbol=RELIANCE&limit=5",
      ),
      {
        RESEARCH_UPSTREAM_ENABLED: "true",
      },
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
      title: "Allotment of Securities",
      source: "NSE",
      symbol: "RELIANCE",
      company: "RELIANCE INDUSTRIES LIMITED",
      category: "Allotment of Securities",
    });

    expect(body.items[0].text).toContain(
      "Allotment of 13,00,000 non-convertible debentures.",
    );

    expect(
      body.items[0].published_at,
    ).toBe("2026-10-01 15:02:20");
  });

  it("filters NSE announcements by query", async () => {
    const nsePayload = [
      {
        an_dt: "01-Oct-2026 15:02:20",
        attchmntFile:
          "https://www.nseindia.com/example/1",
        attchmntText:
          "Allotment of securities announcement.",
        desc: "Allotment of Securities",
        seq_id: "100001",
        sm_name: "RELIANCE INDUSTRIES LIMITED",
        sort_date: "2026-10-01 15:02:20",
        symbol: "RELIANCE",
      },
      {
        an_dt: "30-Sep-2026 17:19:17",
        attchmntFile:
          "https://www.nseindia.com/example/2",
        attchmntText:
          "Trading window closure announcement.",
        desc: "Trading Window",
        seq_id: "100002",
        sm_name: "RELIANCE INDUSTRIES LIMITED",
        sort_date: "2026-09-30 17:19:17",
        symbol: "RELIANCE",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(nsePayload),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const items = await fetchResearch("nse", {
      symbol: "RELIANCE",
      query: "Trading Window",
      limit: 5,
    });

    expect(items).toHaveLength(1);

    expect(items[0]).toMatchObject({
      id: "nse-100002",
      title: "Trading Window",
      symbol: "RELIANCE",
      source: "NSE",
    });
  });

  it("converts NSE upstream HTTP failures into a controlled 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("upstream failure", {
          status: 500,
        }),
      ),
    );

    await expect(
      fetchResearch("nse", {
        symbol: "RELIANCE",
        query: null,
        limit: 5,
      }),
    ).rejects.toMatchObject<
      Partial<ResearchGatewayError>
    >({
      code: "UPSTREAM_HTTP_ERROR",
      status: 502,
    });
  });

  it("rejects oversized NSE upstream responses", async () => {
    const oversized = new Uint8Array(
      256 * 1024 + 1,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(oversized, {
          status: 200,
        }),
      ),
    );

    await expect(
      fetchResearch("nse", {
        symbol: "RELIANCE",
        query: null,
        limit: 5,
      }),
    ).rejects.toMatchObject<
      Partial<ResearchGatewayError>
    >({
      code: "UPSTREAM_TOO_LARGE",
      status: 502,
    });
  });

  it("rejects unsupported methods", async () => {
    const response = await worker.fetch(
      request("/health", {
        method: "POST",
      }),
      {
        RESEARCH_UPSTREAM_ENABLED: "false",
      },
    );

    expect(response.status).toBe(405);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(
      request("/does-not-exist"),
      {
        RESEARCH_UPSTREAM_ENABLED: "false",
      },
    );

    expect(response.status).toBe(404);
  });
});

describe("SEBI upstream protection", () => {
  it("converts upstream HTTP failures into a controlled 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("upstream failure", {
          status: 500,
        }),
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
      code: "UPSTREAM_HTTP_ERROR",
      status: 502,
    });
  });

  it("rejects oversized upstream responses", async () => {
    const oversized = new Uint8Array(
      256 * 1024 + 1,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(oversized, {
          status: 200,
        }),
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
      code: "UPSTREAM_TOO_LARGE",
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
        new Response(rss, {
          status: 200,
          headers: {
            "content-type":
              "application/rss+xml",
          },
        }),
      ),
    );

    const items = await fetchResearch("sebi", {
      symbol: "RELIANCE",
      query: null,
      limit: 5,
    });

    expect(items).toHaveLength(1);

    expect(items[0]).toMatchObject({
      source: "SEBI",
      title: "Reliance regulatory update",
      url:
        "https://www.sebi.gov.in/example",
      category: "regulatory",
      symbol: null,
    });
  });
});