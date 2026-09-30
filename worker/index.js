// VisaPrep Worker: serves the static site (ASSETS) and a small flight-lookup API.
//   GET /api/places?term=mumb             -> airport/city suggestions
//   GET /api/flights?from=BOM&to=PAR&date=2026-11-10
// Flights come from two sources:
//   - AeroDataBox airport timetable (ADB_KEY): every scheduled direct departure that day.
//     Each airport/day is fetched once and kept in KV, so later searches cost no API units.
//   - Travelpayouts / Aviasales fare cache (TP_TOKEN): adds connecting options plus the
//     affiliate "check fares" links. It's sparse, so it's supplementary.
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
  if (!env.ADB_KEY && !env.TP_TOKEN) return json({ error: "Flight lookup isn't configured yet." }, 503);

  const toSet = new Set(airportsOf(to));
  const [timetable, fares] = await Promise.all([
    env.ADB_KEY ? directFlights(env, from, toSet, date).catch(logEmpty("timetable")) : [],
    env.TP_TOKEN ? search(env, from, to, date).catch(logEmpty("fares")) : [],
  ]);

  const results = [];
  const seen = new Set();
  const add = (f) => {
    const key = `${f.flightNo.replace(/\s/g, "")}|${f.depDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(f);
  };
  timetable.forEach((f) => add(withLink(f, env.TP_MARKER)));
  fares.map((t) => normalise(t, env.TP_MARKER)).forEach(add);

  let exact = true;
  if (!results.length && env.TP_TOKEN) {
    // Nothing that day: offer the closest dates in the same month from the fare cache.
    exact = false;
    const target = Date.parse(date);
    (await search(env, from, to, date.slice(0, 7)).catch(logEmpty("fares-month")))
      .sort((a, b) => Math.abs(Date.parse(a.departure_at) - target) - Math.abs(Date.parse(b.departure_at) - target))
      .map((t) => normalise(t, env.TP_MARKER))
      .forEach(add);
  }

  // Direct first, then by departure time.
  results.sort((a, b) => a.stops - b.stops || (a.depDate + a.depTime).localeCompare(b.depDate + b.depTime));
  return json({ exact, date, results: results.slice(0, 20) });
}

const logEmpty = (what) => (err) => {
  console.error(what, err);
  return [];
};

// --- AeroDataBox timetable ---

// ADB_KEY can be a RapidAPI key or a key from AeroDataBox's own portal (a UUID).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function adbRequest(env, path) {
  return UUID.test(env.ADB_KEY)
    ? { url: `https://api.aerodatabox.com${path}`, headers: { "x-api-key": env.ADB_KEY } }
    : { url: `https://aerodatabox.p.rapidapi.com${path}`, headers: { "X-RapidAPI-Key": env.ADB_KEY, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" } };
}

// City codes (LON) expand to their airports; airport codes stay as they are.
function airportsOf(code) {
  if (ref.airports[code]) return [code];
  return cityAirports()[code] || [code];
}
let _cityAirports;
function cityAirports() {
  if (!_cityAirports) {
    _cityAirports = {};
    for (const [code, a] of Object.entries(ref.airports)) (_cityAirports[a[1]] ||= []).push(code);
  }
  return _cityAirports;
}

// For a multi-airport origin city, only query its two busiest airports (ranked by the
// autocomplete service) to save API units.
async function originAirports(code) {
  const all = airportsOf(code);
  if (all.length <= 2) return all;
  try {
    const q = new URL(PLACES);
    q.searchParams.set("term", code);
    q.searchParams.set("locale", "en");
    q.searchParams.append("types[]", "airport");
    const ranked = (await (await fetch(q)).json()).map((p) => p.code).filter((c) => all.includes(c));
    if (ranked.length) return ranked.slice(0, 2);
  } catch {}
  return all.slice(0, 2);
}

async function directFlights(env, from, toSet, date) {
  const origins = await originAirports(from);
  const lists = await Promise.all(origins.map((a) => departures(env, a, date)));
  return lists.flat().filter((f) => toSet.has(f.to));
}

// All scheduled departures from one airport on one local day, cached in KV.
async function departures(env, airport, date) {
  const key = `adb:v1:${airport}:${date}`;
  if (env.CACHE) {
    const hit = await env.CACHE.get(key, "json");
    if (hit) return hit;
  }
  // The free plan allows a 12-hour window per call, so a day is two calls.
  const halves = await Promise.all([
    fids(env, airport, `${date}T00:00`, `${date}T11:59`),
    fids(env, airport, `${date}T12:00`, `${date}T23:59`),
  ]);
  const list = halves.flat().map((e) => timetableEntry(e, airport)).filter(Boolean);
  if (env.CACHE) {
    // Far-off schedules change slowly; refresh near-term days more often.
    const daysOut = (Date.parse(date) - Date.now()) / 86400000;
    await env.CACHE.put(key, JSON.stringify(list), { expirationTtl: daysOut > 14 ? 7 * 86400 : 86400 });
  }
  return list;
}

async function fids(env, airport, fromLocal, toLocal) {
  const req = adbRequest(env, `/flights/airports/iata/${airport}/${fromLocal}/${toLocal}`);
  const q = new URL(req.url);
  for (const [k, v] of Object.entries({ direction: "Departure", withLeg: "true", withCancelled: "false", withCodeshared: "false", withCargo: "false", withPrivate: "false", withLocation: "false" }))
    q.searchParams.set(k, v);
  const r = await fetch(q, { headers: req.headers });
  if (r.status === 204) return [];
  if (!r.ok) throw new Error(`aerodatabox ${airport} ${r.status} ${await r.text().catch(() => "")}`.slice(0, 300));
  const body = await r.json();
  return body.departures || [];
}

// "2026-11-10 01:35+05:30" -> { date, time }
const splitLocal = (s) => ({ date: s.slice(0, 10), time: s.slice(11, 16) });
const utcMs = (s) => Date.parse(s.replace(" ", "T"));

function timetableEntry(e, originCode) {
  const dep = e.departure, arr = e.arrival;
  const toCode = arr?.airport?.iata;
  if (!dep?.scheduledTime?.local || !toCode || e.isCargo) return null;
  const d = splitLocal(dep.scheduledTime.local);
  const a = arr.scheduledTime?.local ? splitLocal(arr.scheduledTime.local) : { date: "", time: "" };
  const dur = dep.scheduledTime.utc && arr.scheduledTime?.utc ? Math.round((utcMs(arr.scheduledTime.utc) - utcMs(dep.scheduledTime.utc)) / 60000) : 0;
  const origin = place(dep.airport?.iata || originCode);
  const dest = place(toCode);
  return {
    airline: e.airline?.iata || "",
    // Prefer the full name from reference data ("British Airways" rather than "British").
    airlineName: ref.airlines[e.airline?.iata] || e.airline?.name || "",
    flightNo: (e.number || "").replace(/\s+/, " "),
    from: origin.code,
    fromLabel: `${origin.city} (${origin.code})`,
    to: dest.code,
    toLabel: `${dest.city} (${dest.code})`,
    depDate: d.date,
    depTime: d.time,
    arrDate: a.date,
    arrTime: a.time,
    durationMin: dur > 0 ? dur : 0,
    stops: 0,
    aircraft: e.aircraft?.model || "",
    source: "timetable",
  };
}

// Aviasales search link for a timetable flight: /search/{FROM}{DDMM}{TO}1
function withLink(f, marker) {
  const l = new URL(`https://www.aviasales.com/search/${f.from}${f.depDate.slice(8, 10)}${f.depDate.slice(5, 7)}${f.to}1`);
  if (marker) l.searchParams.set("marker", marker);
  return { ...f, link: l.toString() };
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
    source: "fares",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}
