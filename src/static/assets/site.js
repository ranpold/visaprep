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

// Date fields: open the calendar when the field itself is clicked, not only its small icon.
document.addEventListener("click", (e) => {
  const el = e.target;
  if (el instanceof HTMLInputElement && el.type === "date" && typeof el.showPicker === "function") {
    try {
      el.showPicker();
    } catch {
      /* some browsers only allow this from certain gestures; the native icon still works */
    }
  }
});

// Save an element as a real PDF file. html2pdf (html2canvas + jsPDF) loads from cdnjs on first
// use; if it can't load, fall back to the browser's print dialog ("Save as PDF").
const HTML2PDF = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
let html2pdfLoading;
function loadHtml2pdf() {
  html2pdfLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = HTML2PDF;
    // Subresource integrity: refuse the script if the CDN copy was ever tampered with.
    s.integrity = "sha512-GsLlZN/3F2ErC5ifS5QtgpiJtWd43JWSuIgh7mbzZ8zBps+dvLusV+eNQATqgA/HdeKFVgA5v3S/cIrLF7QnIg==";
    s.crossOrigin = "anonymous";
    s.referrerPolicy = "no-referrer";
    s.onload = () => (window.html2pdf ? resolve(window.html2pdf) : reject(new Error("html2pdf missing")));
    s.onerror = () => reject(new Error("html2pdf failed to load"));
    document.head.appendChild(s);
  });
  return html2pdfLoading;
}

window.downloadPdf = async (el, name, button) => {
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Preparing PDF…";
  }
  try {
    const html2pdf = await loadHtml2pdf();
    const file = (name || "document").replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 60) || "document";
    await html2pdf()
      .set({
        margin: [10, 10, 12, 10],
        filename: `${file}.pdf`,
        image: { type: "jpeg", quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], avoid: [".ex-journey", ".ex-seg", ".ex-stay", "tr"] },
      })
      .from(el)
      .save();
  } catch (err) {
    console.error(err);
    // Generator unavailable (offline, blocked CDN): the print dialog's "Save as PDF" still works.
    alert("The PDF generator couldn't load. Your browser's print dialog will open instead; choose \"Save as PDF\" as the destination.");
    window.print();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
};
