// Shared behaviour: mobile nav toggle, current-page highlighting, safe localStorage helpers.
(function () {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.getElementById("nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }
  const here = location.pathname.replace(/\.html$/, "").replace(/\/$/, "");
  document.querySelectorAll(".nav-links a").forEach((a) => {
    const target = new URL(a.href).pathname.replace(/\/$/, "");
    if (target && here.startsWith(target)) a.setAttribute("aria-current", "page");
  });
})();

window.store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode); tools still work without saving */
    }
  },
};

window.escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
