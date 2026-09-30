// Itinerary builder: repeatable form sections -> live "plan" document preview -> print to PDF.
(function () {
  const KEY = "visaprep.itinerary.v1";
  const form = document.getElementById("it-form");
  const preview = document.getElementById("preview");
  const LISTS = ["flights", "stays", "days"];
  const esc = window.escapeHtml;

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

  function render(s) {
    const travellers = s.travellers.split("\n").map((t) => t.trim()).filter(Boolean);
    const flights = s.flights.filter((f) => f.from || f.to || f.date).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const stays = s.stays.filter((h) => h.name || h.city).sort((a, b) => (a.in || "").localeCompare(b.in || ""));
    const days = s.days.filter((d) => d.date || d.plan).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const allDates = [...flights.map((f) => f.date), ...stays.flatMap((h) => [h.in, h.out]), ...days.map((d) => d.date)].filter(Boolean).sort();
    const range = allDates.length ? `${fmtDate(allDates[0])} to ${fmtDate(allDates[allDates.length - 1])}` : "Dates to be added";
    const empty = (msg) => `<p class="empty">${msg}</p>`;

    preview.innerHTML = `
      <div class="doc-banner">TRAVEL ITINERARY PLAN · NOT A TICKET OR BOOKING CONFIRMATION</div>
      <div class="doc-head">
        <div>
          <h2>${esc(s.tripTitle) || "My trip"}</h2>
          <div>${esc(range)}</div>
        </div>
        <div style="text-align:right">
          <div><strong>Purpose:</strong> ${esc(s.purpose)}</div>
          ${s.contact ? `<div>${esc(s.contact)}</div>` : ""}
        </div>
      </div>

      <div class="doc-section">Traveller${travellers.length === 1 ? "" : "s"}</div>
      ${travellers.length ? `<div>${travellers.map(esc).join("<br>")}</div>` : empty("Add traveller names")}

      <div class="doc-section">Flights</div>
      ${flights.length ? `<table><thead><tr><th>Date</th><th>Route</th><th>Airline / flight</th><th>Time</th><th>Status</th></tr></thead><tbody>
        ${flights.map((f) => `<tr><td>${esc(fmtDate(f.date))}</td><td>${esc(f.from)} → ${esc(f.to)}</td><td>${esc(f.airline)}${f.flightNo ? " " + esc(f.flightNo) : ""}</td><td>${esc(f.dep)}${f.arr ? "–" + esc(f.arr) : ""}</td><td>${esc(f.status)}</td></tr>`).join("")}
      </tbody></table>` : empty("Add your planned flights")}

      <div class="doc-section">Accommodation</div>
      ${stays.length ? `<table><thead><tr><th>Stay</th><th>Dates</th><th>Nights</th><th>Status</th></tr></thead><tbody>
        ${stays.map((h) => `<tr><td><strong>${esc(h.name)}</strong>${h.city ? ", " + esc(h.city) : ""}${h.address ? `<br><small>${esc(h.address)}</small>` : ""}</td><td>${esc(fmtDate(h.in))}${h.out ? " → " + esc(fmtDate(h.out)) : ""}</td><td>${nights(h.in, h.out)}</td><td>${esc(h.status)}</td></tr>`).join("")}
      </tbody></table>` : empty("Add where you'll stay")}

      ${days.length ? `<div class="doc-section">Day-by-day plan</div><table><thead><tr><th>Date</th><th>City</th><th>Plans</th></tr></thead><tbody>
        ${days.map((d) => `<tr><td>${esc(fmtDate(d.date))}</td><td>${esc(d.city)}</td><td>${esc(d.plan)}</td></tr>`).join("")}
      </tbody></table>` : ""}

      ${s.notes ? `<div class="doc-section">Notes</div><div style="white-space:pre-wrap">${esc(s.notes)}</div>` : ""}

      <div class="doc-foot">Prepared by the traveller on ${esc(fmtDate(new Date().toISOString().slice(0, 10)))}. This document sets out planned travel. The status column shows whether each item is planned, held, or booked.</div>
    `;
  }

  function update() {
    const s = read();
    render(s);
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
  window.itinerary = { addItem, update };

  load(window.store.get(KEY, null) || { flights: [{}, {}], stays: [{}], days: [] });
  update();
})();
