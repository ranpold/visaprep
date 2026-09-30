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
      inc: { flights: form.incFlights.checked, stays: form.incStays.checked, days: form.incDays.checked },
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
    const inc = state.inc || {};
    form.incFlights.checked = inc.flights !== false;
    form.incStays.checked = inc.stays !== false;
    form.incDays.checked = inc.days !== false;
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
  const longDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "");
  const fmtDur = (m) => (m > 0 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");
  const statusClass = (st) => (/confirmed|booked/i.test(st || "") ? "is-booked" : /held|reserved|host/i.test(st || "") ? "is-held" : "is-plan");
  const shortStatus = (st) => (st || "").replace(/\s*\(.*\)$/, "");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const dayShift = (from, to) => (from && to && to > from ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) : 0);

  // Consecutive flights that connect (same airport, next leaves within a day) form one journey.
  function journeys(flights) {
    const out = [];
    flights.forEach((f, i) => {
      const prev = flights[i - 1];
      const connects =
        prev &&
        splitPlace(prev.to).code &&
        splitPlace(prev.to).code === splitPlace(f.from).code &&
        Date.parse(f.date) - Date.parse(prev.arrDate || prev.date) <= 86400000;
      if (connects) out[out.length - 1].push(f);
      else out.push([f]);
    });
    return out;
  }

  function journeyTitle(j, idx, all) {
    if (all.length === 1) return "Flight";
    const home = splitPlace(all[0][0].from).code;
    if (idx === 0) return "Departure";
    if (idx === all.length - 1 && home && splitPlace(j[j.length - 1].to).code === home) return "Return";
    return `Journey ${idx + 1}`;
  }

  function journeyBlock(j, title) {
    const first = j[0], last = j[j.length - 1];
    const stops = j.length - 1;
    const total = +first.depUtc && +last.arrUtc ? Math.round((+last.arrUtc - +first.depUtc) / 60000) : j.length === 1 ? +first.dur : 0;
    const a = splitPlace(first.from), b = splitPlace(last.to);
    // Year is already in the document header, so the journey bar stays short enough for one line.
    const facts = [shortDate(first.date), stops ? plural(stops, "stop") : "Non-stop", fmtDur(total)].filter(Boolean);
    const rows = j
      .map((f, i) => {
        let lay = "";
        if (i) {
          const p = j[i - 1];
          const mins = +p.arrUtc && +f.depUtc ? Math.round((+f.depUtc - +p.arrUtc) / 60000) : 0;
          const at = splitPlace(p.to);
          lay = `<div class="it-lay"><span>${mins > 0 ? esc(fmtDur(mins)) + " layover" : "Connection"} · ${esc(at.city)}${at.code ? ` (${esc(at.code)})` : ""}</span></div>`;
        }
        return lay + segment(f);
      })
      .join("");
    return `
      <section class="it-journey">
        <header class="it-jhead">
          <h3>${esc(title)}</h3>
          <p class="it-route">${esc(a.city || "—")} <span aria-hidden="true">→</span> ${esc(b.city || "—")}</p>
          <p class="it-facts">${facts.map(esc).join(" · ")}</p>
        </header>
        ${rows}
      </section>`;
  }

  function segment(f) {
    const a = splitPlace(f.from), b = splitPlace(f.to);
    const shift = dayShift(f.date, f.arrDate);
    const detail = [fmtDur(+f.dur), f.aircraft].filter(Boolean).join(" · ");
    return `
      <div class="it-seg">
        <div class="it-times">
          <div class="it-pt"><span class="it-time">${esc(f.dep) || "--:--"}</span><span class="it-code">${esc(a.code)}</span><span class="it-city">${esc(a.city)}</span></div>
          <div class="it-track" aria-hidden="true"></div>
          <div class="it-pt"><span class="it-time">${esc(f.arr) || "--:--"}${shift ? `<sup>+${shift}</sup>` : ""}</span><span class="it-code">${esc(b.code)}</span><span class="it-city">${esc(b.city)}${shift ? ` · ${esc(shortDate(f.arrDate))}` : ""}</span></div>
        </div>
        <div class="it-carrier">
          <div class="it-flno">${esc(f.flightNo) || "&nbsp;"}</div>
          <div class="it-air">${esc(f.airline)}</div>
          ${detail ? `<div class="it-det">${esc(detail)}</div>` : ""}
          <div class="it-status ${statusClass(f.status)}">${esc(shortStatus(f.status))}</div>
        </div>
      </div>`;
  }

  function render(s) {
    const inc = s.inc || { flights: true, stays: true, days: true };
    const travellers = s.travellers.split("\n").map((t) => t.trim()).filter(Boolean);
    const flights = (inc.flights ? s.flights : []).filter((f) => f.from || f.to || f.date).sort((a, b) => ((a.date || "") + (a.dep || "")).localeCompare((b.date || "") + (b.dep || "")));
    const stays = (inc.stays ? s.stays : []).filter((h) => h.name || h.city).sort((a, b) => (a.in || "").localeCompare(b.in || ""));
    const days = (inc.days ? s.days : []).filter((d) => d.date || d.plan).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const allDates = [...flights.flatMap((f) => [f.date, f.arrDate]), ...stays.flatMap((h) => [h.in, h.out]), ...days.map((d) => d.date)].filter(Boolean).sort();
    const start = allDates[0], end = allDates[allDates.length - 1];
    const tripDays = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 : 0;
    const stayNights = stays.reduce((n, h) => n + (+nights(h.in, h.out) || 0), 0);
    const js = journeys(flights);
    const origin = flights[0] ? splitPlace(flights[0].from).city : "";
    const places = [...new Set([...stays.map((h) => h.city), ...js.map((j) => splitPlace(j[j.length - 1].to).city)].filter((c) => c && c !== origin))];
    const empty = (msg) => `<p class="it-empty">${msg}</p>`;

    preview.className = "paper itin";
    preview.innerHTML = `
      <header class="it-head">
        <div class="it-titleblock">
          <p class="it-kicker">Travel itinerary</p>
          <h2>${esc(s.tripTitle) || "My trip"}</h2>
          <p class="it-dates">${start ? `${esc(longDate(start))} – ${esc(longDate(end))}` : "Dates to be added"}</p>
        </div>
        <dl class="it-people">
          <div><dt>${travellers.length === 1 ? "Traveller" : "Travellers"}</dt><dd>${travellers.length ? travellers.map(esc).join("<br>") : '<span class="it-empty">Add names</span>'}</dd></div>
          <div><dt>Purpose</dt><dd>${esc(s.purpose)}</dd></div>
          ${s.contact ? `<div><dt>Contact</dt><dd>${esc(s.contact)}</dd></div>` : ""}
        </dl>
      </header>

      <dl class="it-summary">
        <div><dt>Destination${places.length === 1 ? "" : "s"}</dt><dd>${places.length ? esc(places.join(", ")) : "—"}</dd></div>
        <div><dt>Duration</dt><dd>${tripDays ? esc(plural(tripDays, "day")) : "—"}${stayNights ? ` · ${esc(plural(stayNights, "night"))} stay` : ""}</dd></div>
        <div><dt>Travellers</dt><dd>${travellers.length || "—"}</dd></div>
      </dl>

      ${inc.flights ? `<h3 class="it-sec">Flights</h3>${js.length ? js.map((j, i) => journeyBlock(j, journeyTitle(j, i, js))).join("") : empty("Add your flights, or use Find flights")}` : ""}

      ${inc.stays ? `<h3 class="it-sec">Accommodation</h3>${stays.length ? `
        <table class="it-table">
          <thead><tr><th>Stay</th><th>Check-in</th><th>Check-out</th><th class="num">Nights</th><th>Status</th></tr></thead>
          <tbody>${stays.map((h) => `<tr>
            <td><strong>${esc(h.name) || "Accommodation"}</strong><span class="it-sub">${esc(h.city)}${h.address ? ` · ${esc(h.address)}` : ""}</span></td>
            <td>${esc(shortDate(h.in)) || "—"}</td><td>${esc(shortDate(h.out)) || "—"}</td>
            <td class="num">${nights(h.in, h.out) || "—"}</td>
            <td><span class="it-status ${statusClass(h.status)}">${esc(shortStatus(h.status))}</span></td></tr>`).join("")}</tbody>
        </table>` : empty("Add where you'll stay")}` : ""}

      ${days.length ? `<h3 class="it-sec">Day-by-day plan</h3>
        <table class="it-table it-plan"><tbody>
        ${days.map((d) => `<tr><td class="it-pdate">${esc(shortDate(d.date))}</td><td class="it-pcity">${esc(d.city)}</td><td>${esc(d.plan)}</td></tr>`).join("")}
        </tbody></table>` : ""}

      ${s.notes ? `<h3 class="it-sec">Notes</h3><p class="it-notes">${esc(s.notes)}</p>` : ""}
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
    document.getElementById("fs-flights").hidden = !s.inc.flights;
    document.getElementById("fs-stays").hidden = !s.inc.stays;
    document.getElementById("fs-days").hidden = !s.inc.days;
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
  document.getElementById("print").addEventListener("click", (e) =>
    window.downloadPdf(preview, `${form.tripTitle.value || "travel"} itinerary`, e.currentTarget)
  );
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
