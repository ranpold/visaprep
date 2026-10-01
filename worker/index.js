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
const CACHE_VERSION = "9";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/go/hotels") return hotelRedirect(url, env);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    try {
      if (url.pathname === "/api/places") return await cached(request, ctx, 86400, () => places(url));
      if (url.pathname === "/api/tz") return await cached(request, ctx, 604800, () => timeZones(url));
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
  // Bump CACHE_VERSION when result logic changes so stale edge-cached responses are skipped.
  const u = new URL(request.url);
  u.searchParams.set("cv", CACHE_VERSION);
  const key = new Request(u.toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await produce();
  // Don't cache empty answers: they're often caused by a transient upstream error or rate limit.
  const empty = res.headers.get("X-Empty") === "1";
  res.headers.delete("X-Empty");
  if (res.status === 200 && !empty) {
    // Edge keeps it for `ttl`; browsers only 5 minutes, so fixes reach users quickly.
    res.headers.set("Cache-Control", `public, max-age=300, s-maxage=${ttl}`);
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
  // The upstream search is fuzzy ("hyder" also returns Igdir, Tyler...). Keep places whose code,
  // name or city starts with the term, or has a word that does; fall back to the top few only if
  // nothing matches (helps with typos).
  const t = term.toLowerCase();
  const words = (str) => (str || "").toLowerCase().split(/[\s\-–,()/.]+/);
  const relevant = (p) => p.code.toLowerCase() === t || [p.name, p.city_name].some((x) => (x || "").toLowerCase().startsWith(t) || words(x).some((w) => w.startsWith(t)));
  const matched = data.filter(relevant);
  const pool = matched.length ? matched : data.slice(0, 5);
  // Order: each city first, then its airports (busiest first), so "Paris" shows PAR, CDG, ORY...
  const rows = pool.filter((p) => p.type === "city" || ref.airports[p.code]);
  const cities = rows.filter((p) => p.type === "city");
  const airports = rows.filter((p) => p.type === "airport").sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const out = [];
  for (const c of cities) {
    const own = airports.filter((a) => a.city_code === c.code);
    // A city with one airport is simpler to show as just that airport.
    if (own.length !== 1) out.push({ code: c.code, type: "city", name: c.name, sub: `All airports · ${c.country_name}`, label: `${c.name}, all airports (${c.code})` });
    for (const a of own) out.push(airportRow(a, own.length > 1));
  }
  for (const a of airports) if (!cities.some((c) => c.code === a.city_code)) out.push(airportRow(a, false));
  // One row per code+type (the same airport can arrive both on its own and under its city).
  const seen = new Set();
  const unique = out.filter((p) => !seen.has(p.type + p.code) && seen.add(p.type + p.code));
  return json({ places: unique.slice(0, 10) });
}

function airportRow(a, parent) {
  return { code: a.code, type: "airport", name: a.name, sub: `${a.city_name}, ${a.country_name}`, label: `${a.city_name} – ${a.name} (${a.code})`, parent };
}

// IANA time zones for airport/city codes, so the page can compute flight durations:
//   GET /api/tz?codes=BOM,CDG -> { "BOM": "Asia/Kolkata", "CDG": "Europe/Paris" }
async function timeZones(url) {
  const codes = (url.searchParams.get("codes") || "").toUpperCase().split(",").filter((c) => IATA.test(c)).slice(0, 20);
  const out = {};
  for (const c of codes) {
    const tz = ref.airports[c]?.[3] || ref.cities[c]?.[2];
    if (tz) out[c] = tz;
  }
  return json(out);
}

async function flights(url, env) {
  const from = (url.searchParams.get("from") || "").toUpperCase();
  const to = (url.searchParams.get("to") || "").toUpperCase();
  const date = url.searchParams.get("date") || "";
  if (!IATA.test(from) || !IATA.test(to) || !DATE.test(date)) return json({ error: "Use 3-letter airport/city codes and a YYYY-MM-DD date." }, 400);
  // Reject impossible dates (2026-02-30) and dates already past (a day of slack for time zones).
  const d = new Date(date + "T00:00:00Z");
  if (isNaN(d) || d.toISOString().slice(0, 10) !== date) return json({ error: "That date doesn't exist." }, 400);
  if (d.getTime() < Date.now() - 2 * 86400000) return json({ error: "That date is in the past." }, 400);
  if (!ref.airports[from] && !ref.cities[from]) return json({ error: `Unknown airport or city code: ${from}.` }, 400);
  if (!ref.airports[to] && !ref.cities[to]) return json({ error: `Unknown airport or city code: ${to}.` }, 400);
  if (from === to) return json({ error: "Origin and destination are the same." }, 400);
  if (!env.ADB_KEY && !env.TP_TOKEN) return json({ error: "Flight lookup isn't configured yet." }, 503);

  const toSet = new Set(airportsOf(to));
  let timetableDown = false;
  const [timetable, fares] = await Promise.all([
    env.ADB_KEY
      ? timetableFlights(env, from, toSet, date).catch((err) => {
          if (err instanceof QuotaError) timetableDown = true;
          return logEmpty("timetable")(err);
        })
      : [],
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
    // Nothing that day: offer the closest dates (within a week) in the same month from the fare cache.
    exact = false;
    const target = Date.parse(date);
    const WEEK = 7 * 86400000;
    (await search(env, from, to, date.slice(0, 7)).catch(logEmpty("fares-month")))
      .filter((t) => Math.abs(Date.parse(t.departure_at.slice(0, 10)) - target) <= WEEK)
      .sort((a, b) => Math.abs(Date.parse(a.departure_at) - target) - Math.abs(Date.parse(b.departure_at) - target))
      .map((t) => normalise(t, env.TP_MARKER))
      .forEach(add);
  }

  // Direct first (by departure time), then connections (fastest first).
  results.sort((a, b) => a.stops - b.stops || (a.stops ? a.durationMin - b.durationMin : (a.depDate + a.depTime).localeCompare(b.depDate + b.depTime)));
  const res = json({ exact, date, results: results.slice(0, 20), ...(timetableDown ? { notice: "timetable-unavailable" } : {}) });
  if (!results.length || timetableDown) res.headers.set("X-Empty", "1"); // don't cache degraded answers
  return res;
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
    // The service doesn't return airports in size order; `weight` reflects traffic (LHR > LGW > STN).
    const ranked = (await (await fetch(q)).json())
      .filter((p) => all.includes(p.code))
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .map((p) => p.code);
    if (ranked.length) return ranked.slice(0, 2);
  } catch {}
  return all.slice(0, 2);
}

// Direct flights from the timetable, plus one-stop connections when there are few directs.
async function timetableFlights(env, from, toSet, date) {
  if (env.CACHE && (await env.CACHE.get(QUOTA_FLAG))) throw new QuotaError("timetable quota exhausted (cached flag)");
  const origins = await originAirports(from);
  const originDeps = (await Promise.all(origins.map((a) => departures(env, a, date)))).flat().map(withName);
  const direct = originDeps.filter((f) => toSet.has(f.to));
  if (direct.length >= 3) return direct;
  const conns = await connections(env, new Set(origins), originDeps, toSet).catch(logEmpty("connections"));
  return [...direct, ...conns];
}

// Names are resolved at read time, not only when cached, so KV entries pick up reference-data fixes.
const withName = (f) => ({ ...f, airlineName: ref.airlines[f.airline] || f.airlineName });

const MIN_LAYOVER = 75; // minutes, same-airport transfer
const MAX_LAYOVER = 12 * 60;
const MAX_HUBS = 3;

const hasRoute = (from, to) => {
  const r = ref.routes[from];
  if (!r) return false;
  for (let i = 0; i < r.length; i += 3) if (r.slice(i, i + 3) === to) return true;
  return false;
};

// One-stop itineraries: first legs are real departures from the origin today; hubs are picked
// from the route map (free) and only those hubs' timetables are fetched.
async function connections(env, originSet, originDeps, toSet) {
  const byHub = new Map();
  for (const f of originDeps) {
    if (!f.arrUtc || toSet.has(f.to) || originSet.has(f.to)) continue;
    if (![...toSet].some((d) => hasRoute(f.to, d))) continue;
    if (!byHub.has(f.to)) byHub.set(f.to, []);
    byHub.get(f.to).push(f);
  }
  // Prefer big hubs (most onward routes), then those with more flights from the origin.
  const hubs = [...byHub.keys()]
    .sort((a, b) => (ref.routes[b]?.length || 0) - (ref.routes[a]?.length || 0) || byHub.get(b).length - byHub.get(a).length)
    .slice(0, MAX_HUBS);

  const out = [];
  await Promise.all(
    hubs.map(async (hub) => {
      const firstLegs = byHub.get(hub);
      // Onward flights can leave the day of arrival or the next day (overnight layovers).
      const days = new Set();
      for (const f of firstLegs) {
        days.add(f.arrDate);
        days.add(addDays(f.arrDate, 1));
      }
      const onward = (await Promise.all([...days].slice(0, 3).map((d) => departures(env, hub, d))))
        .flat()
        .map(withName)
        .filter((g) => toSet.has(g.to) && g.depUtc);
      for (const f of firstLegs) {
        // For each first leg, keep its best (shortest) valid layover.
        let best = null;
        for (const g of onward) {
          const lay = (g.depUtc - f.arrUtc) / 60000;
          if (lay < MIN_LAYOVER || lay > MAX_LAYOVER) continue;
          if (!best || g.depUtc < best.depUtc) best = g;
        }
        if (best) out.push(connection(f, best));
      }
    })
  );
  // Fastest overall first; keep a varied, short list.
  return out.sort((a, b) => a.durationMin - b.durationMin).slice(0, 8);
}

function connection(f, g) {
  const hub = place(f.to);
  const sameAirline = f.airline === g.airline;
  return {
    type: "connection",
    segments: [f, g],
    airline: f.airline,
    airlineName: sameAirline ? f.airlineName : `${f.airlineName} + ${g.airlineName}`,
    flightNo: `${f.flightNo} / ${g.flightNo}`,
    from: f.from,
    fromLabel: f.fromLabel,
    to: g.to,
    toLabel: g.toLabel,
    via: hub.code,
    viaLabel: `${hub.city} (${hub.code})`,
    layoverMin: Math.round((g.depUtc - f.arrUtc) / 60000),
    depDate: f.depDate,
    depTime: f.depTime,
    arrDate: g.arrDate,
    arrTime: g.arrTime,
    durationMin: Math.round((g.arrUtc - f.depUtc) / 60000),
    stops: 1,
    source: "timetable",
  };
}

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// All scheduled departures from one airport on one local day, cached in KV.
async function departures(env, airport, date) {
  const key = `adb:v3:${airport}:${date}`;
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

const QUOTA_FLAG = "adb:quota-exhausted";
class QuotaError extends Error {}

async function fids(env, airport, fromLocal, toLocal) {
  const req = adbRequest(env, `/flights/airports/iata/${airport}/${fromLocal}/${toLocal}`);
  const q = new URL(req.url);
  for (const [k, v] of Object.entries({ direction: "Departure", withLeg: "true", withCancelled: "false", withCodeshared: "false", withCargo: "false", withPrivate: "false", withLocation: "false" }))
    q.searchParams.set(k, v);
  let r;
  // The free RapidAPI plan rate-limits bursts; back off and retry a few times. A used-up
  // monthly quota is different: retrying can't help, so remember it and stop calling.
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await fetch(q, { headers: req.headers });
    if (r.status !== 429) break;
    const text = await r.clone().text().catch(() => "");
    if (/quota/i.test(text)) {
      if (env.CACHE) await env.CACHE.put(QUOTA_FLAG, "1", { expirationTtl: 6 * 3600 });
      throw new QuotaError(text.slice(0, 200));
    }
    await new Promise((ok) => setTimeout(ok, 1200 * (attempt + 1)));
  }
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
    depUtc: dep.scheduledTime.utc ? utcMs(dep.scheduledTime.utc) : 0,
    arrUtc: arr.scheduledTime?.utc ? utcMs(arr.scheduledTime.utc) : 0,
    stops: 0,
    aircraft: e.aircraft?.model || "",
    depTerminal: dep.terminal || "",
    arrTerminal: arr.terminal || "",
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

// --- Hotel search hand-off (Booking.com via Travelpayouts partner links) ---
//   GET /go/hotels?city=Paris&checkin=2026-11-10&checkout=2026-11-15&adults=2
// Builds a Booking.com search and, when TP_TRS (project ID) is configured, converts it into a
// tracked partner link via the Travelpayouts Links API (cached in KV). Always redirects, so a
// failed conversion still sends the visitor to a normal Booking.com search.
async function hotelRedirect(url, env) {
  const city = (url.searchParams.get("city") || "").trim().slice(0, 80);
  const checkin = url.searchParams.get("checkin") || "";
  const checkout = url.searchParams.get("checkout") || "";
  const adults = Math.min(Math.max(parseInt(url.searchParams.get("adults") || "1", 10) || 1, 1), 9);

  const target = new URL("https://www.booking.com/searchresults.html");
  if (city) target.searchParams.set("ss", city);
  if (DATE.test(checkin) && DATE.test(checkout) && checkout > checkin) {
    target.searchParams.set("checkin", checkin);
    target.searchParams.set("checkout", checkout);
  }
  target.searchParams.set("group_adults", String(adults));
  target.searchParams.set("no_rooms", "1");

  let dest = target.toString();
  if (env.TP_TOKEN && env.TP_TRS && env.TP_MARKER) {
    try {
      dest = await partnerLink(env, dest);
    } catch (err) {
      console.error("partner link", err);
    }
  }
  return new Response(null, { status: 302, headers: { Location: dest, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

async function partnerLink(env, target) {
  const key = `plink:v1:${target}`;
  if (env.CACHE) {
    const hit = await env.CACHE.get(key);
    if (hit) return hit;
  }
  const r = await fetch("https://api.travelpayouts.com/links/v1/create", {
    method: "POST",
    headers: { "X-Access-Token": env.TP_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ trs: Number(env.TP_TRS), marker: Number(env.TP_MARKER), shorten: false, links: [{ url: target, sub_id: "hotels" }] }),
  });
  if (!r.ok) throw new Error(`links api ${r.status}`);
  const body = await r.json();
  const link = body?.result?.links?.[0]?.partner_url;
  if (!link) throw new Error(`links api: ${JSON.stringify(body).slice(0, 200)}`);
  if (env.CACHE) await env.CACHE.put(key, link, { expirationTtl: 30 * 86400 });
  return link;
}
