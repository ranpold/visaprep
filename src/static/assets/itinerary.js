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

  let fieldSeq = 0;
  const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

  function addItem(list, data = {}) {
    const node = document.getElementById("tpl-" + list).content.firstElementChild.cloneNode(true);
    node.querySelectorAll("[data-k]").forEach((el) => {
      if (data[el.dataset.k] != null) el.value = data[el.dataset.k];
    });
    // Link each visible label to its field (rows are cloned, so ids are generated).
    node.querySelectorAll("label").forEach((label) => {
      const field = label.parentElement.querySelector("input:not([type=hidden]), select, textarea");
      if (!field) return;
      field.id ||= `fld-${++fieldSeq}`;
      label.htmlFor = field.id;
    });
    node.querySelectorAll('input[type="date"]').forEach((d) => (d.min = todayLocal()));
    // Rows filled by the flight finder remember their leg so a new search replaces them.
    if (data._leg) node.dataset.leg = data._leg;
    if (list === "flights") {
      const keys = ["date", "dep", "arr", "from", "to"];
      node.addEventListener("input", (e) => {
        // Once the traveller edits a found flight it's theirs: a new search won't replace it.
        delete node.dataset.leg;
        // Hand edits to when/where invalidate the computed duration; fillDurations() recomputes it.
        if (!keys.includes(e.target.dataset.k)) return;
        for (const k of ["dur", "depUtc", "arrUtc", "arrDate"]) node.querySelector(`[data-k="${k}"]`).value = "";
      });
    }
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
  const asDate = (d) => new Date(d + "T00:00:00");
  // "Fri, Nov 20" / "Fri, Nov 20, 2026"
  const dShort = (d) => (d ? asDate(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
  const dLong = (d) => (d ? asDate(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "");
  // "03:40" -> "3:40am"
  const t12 = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
    if (!m) return t || "";
    const h = +m[1];
    return `${h % 12 || 12}:${m[2]}${h < 12 ? "am" : "pm"}`;
  };
  // 580 -> "9 h 40 m"
  const dur = (m) => (m > 0 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m` : "");
  const statusClass = (st) => (/confirmed|booked/i.test(st || "") ? "is-booked" : /held|reserved|host/i.test(st || "") ? "is-held" : "is-plan");
  const shortStatus = (st) => (st || "").replace(/\s*\(.*\)$/, "");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const dayShift = (from, to) => (from && to && to > from ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) : 0);
  const term = (t) => (t ? `<span class="ex-term">Terminal ${esc(t)}</span>` : "");

  // Consecutive flights that connect (same airport, next leaves within a day) form one journey.
  function journeys(flights) {
    const out = [];
    flights.forEach((f, i) => {
      const prev = flights[i - 1];
      const sameAirport = prev && splitPlace(prev.to).code && splitPlace(prev.to).code === splitPlace(f.from).code;
      // With exact times, a connection is a layover under 24 h; without them, only same-day flights connect.
      const layoverMs = prev && +prev.arrUtc && +f.depUtc ? +f.depUtc - +prev.arrUtc : null;
      const connects =
        sameAirport &&
        (layoverMs !== null ? layoverMs > 0 && layoverMs < 86400000 : f.date === (prev.arrDate || prev.date));
      if (connects) out[out.length - 1].push(f);
      else out.push([f]);
    });
    return out;
  }

  function journeyTitle(idx, all) {
    if (all.length === 1) return "Departure";
    const home = splitPlace(all[0][0].from).code;
    const last = all[idx][all[idx].length - 1];
    if (idx === 0) return "Departure";
    if (idx === all.length - 1 && home && splitPlace(last.to).code === home) return "Return";
    return "Departure";
  }

  function journeyBlock(j, title) {
    const first = j[0], last = j[j.length - 1];
    const stops = j.length - 1;
    const total = +first.depUtc && +last.arrUtc ? Math.round((+last.arrUtc - +first.depUtc) / 60000) : j.length === 1 ? +first.dur : 0;
    const segs = j
      .map((f, i) => {
        let lay = "";
        if (i) {
          const p = j[i - 1];
          const mins = +p.arrUtc && +f.depUtc ? Math.round((+f.depUtc - +p.arrUtc) / 60000) : 0;
          const at = splitPlace(p.to);
          lay = `<div class="ex-lay">Layover${mins > 0 ? `: <strong>${esc(dur(mins))}</strong>` : ""} <span>in ${esc(at.city)}${at.code ? ` (${esc(at.code)})` : ""}</span></div>`;
        }
        return lay + segment(f, i === j.length - 1 && j.length > 1 ? first.date : null);
      })
      .join("");
    return `
      <section class="ex-journey">
        <div class="ex-jhead">
          <span class="ex-jdate">${esc(dShort(first.date))}</span>
          <span class="ex-jtitle">– ${esc(title)}</span>
          <span class="ex-jstops">${stops ? esc(plural(stops, "stop")) : "Nonstop"}</span>
          ${total ? `<span class="ex-jtotal">Total travel time: ${esc(dur(total))}</span>` : ""}
        </div>
        ${segs}
      </section>`;
  }

  // One flight: city headline + duration, then departure / arrival lines, carrier details on the right.
  function segment(f, journeyStart) {
    const a = splitPlace(f.from), b = splitPlace(f.to);
    const shift = dayShift(f.date, f.arrDate);
    const carrier = [f.cabin, f.aircraft].filter(Boolean).join(" · ");
    const arrivesOn = journeyStart && f.arrDate && f.arrDate !== journeyStart ? `<div class="ex-arrives">(Arrives on ${esc(dShort(f.arrDate))})</div>` : "";
    return `
      <div class="ex-seg">
        <div class="ex-seghead"><span>${esc(a.city || "—")} <span class="ex-arrow">→</span> ${esc(b.city || "—")}</span><span class="ex-dur">${esc(dur(+f.dur))}</span></div>
        <div class="ex-segbody">
          <div class="ex-ends">
            <div class="ex-end"><span class="ex-code">${esc(a.code)}</span><span class="ex-time">${esc(t12(f.dep)) || "—"}</span>${term(f.depTerm)}</div>
            <div class="ex-end"><span class="ex-code">${esc(b.code)}</span><span class="ex-time">${esc(t12(f.arr)) || "—"}</span>${shift ? `<span class="ex-plus">+${shift} day</span>` : ""}${term(f.arrTerm)}</div>
            ${arrivesOn}
          </div>
          <div class="ex-carrier">
            <div class="ex-airline">${esc(f.airline)}${f.flightNo ? ` <span>${esc(f.flightNo.replace(/^[A-Z0-9]{2}\s+/, ""))}</span>` : ""}</div>
            ${carrier ? `<div class="ex-cabin">${esc(carrier)}</div>` : ""}
            <div class="ex-status ${statusClass(f.status)}">${esc(shortStatus(f.status))}</div>
          </div>
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
    const js = journeys(flights);
    const origin = js[0] ? splitPlace(js[0][0].from) : null;
    const outDest = js[0] ? splitPlace(js[0][js[0].length - 1].to) : null;
    const places = [...new Set([...(outDest ? [outDest.city] : []), ...stays.map((h) => h.city)].filter((c) => c && c !== origin?.city))];
    const roundTrip = js.length > 1 && origin && splitPlace(js[js.length - 1][js[js.length - 1].length - 1].to).code === origin.code;
    const empty = (msg) => `<p class="ex-empty">${msg}</p>`;

    preview.className = "paper exp";
    preview.innerHTML = `
      <header class="ex-top">
        <div>
          <h2>${esc(places[0] || s.tripTitle || "My trip")}</h2>
          <p class="ex-range">${start ? `${esc(dShort(start))} – ${esc(dLong(end))}` : "Dates to be added"}</p>
        </div>
        <p class="ex-doc">Travel itinerary${s.tripTitle ? `<span>${esc(s.tripTitle)}</span>` : ""}</p>
      </header>

      ${origin && outDest ? `<div class="ex-trip">
        <span class="ex-tripline">${esc(origin.city)} (${esc(origin.code)}) <span class="ex-arrow">→</span> ${esc(outDest.city)} (${esc(outDest.code)})</span>
        <span class="ex-tripmeta">${esc([start && end ? `${dShort(start)} – ${dLong(end)}` : "", roundTrip ? "Round trip" : js.length > 1 ? "Multi-city" : "One way", travellers.length ? plural(travellers.length, "traveller") : ""].filter(Boolean).join(" · "))}</span>
      </div>` : ""}

      <section class="ex-block">
        <h3>Traveller information</h3>
        ${travellers.length ? `<ul class="ex-travs">${travellers.map((t) => `<li><strong>${esc(t)}</strong><span>Adult</span></li>`).join("")}</ul>` : empty("Add traveller names")}
        <dl class="ex-facts">
          <div><dt>Purpose of travel</dt><dd>${esc(s.purpose)}</dd></div>
          ${s.contact ? `<div><dt>Contact</dt><dd>${esc(s.contact)}</dd></div>` : ""}
        </dl>
      </section>

      ${inc.flights ? `<section class="ex-block"><h3>Flights</h3>${js.length ? js.map((j, i) => journeyBlock(j, journeyTitle(i, js))).join("") : empty("Add your flights, or use Find flights")}</section>` : ""}

      ${inc.stays ? `<section class="ex-block"><h3>Accommodation</h3>${stays.length ? stays.map((h) => `
        <div class="ex-stay">
          <div class="ex-stayhead"><strong>${esc(h.name) || "Accommodation"}</strong><span class="ex-status ${statusClass(h.status)}">${esc(shortStatus(h.status))}</span></div>
          <div class="ex-stayaddr">${esc([h.address, h.city].filter(Boolean).join(", "))}</div>
          <div class="ex-staydates"><span><em>Check-in</em>${esc(dLong(h.in)) || "—"}</span><span><em>Check-out</em>${esc(dLong(h.out)) || "—"}</span><span><em>Nights</em>${nights(h.in, h.out) || "—"}</span></div>
        </div>`).join("") : empty("Add where you'll stay")}</section>` : ""}

      ${days.length ? `<section class="ex-block"><h3>Day-by-day plan</h3><table class="ex-plan"><tbody>
        ${days.map((d) => `<tr><td class="ex-pdate">${esc(dShort(d.date))}</td><td class="ex-pcity">${esc(d.city)}</td><td>${esc(d.plan)}</td></tr>`).join("")}
      </tbody></table></section>` : ""}

      ${s.notes ? `<section class="ex-block"><h3>Notes</h3><p class="ex-notes">${esc(s.notes)}</p></section>` : ""}
    `;
  }

  // --- Flight durations for flights entered by hand (the flight finder supplies them itself) ---
  const tzCache = {};
  const codeOfLabel = (label) => (/\(([A-Z]{3})\)\s*$/.exec(label || "") || [])[1] || "";
  const addDay = (d) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

  async function loadZones(codes) {
    const need = codes.filter((c) => c && !(c in tzCache));
    if (!need.length) return;
    need.forEach((c) => (tzCache[c] = null));
    try {
      Object.assign(tzCache, await (await fetch(`${BASE}/api/tz?codes=${need.join(",")}`)).json());
    } catch {
      /* no time zones: durations simply stay blank */
    }
  }

  // Local wall-clock date + time in an IANA zone -> UTC milliseconds.
  function zonedToUtc(date, time, tz) {
    const [y, mo, d] = date.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    const wall = Date.UTC(y, mo - 1, d, h, mi);
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const offset = (ms) => {
      const p = Object.fromEntries(fmt.formatToParts(ms).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
    };
    const first = wall - offset(wall);
    return wall - offset(first); // second pass settles daylight-saving edges
  }

  // Returns true if any flight gained a duration (caller re-renders).
  async function fillDurations() {
    const rows = [...document.getElementById("flights").children];
    const field = (r, k) => r.querySelector(`[data-k="${k}"]`);
    const todo = rows.filter((r) => !field(r, "dur").value && field(r, "date").value && field(r, "dep").value && field(r, "arr").value && codeOfLabel(field(r, "from").value) && codeOfLabel(field(r, "to").value));
    if (!todo.length) return false;
    await loadZones([...new Set(todo.flatMap((r) => [codeOfLabel(field(r, "from").value), codeOfLabel(field(r, "to").value)]))]);
    let changed = false;
    for (const r of todo) {
      const tzA = tzCache[codeOfLabel(field(r, "from").value)], tzB = tzCache[codeOfLabel(field(r, "to").value)];
      if (!tzA || !tzB) continue;
      const dep = zonedToUtc(field(r, "date").value, field(r, "dep").value, tzA);
      let arrDate = field(r, "arrDate").value || field(r, "date").value;
      let arr = zonedToUtc(arrDate, field(r, "arr").value, tzB);
      // No arrival date known: an arrival "before" departure means it lands the next day.
      for (let i = 0; !field(r, "arrDate").value && arr <= dep && i < 2; i++) {
        arrDate = addDay(arrDate);
        arr = zonedToUtc(arrDate, field(r, "arr").value, tzB);
      }
      const mins = Math.round((arr - dep) / 60000);
      if (mins <= 0 || mins > 40 * 60) continue;
      field(r, "dur").value = mins;
      field(r, "depUtc").value = dep;
      field(r, "arrUtc").value = arr;
      field(r, "arrDate").value = arrDate;
      changed = true;
    }
    return changed;
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
    fillDurations().then((changed) => changed && update());
  }

  // Example trip ~2 months ahead so its dates are never in the past.
  const plusDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-CA");
  };
  const SAMPLE = {
    tripTitle: "Tourism trip to France & Italy",
    purpose: "Tourism",
    travellers: "Priya Sharma",
    contact: "priya@example.com",
    notes: `Travelling between Paris and Rome by overnight train on ${new Date(plusDays(64) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.`,
    flights: [
      { date: plusDays(60), airline: "Air France", flightNo: "", from: "Mumbai (BOM)", to: "Paris (CDG)", dep: "01:35", arr: "07:40", status: "Planned (not booked)" },
      { date: plusDays(70), airline: "ITA Airways", flightNo: "", from: "Rome (FCO)", to: "Mumbai (BOM)", dep: "21:10", arr: "09:15", status: "Planned (not booked)" },
    ],
    stays: [
      { name: "Hotel near Le Marais", city: "Paris", address: "", in: plusDays(60), out: plusDays(64), status: "Reserved (free cancellation)" },
      { name: "Guesthouse in Trastevere", city: "Rome", address: "", in: plusDays(65), out: plusDays(70), status: "Reserved (free cancellation)" },
    ],
    days: [
      { date: plusDays(61), city: "Paris", plan: "Louvre, Tuileries, Seine river walk" },
      { date: plusDays(62), city: "Paris", plan: "Versailles day trip" },
      { date: plusDays(66), city: "Rome", plan: "Colosseum, Roman Forum" },
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
  // True if the traveller has typed anything worth protecting.
  const hasDraft = () => {
    const s = read();
    const filled = (rows) => rows.some((r) => Object.entries(r).some(([k, v]) => v && !["status", "cabin", "_leg"].includes(k)));
    return !!(s.tripTitle || s.travellers || s.contact || s.notes || filled(s.flights) || filled(s.stays) || filled(s.days));
  };
  document.getElementById("sample").addEventListener("click", () => {
    if (hasDraft() && !confirm("Replace your current itinerary with the example trip?")) return;
    load(SAMPLE);
    update();
  });
  document.getElementById("reset").addEventListener("click", () => {
    if (hasDraft() && !confirm("Clear everything in this itinerary? This can't be undone.")) return;
    load({ flights: [{}, {}], stays: [{}], days: [] });
    window.dispatchEvent(new Event("itinerary:reset"));
    update();
  });

  // Used by flight-finder.js to add or replace flight rows.
  window.itinerary = { addItem, update, hotelLink, travellerCount: () => travellerCount(read()) };

  load(window.store.get(KEY, null) || { flights: [{}, {}], stays: [{}], days: [] });
  update();
})();
