// VisaPrep Worker: serves the static site (ASSETS) and a small flight-lookup API.
//   GET /api/places?term=mumb             -> airport/city suggestions
//   GET /api/flights?from=BOM&to=PAR&date=2026-11-10
// Flight data comes from the Travelpayouts (Aviasales) Data API, a cache of recent fare
// searches. It gives real airlines, flight numbers and departure times, but it is not a
// complete timetable, so an empty day falls back to the nearest dates in the month.
import ref from "./ref-data.json";

const TP = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
const PLACES = "https://autocomplete.travelpayouts.com/places2";
const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    try {
      if (url.pathname === "/api/places") return await cached(request, ctx, 86400, () => places(url));
      if (url.pathname === "/api/flights") return await cached(request, ctx, 21600, () => flights(url, env));
      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "Flight lookup is temporarily unavailable. You can still enter flights manually." }, 502);
    }
  },
};

// Edge-cache successful GET responses so repeat searches don't hit the upstream API.
async function cached(request, ctx, ttl, produce) {
  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await produce();
  if (res.status === 200) {
    res.headers.set("Cache-Control", `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res;
}

async function places(url) {
  const term = (url.searchParams.get("term") || "").trim().slice(0, 50);
  if (term.length < 2) return json({ places: [] });
  const q = new URL(PLACES);
  q.searchParams.set("term", term);
  q.searchParams.set("locale", "en");
  q.searchParams.append("types[]", "city");
  q.searchParams.append("types[]", "airport");
  const r = await fetch(q);
  if (!r.ok) throw new Error(`places ${r.status}`);
  const data = await r.json();
  return json({
    places: data.slice(0, 8).map((p) => ({
      code: p.code,
      type: p.type,
      label: p.type === "airport" ? `${p.city_name} – ${p.name} (${p.code})` : `${p.name}, all airports (${p.code})`,
      country: p.country_name,
    })),
  });
}

async function flights(url, env) {
  const from = (url.searchParams.get("from") || "").toUpperCase();
  const to = (url.searchParams.get("to") || "").toUpperCase();
  const date = url.searchParams.get("date") || "";
  if (!IATA.test(from) || !IATA.test(to) || !DATE.test(date)) return json({ error: "Use 3-letter airport/city codes and a YYYY-MM-DD date." }, 400);
  if (from === to) return json({ error: "Origin and destination are the same." }, 400);
  if (!env.TP_TOKEN) return json({ error: "Flight lookup isn't configured yet." }, 503);

  let tickets = await search(env, from, to, date);
  let exact = true;
  if (!tickets.length) {
    // Nothing cached for that exact day: offer the closest dates in the same month.
    exact = false;
    const target = Date.parse(date);
    tickets = (await search(env, from, to, date.slice(0, 7)))
      .sort((a, b) => Math.abs(Date.parse(a.departure_at) - target) - Math.abs(Date.parse(b.departure_at) - target));
  }

  const seen = new Set();
  const results = [];
  for (const t of tickets) {
    const f = normalise(t, env.TP_MARKER);
    const key = `${f.flightNo}|${f.depDate}|${f.depTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(f);
  }
  // Direct flights first, then by departure time.
  results.sort((a, b) => a.stops - b.stops || (a.depDate + a.depTime).localeCompare(b.depDate + b.depTime));
  return json({ exact, date, results: results.slice(0, 12) });
}

async function search(env, from, to, departureAt) {
  const q = new URL(TP);
  q.searchParams.set("origin", from);
  q.searchParams.set("destination", to);
  q.searchParams.set("departure_at", departureAt);
  q.searchParams.set("one_way", "true");
  q.searchParams.set("sorting", "price");
  q.searchParams.set("currency", "usd");
  q.searchParams.set("limit", "100");
  if (env.TP_MARKER) q.searchParams.set("marker", env.TP_MARKER);
  const r = await fetch(q, { headers: { "X-Access-Token": env.TP_TOKEN, "Accept-Encoding": "gzip" } });
  if (!r.ok) throw new Error(`prices_for_dates ${r.status}`);
  const body = await r.json();
  return Array.isArray(body.data) ? body.data : [];
}

function place(code) {
  const a = ref.airports[code];
  if (a) return { code, name: a[0], city: ref.cities[a[1]]?.[0] || a[1], tz: a[3] };
  const c = ref.cities[code];
  if (c) return { code, name: c[0], city: c[0], tz: c[2] };
  return { code, name: code, city: code, tz: "UTC" };
}

// Wall-clock date and time of an instant in a given IANA time zone.
function local(instant, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(instant)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function normalise(t, marker) {
  const origin = place(t.origin_airport || t.origin);
  const dest = place(t.destination_airport || t.destination);
  const dep = new Date(t.departure_at);
  // departure_at carries the origin's UTC offset, so its wall-clock part is the local time.
  const depWall = /T(\d{2}:\d{2})/.exec(t.departure_at)?.[1] || local(dep, origin.tz).time;
  const duration = t.duration_to || t.duration || 0;
  const arr = duration ? local(new Date(dep.getTime() + duration * 60000), dest.tz) : null;
  // flight_number may be "217" or "AF-217"; keep just the number.
  const num = String(t.flight_number || "").replace(new RegExp(`^${t.airline}-?`, "i"), "");

  let link = null;
  if (t.link) {
    const l = new URL(t.link, "https://www.aviasales.com");
    if (marker) l.searchParams.set("marker", marker);
    link = l.toString();
  }

  return {
    airline: t.airline,
    airlineName: ref.airlines[t.airline] || t.airline,
    flightNo: num ? `${t.airline} ${num}` : "",
    from: origin.code,
    fromLabel: `${origin.city} (${origin.code})`,
    to: dest.code,
    toLabel: `${dest.city} (${dest.code})`,
    depDate: t.departure_at.slice(0, 10),
    depTime: depWall,
    arrDate: arr?.date || "",
    arrTime: arr?.time || "",
    durationMin: duration,
    stops: t.transfers || 0,
    price: t.price,
    link,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}
