import express from "express";
import fetch from "node-fetch";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, "config.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── CONFIG (persists weather key to disk) ─────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
  catch { return {}; }
}
function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── SETTINGS ENDPOINTS ────────────────────────────────────────────────────
app.get("/api/settings", (req, res) => {
  const cfg = loadConfig();
  // Never expose the full key — just confirm it exists
  res.json({ hasWeatherKey: !!cfg.weatherApiKey });
});

app.post("/api/settings", (req, res) => {
  const { weatherApiKey } = req.body;
  if (!weatherApiKey) return res.status(400).json({ error: "Missing weatherApiKey" });
  const cfg = loadConfig();
  cfg.weatherApiKey = weatherApiKey.trim();
  saveConfig(cfg);
  res.json({ ok: true });
});

// ── WEATHER HELPER ────────────────────────────────────────────────────────
async function fetchWeather(city) {
  const { weatherApiKey } = loadConfig();
  if (!weatherApiKey) throw new Error("NO_KEY");
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${weatherApiKey}&units=imperial`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("WEATHER_FAIL");
  return res.json();
}

async function fetchForecast(city) {
  const { weatherApiKey } = loadConfig();
  if (!weatherApiKey) throw new Error("NO_KEY");
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${weatherApiKey}&units=imperial&cnt=8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("FORECAST_FAIL");
  return res.json();
}

// ── WEATHER REPORT ENDPOINT ───────────────────────────────────────────────
app.get("/api/weather", async (req, res) => {
  const city = req.query.city || "New York";
  try {
    const [current, forecast] = await Promise.all([fetchWeather(city), fetchForecast(city)]);
    const forecastItems = (forecast?.list || []).map(item => ({
      time: new Date(item.dt * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", hour12: true }),
      temp: Math.round(item.main.temp),
      desc: item.weather[0].description,
      icon: item.weather[0].icon,
    }));
    res.json({
      city: current.name,
      country: current.sys.country,
      temp: Math.round(current.main.temp),
      feels_like: Math.round(current.main.feels_like),
      condition: current.weather[0].description,
      humidity: current.main.humidity,
      wind: Math.round(current.wind.speed),
      icon: current.weather[0].icon,
      forecast: forecastItems,
    });
  } catch (err) {
    if (err.message === "NO_KEY") return res.status(403).json({ error: "NO_KEY" });
    res.status(500).json({ error: "Weather fetch failed" });
  }
});

// ── PING (keep-alive target) ──────────────────────────────────────────────
app.get("/ping", (req, res) => res.json({ status: "alive", ts: new Date().toISOString() }));

// ── KEEP-ALIVE CRON (every 14 min) ───────────────────────────────────────
const SELF_URL = process.env.RENDER_URL || `http://localhost:${PORT}`;
cron.schedule("*/14 * * * *", async () => {
  try {
    const r = await fetch(`${SELF_URL}/ping`);
    const d = await r.json();
    console.log(`[keep-alive] ${d.status} @ ${d.ts}`);
  } catch (e) {
    console.warn("[keep-alive] ping failed:", e.message);
  }
});
console.log(`[keep-alive] Pinging ${SELF_URL} every 14 min`);

app.listen(PORT, () => console.log(`WC Hub Weather AI on port ${PORT}`));
