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

  // --- Airport / city autocomplete (native datalist, codes parsed from "(XXX)") ---
  const codeOf = (v) => (/\(([A-Z]{3})\)\s*$/.exec(v || "") || [])[1] || (/^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : "");
  let timer;
  document.querySelectorAll("[data-place]").forEach((input) => {
    const list = document.getElementById(input.getAttribute("list"));
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const term = input.value.trim();
      if (term.length < 2 || codeOf(term)) return;
      timer = setTimeout(async () => {
        try {
          const r = await fetch(`${base}/api/places?term=${encodeURIComponent(term)}`);
          const { places = [] } = await r.json();
          list.innerHTML = places.map((p) => `<option value="${esc(p.label)}">${esc(p.country)}</option>`).join("");
        } catch {
          /* suggestions are optional; a typed 3-letter code still works */
        }
      }, 200);
    });
  });

  const saved = window.store.get(KEY, {});
  ["f-from", "f-to", "f-out", "f-ret"].forEach((id) => {
    if (saved[id]) $(id).value = saved[id];
    $(id).addEventListener("change", () => {
      saved[id] = $(id).value;
      window.store.set(KEY, saved);
    });
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
    const r = await fetch(`${base}/api/flights?from=${from}&to=${to}&date=${date}&v=2`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || "Flight lookup failed.");
    return body;
  }

  // Put a chosen flight into the itinerary: reuse the row this leg filled before, else an empty row, else a new one.
  function apply(leg, f) {
    const rows = [...$("flights").children];
    const isEmpty = (row) => [...row.querySelectorAll("input")].every((i) => !i.value);
    let row = rows.find((r) => r.dataset.leg === leg) || rows.find((r) => !r.dataset.leg && isEmpty(r));
    if (!row) row = it.addItem("flights");
    row.dataset.leg = leg;
    const set = (k, v) => (row.querySelector(`[data-k="${k}"]`).value = v);
    set("date", f.depDate);
    set("airline", f.airlineName);
    set("flightNo", f.flightNo + (f.stops ? ` (${f.stops} stop${f.stops > 1 ? "s" : ""})` : ""));
    set("from", f.fromLabel);
    set("to", f.toLabel);
    set("dep", f.depTime);
    set("arr", f.arrTime);
    set("status", "Planned (not booked)");
    // Keep outbound above return.
    const out = $("flights").querySelector('[data-leg="out"]');
    const ret = $("flights").querySelector('[data-leg="ret"]');
    if (out && ret && out.compareDocumentPosition(ret) & Node.DOCUMENT_POSITION_PRECEDING) $("flights").insertBefore(out, ret);
    fillStayDates();
    it.update();
  }

  // If the first stay has no dates yet, align it with the chosen flights.
  function fillStayDates() {
    const stay = $("stays").firstElementChild;
    if (!stay) return;
    const outRow = $("flights").querySelector('[data-leg="out"]');
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
        <div class="f-main">${esc(f.depTime)} → ${esc(f.arrTime)}${esc(dayShift(f.depDate, f.arrDate))} · ${esc(f.airlineName)} ${esc(f.flightNo.replace(f.airline + " ", ""))}</div>
        <div class="f-act">
          <button type="button" class="btn btn-ghost btn-sm">${i === 0 ? "Selected" : "Use this"}</button>
          ${f.link ? `<a href="${esc(f.link)}" target="_blank" rel="sponsored noopener">Check fares ↗</a>` : ""}
        </div>
        <div class="f-sub">${esc(niceDate(f.depDate))} · ${esc(f.fromLabel)} → ${esc(f.toLabel)} · ${esc(fmtDur(f.durationMin))} · ${f.stops ? `${f.stops} stop${f.stops > 1 ? "s" : ""}` : "Direct"}${f.aircraft ? ` · ${esc(f.aircraft)}` : ""}${f.price ? ` · recent fare from $${esc(f.price)}` : ""} · <em>${f.source === "timetable" ? "airline timetable" : "recent fare search"}</em></div>`;
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
    const from = codeOf($("f-from").value);
    const to = codeOf($("f-to").value);
    const out = $("f-out").value;
    const ret = $("f-ret").value;
    status.className = "finder-status";
    results.innerHTML = "";
    if (!from || !to) return fail("Pick a city or airport from the suggestions, or type a 3-letter code (e.g. BOM).");
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
      results.append(renderGroup("out", "Outbound", o));
      if (r) results.append(renderGroup("ret", "Return", r));
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

  function fail(msg) {
    status.className = "finder-status err";
    status.textContent = msg;
  }
})();
