// Task 1: external API gateway
// Task 1 - Third-party Web API integrations (gateway/middleware layer).
//  1. ExchangeRate-API (open.er-api.com)  -> real-time currency conversion
//  2. Zippopotam.us                        -> postcode / address validation
//  3. Telegram Bot API                     -> order notification
// Each function normalises the provider payload into our own response shape.

const TIMEOUT_MS = 5000;
const BASE_CURRENCY = (process.env.BASE_CURRENCY || "MYR").toUpperCase();
const DEFAULT_COUNTRY = (process.env.DEFAULT_COUNTRY || "MY").toLowerCase();

class ExternalApiError extends Error {
  constructor(service, message) {
    super(`${service}: ${message}`);
    this.service = service;
    this.status = 502; // Bad Gateway
  }
}

async function getJson(service, url, options = {}) {
  let resp;
  try {
    resp = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new ExternalApiError(service, e.name === "TimeoutError" ? "request timed out" : "service unreachable");
  }
  return resp;
}

// ---------- 1. Currency conversion ----------
let ratesCache = { at: 0, rates: null };
const CACHE_MS = 60 * 60 * 1000; // rates refresh hourly

async function getRates() {
  if (ratesCache.rates && Date.now() - ratesCache.at < CACHE_MS) return ratesCache;
  const resp = await getJson("ExchangeRate-API", `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`);
  if (!resp.ok) throw new ExternalApiError("ExchangeRate-API", `HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.result !== "success" || !data.rates) throw new ExternalApiError("ExchangeRate-API", "unexpected payload");
  ratesCache = { at: Date.now(), rates: data.rates, updated: data.time_last_update_utc };
  return ratesCache;
}

async function convertPrice(amount, targetCurrency) {
  const code = String(targetCurrency).toUpperCase();
  const { rates, updated } = await getRates();
  if (!rates[code]) return null;
  return {
    base: BASE_CURRENCY,
    currency: code,
    rate: rates[code],
    amount: Number((amount * rates[code]).toFixed(2)),
    rateUpdated: updated,
  };
}

// ---------- 2. Postcode validation ----------
async function lookupPostcode(postcode, country = DEFAULT_COUNTRY) {
  const resp = await getJson(
    "Zippopotam",
    `https://api.zippopotam.us/${encodeURIComponent(country.toLowerCase())}/${encodeURIComponent(postcode)}`
  );
  if (resp.status === 404) return { valid: false };
  if (!resp.ok) throw new ExternalApiError("Zippopotam", `HTTP ${resp.status}`);
  const data = await resp.json();
  const place = data.places?.[0] || {};
  return {
    valid: true,
    postcode: data["post code"],
    country: data.country,
    countryCode: data["country abbreviation"],
    city: place["place name"] || null,
    state: place.state || null,
  };
}

// ---------- 3. Telegram notification ----------
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, reason: "not configured" };
  const resp = await getJson("Telegram", `https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!resp.ok) throw new ExternalApiError("Telegram", `HTTP ${resp.status}`);
  return { sent: true };
}

module.exports = { ExternalApiError, convertPrice, lookupPostcode, sendTelegram, BASE_CURRENCY };
