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

  // --- Airport / city autocomplete (custom combobox; the chosen code lives in input.dataset.code) ---
  const codeOf = (input) => {
    if (input.dataset.code) return input.dataset.code;
    const v = input.value.trim();
    return (/\(([A-Z]{3})\)\s*$/.exec(v) || [])[1] || (/^[A-Z]{3}$/.test(v) ? v : "");
  };

  document.querySelectorAll("[data-place]").forEach((input) => {
    const list = document.getElementById(input.getAttribute("aria-controls"));
    let items = [];
    let active = -1;
    let timer;
    let seq = 0;

    const close = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      active = -1;
    };
    const highlight = (i) => {
      active = i;
      [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
      if (list.children[i]) list.children[i].scrollIntoView({ block: "nearest" });
    };
    const choose = (p) => {
      input.value = p.label;
      input.dataset.code = p.code;
      close();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const render = (places, term) => {
      items = places;
      list.innerHTML = places.length
        ? places.map((p, i) => `<li role="option" id="${list.id}-${i}" class="${p.parent ? "ac-child" : ""}"><span class="ac-code">${esc(p.code)}</span><span>${esc(p.name)}<span class="ac-sub">${esc(p.sub)}</span></span></li>`).join("")
        : `<li class="ac-empty">No airports match "${esc(term)}"</li>`;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
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
          const r = await fetch(`${base}/api/places?term=${encodeURIComponent(term)}&v=2`);
          const { places = [] } = await r.json();
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
    // mousedown (not click) so the choice lands before the input's blur closes the list.
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[role=option]");
      if (!li) return;
      e.preventDefault();
      choose(items[[...list.children].indexOf(li)]);
    });
    input.addEventListener("blur", () => {
      setTimeout(close, 100);
      // Accept a typed 3-letter code without picking from the list.
      const v = input.value.trim().toUpperCase();
      if (!input.dataset.code && /^[A-Z]{3}$/.test(v)) input.dataset.code = v;
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

  // --- Trip type ---
  const retWrap = $("f-ret-wrap");
  const oneWay = () => document.querySelector('input[name="f-trip"]:checked').value === "oneway";
  const syncTrip = () => {
    retWrap.hidden = oneWay();
    saved.trip = oneWay() ? "oneway" : "round";
    window.store.set(KEY, saved);
  };

  const saved = window.store.get(KEY, {});
  ["f-from", "f-to", "f-out", "f-ret"].forEach((id) => {
    if (saved[id]) $(id).value = saved[id];
    if (saved[id + "-code"]) $(id).dataset.code = saved[id + "-code"];
    $(id).addEventListener("change", () => {
      saved[id] = $(id).value;
      saved[id + "-code"] = $(id).dataset.code || "";
      window.store.set(KEY, saved);
    });
  });
  if (saved.trip === "oneway") document.querySelector('input[name="f-trip"][value="oneway"]').checked = true;
  document.querySelectorAll('input[name="f-trip"]').forEach((r) => r.addEventListener("change", syncTrip));
  syncTrip();

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

  // Put a chosen flight into the itinerary: reuse the row this leg filled before, else an empty row, else a new one.
  // Put a chosen option into the itinerary: one row per flight segment (a connection is two rows).
  // Rows this leg filled before are replaced; empty manual rows are reused before adding new ones.
  function apply(leg, f) {
    const box = $("flights");
    box.querySelectorAll(`[data-leg="${leg}"]`).forEach((r) => r.remove());
    const isEmpty = (row) => [...row.querySelectorAll("input")].every((i) => !i.value);
    for (const seg of f.segments || [f]) {
      const row = [...box.children].find((r) => !r.dataset.leg && isEmpty(r)) || it.addItem("flights");
      row.dataset.leg = leg;
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

  // If the first stay has no dates yet, align it with the chosen flights.
  function fillStayDates() {
    const stay = $("stays").firstElementChild;
    if (!stay) return;
    // Check in on the day the last outbound segment departs (connections span two rows).
    const outRow = [...$("flights").querySelectorAll('[data-leg="out"]')].pop();
    const retRow = $("flights").querySelector('[data-leg="ret"]');
    const inEl = stay.querySelector('[data-k="in"]');
    const outEl = stay.querySelector('[data-k="out"]');
    if (outRow && !inEl.value) inEl.value = outRow.querySelector('[data-k="date"]').value;
    if (retRow && !outEl.value) outEl.value = retRow.querySelector('[data-k="date"]').value;
  }

  function renderGroup(leg, title, data) {
    const wrap = document.createElement("div");
    wrap.className = "f-group";
    if (!data.results.length) {
      wrap.innerHTML = `<h4>${esc(title)}</h4><p class="muted" style="margin:0">No flights found for this route in that month. Try a nearby major airport, or add the flight manually below.</p>`;
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
          <button type="button" class="btn btn-ghost btn-sm">${i === 0 ? "Selected" : "Use this"}</button>
          ${f.link ? `<a href="${esc(f.link)}" target="_blank" rel="sponsored noopener">Check fares ↗</a>` : ""}
        </div>
        <div class="f-sub">${esc(niceDate(f.depDate))} · ${f.segments
          ? `${esc(f.fromLabel)} → ${esc(f.viaLabel)} → ${esc(f.toLabel)} · ${esc(fmtDur(f.durationMin))} total · 1 stop, ${esc(fmtDur(f.layoverMin))} layover · ${esc(f.flightNo)}`
          : `${esc(f.fromLabel)} → ${esc(f.toLabel)} · ${esc(fmtDur(f.durationMin))} · ${f.stops ? `${f.stops} stop${f.stops > 1 ? "s" : ""}` : "Direct"}`}${f.aircraft ? ` · ${esc(f.aircraft)}` : ""}${f.price ? ` · recent fare from $${esc(f.price)}` : ""} · <em>${f.source === "timetable" ? "airline timetable" : "recent fare search"}</em></div>`;
      li.querySelector("button").addEventListener("click", () => {
        ul.querySelectorAll(".f-opt").forEach((o) => {
          o.classList.remove("picked");
          o.querySelector("button").textContent = "Use this";
        });
        li.classList.add("picked");
        li.querySelector("button").textContent = "Selected";
        apply(leg, f);
      });
      ul.appendChild(li);
    });
    apply(leg, data.results[0]);
    return wrap;
  }

  $("f-go").addEventListener("click", async () => {
    const from = codeOf($("f-from"));
    const to = codeOf($("f-to"));
    const out = $("f-out").value;
    const ret = oneWay() ? "" : $("f-ret").value;
    status.className = "finder-status";
    results.innerHTML = "";
    if (!from || !to) return fail("Pick a city or airport from the suggestions, or type a 3-letter code (e.g. BOM).");
    if (from === to) return fail("From and To are the same.");
    if (!oneWay() && !ret) return fail("Choose a return date, or switch to One way.");
    if (!out) return fail("Choose a departure date.");
    if (ret && ret < out) return fail("Return date is before the departure date.");

    status.textContent = "Searching real flights…";
    $("f-go").disabled = true;
    try {
      const [o, r] = await Promise.all([lookup(from, to, out), ret ? lookup(to, from, ret) : null]);
      // Nearest-date fallbacks must not put the return before the outbound (or vice versa).
      if (r) {
        r.results = r.results.filter((f) => f.depDate > out);
        o.results = o.results.filter((f) => f.depDate < ret);
      }
      if (!r) {
        // One way: drop a return leg filled by an earlier round-trip search.
        $("flights").querySelectorAll('[data-leg="ret"]').forEach((r) => r.remove());
      }
      results.append(renderGroup("out", "Outbound", o));
      if (r) results.append(renderGroup("ret", "Return", r));
      results.append(hotelCta(o, r));
      const found = o.results.length + (r ? r.results.length : 0);
      status.textContent = found
        ? "We've added the best match (direct flights first) to your itinerary. Choose another option any time. Airlines sometimes change schedules, so check the airline's site before you book."
        : "";
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
