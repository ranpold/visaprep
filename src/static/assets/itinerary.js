// Itinerary builder: repeatable form sections -> live "plan" document preview -> print to PDF.
(function () {
  const KEY = "visaprep.itinerary.v1";
  const form = document.getElementById("it-form");
  const preview = document.getElementById("preview");
  const LISTS = ["flights", "stays", "days"];
  const esc = window.escapeHtml;
  const BASE = document.querySelector('link[rel="icon"]').getAttribute("href").replace(/\/assets\/favicon\.svg$/, "");

  const fmtDate = (d) => {
    if (!d) return "";
    const dt = new Date(d + "T00:00:00");
    return isNaN(dt) ? d : dt.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  };
  const nights = (a, b) => {
    const n = Math.round((new Date(b) - new Date(a)) / 86400000);
    return n > 0 ? n : "";
  };

  function addItem(list, data = {}) {
    const node = document.getElementById("tpl-" + list).content.firstElementChild.cloneNode(true);
    node.querySelectorAll("[data-k]").forEach((el) => {
      if (data[el.dataset.k] != null) el.value = data[el.dataset.k];
    });
    // Rows filled by the flight finder remember their leg so a new search replaces them.
    if (data._leg) node.dataset.leg = data._leg;
    node.querySelector(".remove").addEventListener("click", () => {
      node.remove();
      update();
    });
    document.getElementById(list).appendChild(node);
    return node;
  }

  function read() {
    const state = {
      tripTitle: form.tripTitle.value,
      purpose: form.purpose.value,
      travellers: form.travellers.value,
      contact: form.contact.value,
      notes: form.notes.value,
    };
    for (const list of LISTS) {
      state[list] = [...document.getElementById(list).children].map((item) => {
        const o = {};
        item.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value));
        if (item.dataset.leg) o._leg = item.dataset.leg;
        return o;
      });
    }
    return state;
  }

  function load(state) {
    for (const k of ["tripTitle", "purpose", "travellers", "contact", "notes"]) form[k].value = state[k] || (k === "purpose" ? "Tourism" : "");
    for (const list of LISTS) {
      document.getElementById(list).innerHTML = "";
      (state[list] || []).forEach((d) => addItem(list, d));
    }
  }

  // "Paris (CDG)" -> { city: "Paris", code: "CDG" }
  const splitPlace = (label) => {
    const m = /^(.*?)\s*\(([A-Z]{3})\)\s*$/.exec(label || "");
    return m ? { city: m[1], code: m[2] } : { city: label || "", code: "" };
  };
  const shortDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "");
  const fmtDur = (m) => (m > 0 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");
  const statusClass = (st) => (/confirmed|booked/i.test(st || "") ? "st-booked" : /held|reserved/i.test(st || "") ? "st-held" : "st-plan");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function flightCard(f) {
    const a = splitPlace(f.from), b = splitPlace(f.to);
    const shift = f.arrDate && f.date && f.arrDate > f.date ? Math.round((Date.parse(f.arrDate) - Date.parse(f.date)) / 86400000) : 0;
    return `
      <div class="fl">
        <div class="fl-top">
          <span class="fl-air">${esc(f.airline) || "Airline"}${f.flightNo ? ` · <strong>${esc(f.flightNo)}</strong>` : ""}</span>
          <span class="pill ${statusClass(f.status)}">${esc(f.status)}</span>
        </div>
        <div class="fl-main">
          <div class="fl-end">
            <div class="fl-time">${esc(f.dep) || "--:--"}</div>
            <div class="fl-code">${esc(a.code || a.city)}</div>
            <div class="fl-city">${esc(a.code ? a.city : "")}${a.code ? " · " : ""}${esc(shortDate(f.date))}</div>
          </div>
          <div class="fl-mid">
            <div class="fl-dur">${esc(fmtDur(+f.dur))}</div>
            <div class="fl-line"><span>✈</span></div>
            <div class="fl-sub">${esc(f.aircraft || "")}</div>
          </div>
          <div class="fl-end fl-r">
            <div class="fl-time">${esc(f.arr) || "--:--"}${shift ? `<sup>+${shift}</sup>` : ""}</div>
            <div class="fl-code">${esc(b.code || b.city)}</div>
            <div class="fl-city">${esc(b.code ? b.city : "")}${b.code && (f.arrDate || f.date) ? " · " : ""}${esc(shortDate(f.arrDate || f.date))}</div>
          </div>
        </div>
      </div>`;
  }

  // Layover chip between two consecutive flights that connect at the same airport.
  function layover(prev, next) {
    const p = splitPlace(prev.to), n = splitPlace(next.from);
    if (!p.code || p.code !== n.code || !+prev.arrUtc || !+next.depUtc) return "";
    const mins = Math.round((+next.depUtc - +prev.arrUtc) / 60000);
    if (mins <= 0 || mins > 24 * 60) return "";
    return `<div class="layover">Layover in ${esc(p.city)} (${esc(p.code)}) · ${esc(fmtDur(mins))}</div>`;
  }

  function render(s) {
    const travellers = s.travellers.split("\n").map((t) => t.trim()).filter(Boolean);
    const flights = s.flights.filter((f) => f.from || f.to || f.date).sort((a, b) => ((a.date || "") + (a.dep || "")).localeCompare((b.date || "") + (b.dep || "")));
    const stays = s.stays.filter((h) => h.name || h.city).sort((a, b) => (a.in || "").localeCompare(b.in || ""));
    const days = s.days.filter((d) => d.date || d.plan).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const allDates = [...flights.flatMap((f) => [f.date, f.arrDate]), ...stays.flatMap((h) => [h.in, h.out]), ...days.map((d) => d.date)].filter(Boolean).sort();
    const start = allDates[0], end = allDates[allDates.length - 1];
    const tripDays = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 : 0;
    const stayNights = stays.reduce((n, h) => n + (+nights(h.in, h.out) || 0), 0);
    const origin = flights[0] ? splitPlace(flights[0].from).city : "";
    // A flight's destination is only a connection hub if the next flight leaves from there within a day.
    const isHub = (f, i) => {
      const next = flights[i + 1];
      if (!next || splitPlace(f.to).code !== splitPlace(next.from).code) return false;
      return Date.parse(next.date) - Date.parse(f.arrDate || f.date) <= 86400000;
    };
    const flightDests = flights.filter((f, i) => !isHub(f, i)).map((f) => splitPlace(f.to).city);
    const places = [...new Set([...stays.map((h) => h.city), ...flightDests].filter((c) => c && c !== origin))];
    const empty = (msg) => `<p class="empty">${msg}</p>`;

    preview.innerHTML = `
      <div class="doc-title">
        <div>
          <div class="doc-kicker">Travel Itinerary</div>
          <h2>${esc(s.tripTitle) || "My trip"}</h2>
          <div class="doc-trav">${travellers.length ? travellers.map(esc).join(" · ") : '<span class="empty">Add traveller names</span>'}</div>
        </div>
        <div class="doc-meta">
          <div><span>Purpose</span>${esc(s.purpose)}</div>
          ${s.contact ? `<div><span>Contact</span>${esc(s.contact)}</div>` : ""}
        </div>
      </div>

      <div class="summary">
        <div><span>Travel dates</span><strong>${start ? `${esc(shortDate(start))} – ${esc(shortDate(end))}` : "—"}</strong>${start ? `<em>${esc(start.slice(0, 4))}</em>` : ""}</div>
        <div><span>Duration</span><strong>${tripDays ? esc(plural(tripDays, "day")) : "—"}</strong>${stayNights ? `<em>${esc(plural(stayNights, "night"))} accommodation</em>` : ""}</div>
        <div><span>Destinations</span><strong>${places.length ? esc(places.slice(0, 3).join(", ")) : "—"}</strong>${places.length > 3 ? `<em>+${places.length - 3} more</em>` : ""}</div>
        <div><span>Travellers</span><strong>${travellers.length || "—"}</strong></div>
      </div>

      <div class="doc-section">Flights</div>
      ${flights.length ? flights.map((f, i) => (i ? layover(flights[i - 1], f) : "") + flightCard(f)).join("") : empty("Add your flights, or use Find flights")}

      <div class="doc-section">Accommodation</div>
      ${stays.length ? `<div class="stays">${stays.map((h) => `
        <div class="stay">
          <div class="stay-top"><strong>${esc(h.name) || "Accommodation"}</strong><span class="pill ${statusClass(h.status)}">${esc(h.status)}</span></div>
          <div class="stay-city">${esc(h.city)}${h.address ? ` · ${esc(h.address)}` : ""}</div>
          <div class="stay-dates">
            <div><span>Check-in</span>${esc(shortDate(h.in)) || "—"}</div>
            <div><span>Check-out</span>${esc(shortDate(h.out)) || "—"}</div>
            <div><span>Nights</span>${nights(h.in, h.out) || "—"}</div>
          </div>
        </div>`).join("")}</div>` : empty("Add where you'll stay")}

      ${days.length ? `<div class="doc-section">Day-by-day plan</div><table class="plan"><tbody>
        ${days.map((d) => `<tr><td class="plan-date">${esc(shortDate(d.date))}</td><td class="plan-city">${esc(d.city)}</td><td>${esc(d.plan)}</td></tr>`).join("")}
      </tbody></table>` : ""}

      ${s.notes ? `<div class="doc-section">Notes</div><div style="white-space:pre-wrap">${esc(s.notes)}</div>` : ""}

      <div class="doc-foot">Prepared by the traveller on ${esc(fmtDate(new Date().toISOString().slice(0, 10)))}. This document sets out planned travel; each flight and stay shows whether it is planned, held, booked, or confirmed.</div>
    `;
  }

  // Booking.com search (through our /go/hotels redirect, which adds partner tracking).
  function hotelLink(city, checkin, checkout, adults) {
    const q = new URLSearchParams({ city: city || "", adults: String(adults || 1) });
    if (checkin && checkout && checkout > checkin) {
      q.set("checkin", checkin);
      q.set("checkout", checkout);
    }
    return `${BASE}/go/hotels?${q}`;
  }

  function travellerCount(s) {
    return Math.max(1, s.travellers.split("\n").filter((t) => t.trim()).length);
  }

  function updateHotelLinks(s) {
    [...document.getElementById("stays").children].forEach((row) => {
      const v = (k) => row.querySelector(`[data-k="${k}"]`).value;
      const link = row.querySelector(".hotel-link");
      link.href = hotelLink(v("city"), v("in"), v("out"), travellerCount(s));
      link.textContent = v("city") ? `Find hotels in ${v("city")} on Booking.com ↗` : "Find hotels on Booking.com ↗";
    });
  }

  function update() {
    const s = read();
    render(s);
    updateHotelLinks(s);
    window.store.set(KEY, s);
  }

  const SAMPLE = {
    tripTitle: "Tourism trip to France & Italy",
    purpose: "Tourism",
    travellers: "Priya Sharma",
    contact: "priya@example.com",
    notes: "Travelling between Paris and Rome by overnight train on 14 May.",
    flights: [
      { date: "2026-05-10", airline: "Air France", flightNo: "", from: "Mumbai (BOM)", to: "Paris (CDG)", dep: "01:35", arr: "07:40", status: "Planned (not booked)" },
      { date: "2026-05-20", airline: "ITA Airways", flightNo: "", from: "Rome (FCO)", to: "Mumbai (BOM)", dep: "21:10", arr: "09:15", status: "Planned (not booked)" },
    ],
    stays: [
      { name: "Hotel near Le Marais", city: "Paris", address: "", in: "2026-05-10", out: "2026-05-14", status: "Reserved (free cancellation)" },
      { name: "Guesthouse in Trastevere", city: "Rome", address: "", in: "2026-05-15", out: "2026-05-20", status: "Reserved (free cancellation)" },
    ],
    days: [
      { date: "2026-05-11", city: "Paris", plan: "Louvre, Tuileries, Seine river walk" },
      { date: "2026-05-12", city: "Paris", plan: "Versailles day trip" },
      { date: "2026-05-16", city: "Rome", plan: "Colosseum, Roman Forum" },
    ],
  };

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  document.querySelectorAll("[data-add]").forEach((b) =>
    b.addEventListener("click", () => {
      addItem(b.dataset.add);
      update();
    })
  );
  document.getElementById("print").addEventListener("click", () => window.print());
  document.getElementById("sample").addEventListener("click", () => {
    load(SAMPLE);
    update();
  });
  document.getElementById("reset").addEventListener("click", () => {
    load({ flights: [{}, {}], stays: [{}], days: [] });
    update();
  });

  // Used by flight-finder.js to add or replace flight rows.
  window.itinerary = { addItem, update, hotelLink, travellerCount: () => travellerCount(read()) };

  load(window.store.get(KEY, null) || { flights: [{}, {}], stays: [{}], days: [] });
  update();
})();
