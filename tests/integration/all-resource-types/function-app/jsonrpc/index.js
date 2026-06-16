// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// A2A JSON-RPC endpoint — handles message/send requests.
// Geocodes cities via Nominatim (OpenStreetMap), falls back to a hardcoded
// lookup table, then fetches live weather from Open-Meteo.

const https = require("https");
const crypto = require("crypto");

// ── Hardcoded city coordinates (fallback when Nominatim is unreachable) ──────
const CITY_COORDS = {
  seattle: { lat: 47.6062, lon: -122.3321, name: "Seattle", country: "US" },
  "new york": {
    lat: 40.7128,
    lon: -74.006,
    name: "New York",
    country: "US",
  },
  "los angeles": {
    lat: 34.0522,
    lon: -118.2437,
    name: "Los Angeles",
    country: "US",
  },
  chicago: { lat: 41.8781, lon: -87.6298, name: "Chicago", country: "US" },
  london: { lat: 51.5074, lon: -0.1278, name: "London", country: "GB" },
  paris: { lat: 48.8566, lon: 2.3522, name: "Paris", country: "FR" },
  tokyo: { lat: 35.6762, lon: 139.6503, name: "Tokyo", country: "JP" },
  sydney: { lat: -33.8688, lon: 151.2093, name: "Sydney", country: "AU" },
  berlin: { lat: 52.52, lon: 13.405, name: "Berlin", country: "DE" },
  beijing: { lat: 39.9042, lon: 116.4074, name: "Beijing", country: "CN" },
  mumbai: { lat: 19.076, lon: 72.8777, name: "Mumbai", country: "IN" },
  "são paulo": {
    lat: -23.5505,
    lon: -46.6333,
    name: "São Paulo",
    country: "BR",
  },
  "sao paulo": {
    lat: -23.5505,
    lon: -46.6333,
    name: "São Paulo",
    country: "BR",
  },
  cairo: { lat: 30.0444, lon: 31.2357, name: "Cairo", country: "EG" },
  "mexico city": {
    lat: 19.4326,
    lon: -99.1332,
    name: "Mexico City",
    country: "MX",
  },
  toronto: { lat: 43.6532, lon: -79.3832, name: "Toronto", country: "CA" },
  rome: { lat: 41.9028, lon: 12.4964, name: "Rome", country: "IT" },
  madrid: { lat: 40.4168, lon: -3.7038, name: "Madrid", country: "ES" },
  moscow: { lat: 55.7558, lon: 37.6173, name: "Moscow", country: "RU" },
  dubai: { lat: 25.2048, lon: 55.2708, name: "Dubai", country: "AE" },
  singapore: {
    lat: 1.3521,
    lon: 103.8198,
    name: "Singapore",
    country: "SG",
  },
};

const AVAILABLE_CITIES = Object.values(CITY_COORDS)
  .filter(
    (c, i, arr) => arr.findIndex((x) => x.name === c.name) === i, // dedupe São Paulo
  )
  .map((c) => `${c.name} (${c.country})`)
  .join(", ");

// ── WMO weather interpretation codes ────────────────────────────────────────
const WEATHER_CODES = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with light hail",
  99: "thunderstorm with heavy hail",
};

// ── HTTP helper ─────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { "User-Agent": "apiops-bvt-a2a-weather/1.0" } },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        },
      )
      .on("error", reject);
  });
}

// ── Geocoding — Nominatim first, then hardcoded fallback ────────────────────
async function geocodeCity(city) {
  // Try Nominatim (OpenStreetMap) first
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
    const results = await httpGet(url);
    if (results && results.length > 0) {
      const parts = (results[0].display_name || "").split(",");
      return {
        lat: parseFloat(results[0].lat),
        lon: parseFloat(results[0].lon),
        name: parts[0].trim(),
        country: parts.length > 1 ? parts[parts.length - 1].trim() : "",
      };
    }
  } catch {
    /* fall through to hardcoded lookup */
  }

  // Fallback to hardcoded cities
  const key = city.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];

  return null;
}

// ── Azure Function entry point ──────────────────────────────────────────────
module.exports = async function (context, req) {
  const body = req.body || {};
  const rpcId = body.id ?? 1;
  const method = body.method ?? "";

  // Only handle message/send
  if (method !== "message/send") {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: rpcId,
        error: { code: -32601, message: `Method not found: ${method}` },
      },
    };
    return;
  }

  // Extract city name from message parts
  const parts = body.params?.message?.parts ?? [];
  let text = "";
  for (const p of parts) {
    if (p.kind === "text") {
      text = p.text ?? "";
      break;
    }
  }

  let city = text.trim();
  const inIdx = city.toLowerCase().indexOf(" in ");
  if (inIdx >= 0) city = city.substring(inIdx + 4).trim();
  city = city.replace(/[?.!,]+$/, "").trim();
  if (!city) city = "Seattle";

  // Geocode and fetch weather
  const coords = await geocodeCity(city);
  let reply;

  if (!coords) {
    reply =
      `Sorry, I could not find a location named "${city}". ` +
      `Available cities for offline lookup: ${AVAILABLE_CITIES}`;
  } else {
    try {
      const wxUrl =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${coords.lat}&longitude=${coords.lon}` +
        `&current=temperature_2m,weather_code,wind_speed_10m` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph`;
      const wx = await httpGet(wxUrl);

      if (wx?.current) {
        const temp = Math.round(wx.current.temperature_2m);
        const code = wx.current.weather_code ?? -1;
        const wind = Math.round(wx.current.wind_speed_10m ?? 0);
        const condition = WEATHER_CODES[code] ?? `weather code ${code}`;
        const place = coords.country
          ? `${coords.name}, ${coords.country}`
          : coords.name;
        reply =
          `Weather in ${place}: ${temp}°F, ${condition}, ` +
          `wind ${wind} mph (live data from Open-Meteo).`;
      } else {
        reply = `Weather for ${coords.name} is currently unavailable.`;
      }
    } catch {
      reply = `Weather for ${coords.name} is currently unavailable (API error).`;
    }
  }

  const taskId = crypto.randomUUID();
  const contextId = crypto.randomUUID();
  const artifactId = crypto.randomUUID();
  const msgId = crypto.randomUUID();
  const ts = new Date().toISOString();

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        kind: "task",
        id: taskId,
        contextId,
        status: { state: "completed", timestamp: ts },
        artifacts: [
          {
            artifactId,
            name: "weather-reply",
            parts: [{ kind: "text", text: reply }],
          },
        ],
        history: [
          {
            kind: "message",
            role: "agent",
            messageId: msgId,
            parts: [{ kind: "text", text: reply }],
          },
        ],
      },
    },
  };
};
