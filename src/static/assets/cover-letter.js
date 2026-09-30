// Cover letter generator: form -> plain-text letter in an editable preview.
(function () {
  const KEY = "visaprep.cover.v1";
  const form = document.getElementById("cl-form");
  const letter = document.getElementById("letter");
  const status = document.getElementById("status");
  const FIELDS = ["name", "passport", "address", "email", "embassy", "visaType", "purpose", "countries", "start", "end", "plans", "host", "job", "funding", "sponsor", "ties"];
  const DOCS = [
    "Completed visa application form", "Passport and copies of previous visas", "Passport photographs",
    "Travel itinerary", "Hotel reservations / invitation letter", "Travel medical insurance",
    "Bank statements (last 6 months)", "Employment letter and approved leave", "Payslips / income tax returns",
    "Sponsorship letter and sponsor's documents",
  ];
  const $ = (id) => document.getElementById(id);

  $("docs").innerHTML = DOCS.map((d, i) => `<label style="display:flex;gap:8px;font-weight:400"><input type="checkbox" data-doc="${i}" style="width:auto"> ${window.escapeHtml(d)}</label>`).join("");

  const fmt = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");
  const days = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) + 1 : 0);
  const or = (v, placeholder) => (v && v.trim()) || `[${placeholder}]`;

  const PURPOSE = {
    tourism: (s) => `The purpose of my visit is tourism. ${s.plans || ""}`,
    business: (s) => `The purpose of my visit is business. ${s.host ? `I have been invited by ${s.host}. ` : ""}${s.plans || ""}`,
    family: (s) => `The purpose of my visit is to see ${or(s.host, "name and relationship of the person you are visiting")}. ${s.plans || ""}`,
    event: (s) => `The purpose of my visit is to attend ${or(s.host, "event name and organiser")}. ${s.plans || ""}`,
  };

  function read() {
    const s = {};
    FIELDS.forEach((f) => (s[f] = $(f).value));
    s.docs = [...form.querySelectorAll("[data-doc]")].filter((c) => c.checked).map((c) => +c.dataset.doc);
    return s;
  }

  function write(s) {
    FIELDS.forEach((f) => ($(f).value = s[f] ?? $(f).value));
    form.querySelectorAll("[data-doc]").forEach((c) => (c.checked = (s.docs || []).includes(+c.dataset.doc)));
  }

  function compose(s) {
    const n = days(s.start, s.end);
    const funding = {
      self: `I will cover all expenses for this trip myself, including travel, accommodation, and daily costs. My bank statements are enclosed.`,
      sponsor: `My trip will be funded by ${or(s.sponsor, "sponsor name and relationship")}. Their sponsorship letter and financial documents are enclosed.`,
      employer: `My employer will cover the costs of this trip. A letter from my employer confirming this is enclosed.`,
    }[s.funding];
    const docs = s.docs.map((i) => `  - ${DOCS[i]}`).join("\n");

    return `${or(s.name, "Your full name")}
${or(s.address, "Your address")}
${or(s.email, "Email / phone")}

${fmt(new Date().toISOString().slice(0, 10))}

To the Visa Officer
${or(s.embassy, "Embassy / consulate name and city")}

Subject: Application for a ${or(s.visaType, "visa type")}: ${or(s.name, "Your full name")}, passport no. ${or(s.passport, "passport number")}

Dear Sir or Madam,

I am writing to apply for a ${or(s.visaType, "visa type")} to visit ${or(s.countries, "destination")} from ${or(fmt(s.start), "arrival date")} to ${or(fmt(s.end), "departure date")}${n > 0 ? ` (${n} days)` : ""}.

${PURPOSE[s.purpose](s).trim()} A detailed travel itinerary is enclosed.

I am currently employed as ${or(s.job, "occupation and employer")}. ${funding}

${s.ties.trim() ? `I intend to return home at the end of my trip. ${s.ties.trim()}` : "[Explain your ties to home: job, studies, family, property, and approved leave.]"}

${docs ? `Please find the following documents enclosed:\n${docs}\n\n` : ""}I confirm that the information in this application is true and complete. I will comply with the conditions of the visa and leave before it expires. Thank you for considering my application. Please contact me if you need any further information.

Yours faithfully,


${or(s.name, "Your full name")}`;
  }

  function update() {
    const s = read();
    letter.textContent = compose(s);
    window.store.set(KEY, s);
  }

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  $("print").addEventListener("click", (e) => window.downloadPdf(letter, `visa cover letter ${$("name").value}`, e.currentTarget));
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(letter.innerText);
      status.textContent = "Copied to clipboard.";
    } catch {
      status.textContent = "Couldn't copy automatically. Select the letter text and copy it manually.";
    }
  });
  $("txt").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([letter.innerText], { type: "text/plain" }));
    a.download = "visa-cover-letter.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("reset").addEventListener("click", () => {
    FIELDS.forEach((f) => ($(f).value = $(f).tagName === "SELECT" ? $(f).options[0].value : ""));
    form.querySelectorAll("[data-doc]").forEach((c) => (c.checked = false));
    update();
  });

  write(window.store.get(KEY, {}));
  update();
})();
