import { describe, expect, it, vi, afterEach } from "vitest";
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
      { RESEARCH_UPSTREAM_ENABLED: "false" },
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body).toMatchObject({
      status: "ok",
      service: "WOWMAZING Research Gateway",
      version: "0.3.0",
      upstream_enabled: false,
    });
  });

  it("rejects unsupported sources", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=google&symbol=RELIANCE",
      ),
      { RESEARCH_UPSTREAM_ENABLED: "true" },
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
      { RESEARCH_UPSTREAM_ENABLED: "true" },
    );

    expect(response.status).toBe(400);
  });

  it("rejects oversized queries", async () => {
    const query = "x".repeat(161);

    const response = await worker.fetch(
      request(
        `/v1/research?source=sebi&symbol=RELIANCE&query=${query}`,
      ),
      { RESEARCH_UPSTREAM_ENABLED: "true" },
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
      { RESEARCH_UPSTREAM_ENABLED: "true" },
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
      { RESEARCH_UPSTREAM_ENABLED: "false" },
    );

    expect(response.status).toBe(503);

    const body = await response.json();

    expect(body.error).toBe(
      "Research upstream is disabled",
    );
  });

  it("keeps NSE disabled until its adapter is implemented", async () => {
    const response = await worker.fetch(
      request(
        "/v1/research?source=nse&symbol=RELIANCE",
      ),
      { RESEARCH_UPSTREAM_ENABLED: "true" },
    );

    expect(response.status).toBe(501);

    const body = await response.json();

    expect(body.error).toBe("NSE_ADAPTER_PENDING");
  });

  it("rejects unsupported methods", async () => {
    const response = await worker.fetch(
      request("/health", { method: "POST" }),
      { RESEARCH_UPSTREAM_ENABLED: "false" },
    );

    expect(response.status).toBe(405);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(
      request("/does-not-exist"),
      { RESEARCH_UPSTREAM_ENABLED: "false" },
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
    ).rejects.toMatchObject<Partial<ResearchGatewayError>>({
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
    ).rejects.toMatchObject<Partial<ResearchGatewayError>>({
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
            "content-type": "application/rss+xml",
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
      url: "https://www.sebi.gov.in/example",
      category: "regulatory",
      symbol: null,
    });
  });
});
