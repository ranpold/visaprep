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
  const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the user's time zone

  // The letter preview is directly editable: announce it as a multi-line text box.
  letter.setAttribute("role", "textbox");
  letter.setAttribute("aria-multiline", "true");
  letter.setAttribute("aria-label", "Cover letter text (editable)");

  // Once the traveller edits the letter itself, form changes no longer overwrite it.
  const regen = document.createElement("p");
  regen.className = "regen no-print";
  regen.hidden = true;
  regen.innerHTML = `You've edited the letter directly, so form changes aren't applied to it. <button type="button" class="btn-link">Rebuild from the form</button>`;
  letter.before(regen);
  let edited = false;

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

${fmt(todayLocal())}

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
    if (!edited) letter.textContent = compose(s);
    regen.hidden = !edited;
    window.store.set(KEY, { ...s, edited, letter: edited ? letter.innerText : "" });
    if (s.start && s.end && s.end < s.start) warn("The departure date is before the arrival date.");
    else if (status.dataset.kind === "dates") warn("");
  }

  function warn(msg, kind = "dates") {
    status.textContent = msg;
    status.dataset.kind = msg ? kind : "";
  }

  // Remind the traveller about unfilled [placeholders] before the letter leaves the page.
  function placeholderNote() {
    const n = (letter.innerText.match(/\[[^\]\n]{3,}\]/g) || []).length;
    return n ? ` Note: ${n} [placeholder${n === 1 ? "" : "s"}] still to fill in.` : "";
  }

  letter.addEventListener("input", () => {
    edited = true;
    update();
  });
  regen.querySelector("button").addEventListener("click", () => {
    edited = false;
    update();
    letter.focus();
  });

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  $("print").addEventListener("click", async (e) => {
    await window.downloadPdf(letter, `visa cover letter ${$("name").value}`, e.currentTarget);
    warn("PDF saved." + placeholderNote(), "action");
  });
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(letter.innerText);
      warn("Copied to clipboard." + placeholderNote(), "action");
    } catch {
      warn("Couldn't copy automatically. Select the letter text and copy it manually.", "action");
    }
  });
  $("txt").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([letter.innerText], { type: "text/plain" }));
    a.download = "visa-cover-letter.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); // let the download start first
    warn("Saved visa-cover-letter.txt." + placeholderNote(), "action");
  });
  $("reset").addEventListener("click", () => {
    if ((edited || FIELDS.some((f) => $(f).value && $(f).tagName !== "SELECT")) && !confirm("Clear the form and the letter? This can't be undone.")) return;
    FIELDS.forEach((f) => ($(f).value = $(f).tagName === "SELECT" ? $(f).options[0].value : ""));
    form.querySelectorAll("[data-doc]").forEach((c) => (c.checked = false));
    edited = false;
    warn("");
    update();
  });

  $("start").min = todayLocal();
  $("end").min = todayLocal();
  $("start").addEventListener("change", () => ($("end").min = $("start").value || todayLocal()));

  const savedState = window.store.get(KEY, {});
  write(savedState);
  if (savedState.edited && savedState.letter) {
    edited = true;
    letter.textContent = savedState.letter;
  }
  update();
})();
