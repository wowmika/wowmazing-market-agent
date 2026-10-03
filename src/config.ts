const configuredApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (
  configuredApiBaseUrl ||
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const configuredResearchGatewayUrl =
  import.meta.env.VITE_RESEARCH_GATEWAY_URL?.trim();

export const RESEARCH_GATEWAY_URL = (
  configuredResearchGatewayUrl ||
  "https://research.market.wowmazingstudios.com"
).replace(/\/+$/, "");