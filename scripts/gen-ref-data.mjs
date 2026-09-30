// Fetches Travelpayouts reference data and writes a compact lookup bundled into the Worker:
//   airports: IATA -> [name, cityCode, countryCode, timeZone]
//   airlines: IATA -> name
//   routes:   IATA -> concatenated IATA codes of airports with a direct, non-codeshare flight
//             (used to pick plausible connection hubs without spending timetable API calls)
// Re-run occasionally (npm run refdata); the output is committed.
import { writeFileSync } from "node:fs";

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
};

const [airports, airlines, cities, routes] = await Promise.all([
  get("https://api.travelpayouts.com/data/en/airports.json"),
  get("https://api.travelpayouts.com/data/en/airlines.json"),
  get("https://api.travelpayouts.com/data/en/cities.json"),
  get("https://api.travelpayouts.com/data/routes.json"),
]);

const out = { airports: {}, airlines: {}, cities: {}, routes: {} };
for (const a of airports) {
  if (!a.flightable || !a.time_zone || a.iata_type !== "airport") continue;
  out.airports[a.code] = [a.name, a.city_code, a.country_code, a.time_zone];
}
// City codes (e.g. PAR, LON) can appear as origin/destination; keep their name + a time zone.
for (const c of cities) if (c.time_zone) out.cities[c.code] = [c.name, c.country_code, c.time_zone];
for (const a of airlines) if (a.code && a.name) out.airlines[a.code] = a.name;

const adj = {};
for (const r of routes) {
  const d = r.departure_airport_iata, a = r.arrival_airport_iata;
  if (r.transfers || r.codeshare || !out.airports[d] || !out.airports[a]) continue;
  (adj[d] ||= new Set()).add(a);
}
for (const [d, set] of Object.entries(adj)) out.routes[d] = [...set].sort().join("");

writeFileSync("worker/ref-data.json", JSON.stringify(out));
console.log(`airports ${Object.keys(out.airports).length}, cities ${Object.keys(out.cities).length}, airlines ${Object.keys(out.airlines).length}, route origins ${Object.keys(out.routes).length}`);
