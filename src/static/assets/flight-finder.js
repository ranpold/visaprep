// Flight finder: looks up real flights for a route + date via /api/flights, auto-fills the best
// match (direct first) into the itinerary, and lists alternatives the traveller can swap in.
(function () {
  const it = window.itinerary;
  if (!it) return;
  const esc = window.escapeHtml;
  const base = document.querySelector('link[rel="icon"]').getAttribute("href").replace(/\/assets\/favicon\.svg$/, "");
  const $ = (id) => document.getElementById(id);
  const status = $("f-status");
  const results = $("f-results");
  const KEY = "visaprep.finder.v1";
  const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

  // --- Airport / city autocomplete (custom combobox; the chosen code lives in input.dataset.code) ---
  const codeOf = (input) => input.dataset.code || (/\(([A-Z]{3})\)\s*$/.exec(input.value.trim()) || [])[1] || "";

  async function fetchPlaces(term) {
    const r = await fetch(`${base}/api/places?term=${encodeURIComponent(term)}&v=3`);
    return (await r.json()).places || [];
  }

  // A typed 3-letter code is only accepted if it really is an airport/city code ("goa" is not GOA/Genoa).
  async function resolveCode(input) {
    if (codeOf(input)) return codeOf(input);
    const v = input.value.trim();
    if (!/^[A-Za-z]{3}$/.test(v)) return "";
    try {
      // A place *named* what was typed wins over a code match ("Goa" is Goa/GOI, not GOA/Genoa).
      const places = await fetchPlaces(v);
      const match = places.find((p) => p.name.toLowerCase() === v.toLowerCase()) || places.find((p) => p.code === v.toUpperCase());
      if (!match) return "";
      input.value = match.label;
      input.dataset.code = match.code;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return match.code;
    } catch {
      return "";
    }
  }

  document.querySelectorAll("[data-place]").forEach((input) => {
    const list = document.getElementById(input.getAttribute("aria-controls"));
    let items = [];
    let active = -1;
    let timer;
    let seq = 0;

    const close = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    };
    const highlight = (i) => {
      active = i;
      [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
      const li = list.children[i];
      if (li) {
        li.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", li.id);
      }
    };
    const choose = (p) => {
      clearTimeout(timer);
      seq++; // drop any search still in flight so it can't reopen the list
      input.value = p.label;
      input.dataset.code = p.code;
      close();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const render = (places, term) => {
      items = places;
      list.innerHTML = places.length
        ? places.map((p, i) => `<li role="option" id="${list.id}-${i}" aria-selected="false" class="${p.parent ? "ac-child" : ""}"><span class="ac-code">${esc(p.code)}</span><span>${esc(p.name)}<span class="ac-sub">${esc(p.sub)}</span></span></li>`).join("")
        : `<li class="ac-empty">No airports match "${esc(term)}"</li>`;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    };

    input.addEventListener("input", () => {
      delete input.dataset.code;
      clearTimeout(timer);
      const term = input.value.trim();
      if (term.length < 2) return close();
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const places = await fetchPlaces(term);
          if (mine === seq) render(places, term); // ignore out-of-order responses
        } catch {
          close();
        }
      }, 150);
    });
    // Selecting on focus means typing replaces a previous choice instead of editing inside it.
    input.addEventListener("focus", () => input.select());
    input.addEventListener("keydown", (e) => {
      if (list.hidden || !items.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(active + 1, items.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); choose(items[Math.max(active, 0)]); }
      else if (e.key === "Escape") close();
    });
    // Prevent the input losing focus on any press inside the list (options or its scrollbar).
    list.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const li = e.target.closest("li[role=option]");
      if (li) choose(items[[...list.children].indexOf(li)]);
    });
    input.addEventListener("blur", () => {
      // Cancel a search still waiting to run so the list can't reopen after focus has moved on.
      clearTimeout(timer);
      seq++;
      setTimeout(close, 100);
      resolveCode(input);
    });
  });

  // --- Swap From / To ---
  $("f-swap").addEventListener("click", (e) => {
    const a = $("f-from"), b = $("f-to");
    [a.value, b.value] = [b.value, a.value];
    const [ca, cb] = [a.dataset.code, b.dataset.code];
    if (cb) a.dataset.code = cb; else delete a.dataset.code;
    if (ca) b.dataset.code = ca; else delete b.dataset.code;
    [a, b].forEach((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
    e.currentTarget.classList.toggle("spun");
  });

  // --- Trip type, dates, saved state ---
  const retWrap = $("f-ret-wrap");
  const oneWay = () => document.querySelector('input[name="f-trip"]:checked').value === "oneway";
  const syncTrip = () => {
    retWrap.hidden = oneWay();
    saved.trip = oneWay() ? "oneway" : "round";
    window.store.set(KEY, saved);
  };
  // No past dates; the return can't be before the departure.
  const syncDateLimits = () => {
    $("f-out").min = today();
    $("f-ret").min = $("f-out").value || today();
  };

  let saved = window.store.get(KEY, {});
  ["f-from", "f-to", "f-out", "f-ret"].forEach((id) => {
    if (saved[id]) $(id).value = saved[id];
    if (saved[id + "-code"]) $(id).dataset.code = saved[id + "-code"];
    $(id).addEventListener("change", () => {
      saved[id] = $(id).value;
      saved[id + "-code"] = $(id).dataset.code || "";
      window.store.set(KEY, saved);
      syncDateLimits();
    });
  });
  if (saved.trip === "oneway") document.querySelector('input[name="f-trip"][value="oneway"]').checked = true;
  document.querySelectorAll('input[name="f-trip"]').forEach((r) => r.addEventListener("change", syncTrip));
  syncTrip();
  syncDateLimits();

  // "Clear all" in the itinerary also resets this panel.
  window.addEventListener("itinerary:reset", () => {
    ["f-from", "f-to", "f-out", "f-ret"].forEach((id) => {
      $(id).value = "";
      delete $(id).dataset.code;
    });
    document.querySelector('input[name="f-trip"][value="round"]').checked = true;
    saved = {};
    window.store.set(KEY, saved);
    syncTrip();
    syncDateLimits();
    results.innerHTML = "";
    status.className = "finder-status";
    status.textContent = "";
  });

  // --- Search ---
  const fmtDur = (m) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");
  const dayShift = (a, b) => {
    const d = Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    return d > 0 ? ` (+${d})` : "";
  };
  const niceDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  async function lookup(from, to, date) {
    // `v` changes when the API's result format or logic changes, bypassing stale browser caches.
    const r = await fetch(`${base}/api/flights?from=${from}&to=${to}&date=${date}&v=4`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || "Flight lookup failed.");
    return body;
  }

  // Put a chosen option into the itinerary: one row per flight segment (a connection is two rows).
  // Rows this leg filled before are replaced (rows the traveller edited by hand lose their leg
  // marker in itinerary.js, so they're kept); empty manual rows are reused before adding new ones.
  function apply(leg, f) {
    const box = $("flights");
    box.querySelectorAll(`[data-leg="${leg}"]`).forEach((r) => r.remove());
    // All segments of one option share a group, so editing one keeps the whole connection.
    const group = `${leg}-${Date.now()}`;
    const isEmpty = (row) => [...row.querySelectorAll("input:not([type=hidden])")].every((i) => !i.value);
    for (const seg of f.segments || [f]) {
      const row = [...box.children].find((r) => !r.dataset.leg && isEmpty(r)) || it.addItem("flights");
      row.dataset.leg = leg;
      row.dataset.group = group;
      const set = (k, v) => (row.querySelector(`[data-k="${k}"]`).value = v);
      set("date", seg.depDate);
      set("airline", seg.airlineName);
      set("flightNo", seg.flightNo + (seg.stops ? ` (${seg.stops} stop${seg.stops > 1 ? "s" : ""})` : ""));
      set("from", seg.fromLabel);
      set("to", seg.toLabel);
      set("dep", seg.depTime);
      set("arr", seg.arrTime);
      set("status", "Planned (not booked)");
      set("aircraft", seg.aircraft || "");
      set("depTerm", seg.depTerminal || "");
      set("arrTerm", seg.arrTerminal || "");
      set("arrDate", seg.arrDate || "");
      set("dur", seg.durationMin || "");
      set("depUtc", seg.depUtc || "");
      set("arrUtc", seg.arrUtc || "");
      box.appendChild(row);
    }
    // Outbound rows first, then return, then anything the traveller added by hand.
    const rank = (r) => ({ out: 0, ret: 1 })[r.dataset.leg] ?? 2;
    [...box.children].sort((a, b) => rank(a) - rank(b)).forEach((r) => box.appendChild(r));
    fillStayDates();
    it.update();
  }

  // Align the first stay with the chosen flights. Dates we filled earlier are updated on a new
  // search; dates the traveller typed are left alone.
  function fillStayDates() {
    const stay = $("stays").firstElementChild;
    if (!stay) return;
    const outRows = [...$("flights").querySelectorAll('[data-leg="out"]')];
    const last = outRows[outRows.length - 1];
    const retRow = $("flights").querySelector('[data-leg="ret"]');
    const fill = (k, value) => {
      const el = stay.querySelector(`[data-k="${k}"]`);
      if (!value || (el.value && el.value !== stay.dataset["auto_" + k])) return;
      el.value = value;
      stay.dataset["auto_" + k] = value;
    };
    // Check in on the day the last outbound flight lands.
    if (last) fill("in", last.querySelector('[data-k="arrDate"]').value || last.querySelector('[data-k="date"]').value);
    if (retRow) fill("out", retRow.querySelector('[data-k="date"]').value);
  }

  function renderGroup(leg, title, data) {
    const wrap = document.createElement("div");
    wrap.className = "f-group";
    if (!data.results.length) {
      // Don't leave a previous search's flight for this leg in the itinerary.
      $("flights").querySelectorAll(`[data-leg="${leg}"]`).forEach((r) => r.remove());
      it.update();
      wrap.innerHTML = `<h4>${esc(title)}</h4><p class="muted" style="margin:0">No flights found for this route around that date. Try a nearby major airport, or add the flight manually below.</p>`;
      return wrap;
    }
    const note = data.exact ? "" : ` <span class="muted">No data for ${esc(niceDate(data.date))}, so these are the nearest dates</span>`;
    wrap.innerHTML = `<h4>${esc(title)}${note}</h4><ul class="f-list"></ul>`;
    const ul = wrap.querySelector("ul");
    data.results.forEach((f, i) => {
      const li = document.createElement("li");
      li.className = "f-opt" + (i === 0 ? " picked" : "");
      li.innerHTML = `
        <div class="f-main">${esc(f.depTime)} → ${esc(f.arrTime)}${esc(dayShift(f.depDate, f.arrDate))} · ${esc(f.airlineName)} ${f.segments ? "" : esc(f.flightNo.replace(f.airline + " ", ""))}</div>
        <div class="f-act">
          <button type="button" class="btn btn-ghost btn-sm" aria-pressed="${i === 0}">${i === 0 ? "Selected" : "Use this"}</button>
          ${f.link ? `<a href="${esc(f.link)}" target="_blank" rel="sponsored noopener">Check fares ↗</a>` : ""}
        </div>
        <div class="f-sub">${esc(niceDate(f.depDate))} · ${f.segments
          ? `${esc(f.fromLabel)} → ${esc(f.viaLabel)} → ${esc(f.toLabel)} · ${esc(fmtDur(f.durationMin))} total · 1 stop, ${esc(fmtDur(f.layoverMin))} layover · ${esc(f.flightNo)}`
          : `${esc(f.fromLabel)} → ${esc(f.toLabel)} · ${esc(fmtDur(f.durationMin))} · ${f.stops ? `${f.stops} stop${f.stops > 1 ? "s" : ""}` : "Direct"}`}${f.aircraft ? ` · ${esc(f.aircraft)}` : ""}${f.price ? ` · recent fare from $${esc(f.price)}` : ""} · <em>${f.source === "timetable" ? "airline timetable" : "recent fare search"}</em></div>`;
      li.querySelector("button").addEventListener("click", () => {
        ul.querySelectorAll(".f-opt").forEach((o) => {
          o.classList.remove("picked");
          const b = o.querySelector("button");
          b.textContent = "Use this";
          b.setAttribute("aria-pressed", "false");
        });
        li.classList.add("picked");
        const b = li.querySelector("button");
        b.textContent = "Selected";
        b.setAttribute("aria-pressed", "true");
        apply(leg, f);
      });
      ul.appendChild(li);
    });
    apply(leg, data.results[0]);
    return wrap;
  }

  $("f-go").addEventListener("click", async () => {
    status.className = "finder-status";
    status.textContent = "";
    const [from, to] = await Promise.all([resolveCode($("f-from")), resolveCode($("f-to"))]);
    const out = $("f-out").value;
    const ret = oneWay() ? "" : $("f-ret").value;
    // Validate first; previous results stay visible until a search actually runs.
    if (!from || !to) return fail("Pick a city or airport from the suggestions, or type a valid 3-letter code (e.g. BOM).");
    if (from === to) return fail("From and To are the same.");
    if (!out) return fail("Choose a departure date.");
    if (out < today()) return fail("The departure date is in the past.");
    if (!oneWay() && !ret) return fail("Choose a return date, or switch to One way.");
    if (ret && ret < out) return fail("Return date is before the departure date.");

    results.innerHTML = "";
    status.textContent = "Searching real flights…";
    $("f-go").disabled = true;
    try {
      const [o, r] = await Promise.all([lookup(from, to, out), ret ? lookup(to, from, ret) : null]);
      // Nearest-date fallbacks must not put the return before the outbound (same day is fine).
      if (r) {
        r.results = r.results.filter((f) => f.depDate >= out);
        o.results = o.results.filter((f) => f.depDate <= ret);
      }
      if (!r) {
        // One way: drop a return leg filled by an earlier round-trip search.
        $("flights").querySelectorAll('[data-leg="ret"]').forEach((row) => row.remove());
      }
      results.append(renderGroup("out", "Outbound", o));
      if (r) results.append(renderGroup("ret", "Return", r));
      results.append(hotelCta(o, r));
      const found = o.results.length + (r ? r.results.length : 0);
      const degraded = o.notice === "timetable-unavailable" || r?.notice === "timetable-unavailable";
      status.textContent = found
        ? "We've added the best match (direct flights first) to your itinerary. Choose another option any time. Airlines sometimes change schedules, so check the airline's site before you book." +
          (degraded ? " Live airline timetables are briefly unavailable, so these come from recent fare searches only." : "")
        : degraded
        ? "Live airline timetables are temporarily unavailable, so we couldn't look up this route. Please try again later, or add your flights manually below."
        : "No flights found. You can still add flights manually below.";
    } catch (e) {
      fail(e.message);
    } finally {
      $("f-go").disabled = false;
    }
  });

  // "Find hotels" for the destination, dated from the chosen outbound arrival to the return flight.
  function hotelCta(o, r) {
    const first = o.results[0];
    const wrap = document.createElement("p");
    wrap.className = "hotel-cta";
    if (!first) return wrap;
    const last = first.segments ? first.segments[first.segments.length - 1] : first;
    const city = (last.toLabel || "").replace(/\s*\([A-Z]{3}\)$/, "");
    const checkin = last.arrDate || last.depDate;
    const checkout = r && r.results[0] ? r.results[0].depDate : "";
    const a = document.createElement("a");
    a.className = "btn btn-ghost btn-sm";
    a.target = "_blank";
    a.rel = "sponsored nofollow noopener";
    a.href = it.hotelLink(city, checkin, checkout, it.travellerCount());
    a.textContent = `Find hotels in ${city} on Booking.com ↗`;
    wrap.append(a);
    return wrap;
  }

  function fail(msg) {
    status.className = "finder-status err";
    status.textContent = msg;
  }
})();
