// Renders the selected visa checklist with persisted tick state and a progress bar.
(function () {
  const data = window.CHECKLISTS;
  const esc = window.escapeHtml;
  const base = document.querySelector('link[rel="icon"]').getAttribute("href").replace(/\/assets\/favicon\.svg$/, "");
  const select = document.getElementById("visa");
  const out = document.getElementById("checklist-out");
  const TICKS = "visaprep.checklist.ticks.v1";
  const LAST = "visaprep.checklist.last.v1";
  const toolLinks = {
    itinerary: `<a href="${base}/itinerary">Build it free →</a>`,
    cover: `<a href="${base}/cover-letter">Generate it free →</a>`,
  };

  select.innerHTML = Object.entries(data).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("");
  // Own keys only, so a crafted hash like #constructor can't match Object.prototype.
  const isVisa = (k) => Object.hasOwn(data, k);
  const fromHash = location.hash.slice(1);
  const last = window.store.get(LAST, "schengen");
  select.value = isVisa(fromHash) ? fromHash : isVisa(last) ? last : "schengen";

  function render() {
    const key = select.value;
    const c = data[key];
    const ticks = window.store.get(TICKS, {})[key] || {};
    let n = 0;
    out.innerHTML = `
      <h2>${esc(c.name)}</h2>
      <p>${esc(c.intro)}</p>
      <p class="tip">Official source: <a href="${c.official}" target="_blank" rel="noopener">${esc(c.officialLabel)}</a></p>
      <div class="progress" role="progressbar" aria-label="Checklist progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div></div></div>
      <p class="muted" id="count"></p>
      ${c.sections.map((sec) => `
        <h3>${esc(sec.title)}</h3>
        <ul class="checklist">
          ${sec.items.map(([label, note, tool]) => {
            const id = `${key}-${n++}`;
            return `<li><input type="checkbox" id="${id}" ${ticks[id] ? "checked" : ""}><label for="${id}">${esc(label)}${note || tool ? `<span class="note">${esc(note || "")} ${tool ? toolLinks[tool] : ""}</span>` : ""}</label></li>`;
          }).join("")}
        </ul>`).join("")}
    `;
    progress();
    window.store.set(LAST, key);
    if (location.hash !== "#" + key) history.replaceState(null, "", "#" + key);
  }

  function progress() {
    const boxes = out.querySelectorAll('input[type="checkbox"]');
    const done = [...boxes].filter((b) => b.checked).length;
    const pct = boxes.length ? Math.round((done / boxes.length) * 100) : 0;
    const bar = out.querySelector(".progress");
    bar.firstElementChild.style.transform = `scaleX(${pct / 100})`;
    bar.setAttribute("aria-valuenow", String(pct));
    bar.setAttribute("aria-valuetext", `${done} of ${boxes.length} documents ready`);
    out.querySelector("#count").textContent = `${done} of ${boxes.length} ready`;
  }

  out.addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    const all = window.store.get(TICKS, {});
    all[select.value] = all[select.value] || {};
    all[select.value][e.target.id] = e.target.checked;
    window.store.set(TICKS, all);
    progress();
  });
  select.addEventListener("change", render);
  // Follow in-page links, back/forward and edited hashes (e.g. #us) without a reload.
  window.addEventListener("hashchange", () => {
    const k = location.hash.slice(1);
    if (isVisa(k) && k !== select.value) {
      select.value = k;
      render();
    }
  });
  document.getElementById("print-list").addEventListener("click", () => window.print());
  document.getElementById("reset-list").addEventListener("click", () => {
    if (out.querySelector('input[type="checkbox"]:checked') && !confirm("Untick every document in this checklist?")) return;
    const all = window.store.get(TICKS, {});
    delete all[select.value];
    window.store.set(TICKS, all);
    render();
  });
  render();
})();
