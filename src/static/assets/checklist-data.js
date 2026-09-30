// Visitor-visa document checklists. General guidance only: requirements vary by nationality and
// where you apply, so every list links to the official source. Fees are deliberately omitted
// because they change often.
window.CHECKLISTS = {
  schengen: {
    name: "Schengen short-stay visa (type C)",
    official: "https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy_en",
    officialLabel: "European Commission: Schengen visa policy",
    intro: "Apply to the consulate of the country where you'll spend the most time. If the stays are equal, apply to your first point of entry. Many countries use an outsourced visa centre, so check the specific consulate's list.",
    sections: [
      { title: "Core documents", items: [
        ["Completed and signed application form", "Often filled online, then printed and signed."],
        ["Passport", "Issued within the last 10 years, valid at least 3 months after you leave the Schengen area, with at least 2 blank pages."],
        ["Copies of previous visas", "Especially earlier Schengen, UK, US, or Canada visas."],
        ["Recent passport photo(s)", "Usually 35 × 45 mm, light background, ICAO-compliant."],
        ["Travel medical insurance", "Minimum €30,000 coverage, valid across the whole Schengen area for your full stay."],
      ]},
      { title: "Trip evidence", items: [
        ["Travel itinerary / flight reservation", "Most consulates advise not to buy tickets before the visa decision. A plan or reservation is enough.", "itinerary"],
        ["Proof of accommodation", "Hotel reservations (free cancellation is fine), or an invitation letter from your host."],
        ["Cover letter explaining purpose and plans", "", "cover"],
      ]},
      { title: "Money & ties to home", items: [
        ["Bank statements", "Usually the last 3–6 months, showing enough funds for the trip."],
        ["Employment letter with approved leave, or business registration if self-employed", ""],
        ["Payslips or income tax returns", ""],
        ["Proof of enrolment (students) or pension statements (retirees)", ""],
        ["Sponsorship letter plus the sponsor's financial documents (if someone else pays)", ""],
      ]},
      { title: "Appointment", items: [
        ["Visa fee payment", "Check the current fee on the consulate or visa-centre site."],
        ["Appointment confirmation", ""],
        ["Biometrics (fingerprints) at the appointment", "Not needed if you gave them in the last 59 months."],
      ]},
    ],
  },
  uk: {
    name: "UK Standard Visitor visa",
    official: "https://www.gov.uk/standard-visitor",
    officialLabel: "GOV.UK: Standard Visitor",
    intro: "Apply online on GOV.UK, then attend a visa application centre for biometrics. Some nationalities need an Electronic Travel Authorisation (ETA) instead of a visa, so check GOV.UK first.",
    sections: [
      { title: "Core documents", items: [
        ["Online application form completed on GOV.UK", ""],
        ["Current passport", "Valid for your whole stay, with a blank page for the visa."],
        ["Previous passports / travel history", ""],
        ["Biometric appointment booked", ""],
      ]},
      { title: "Supporting evidence", items: [
        ["Proof you can support yourself during the trip", "Bank statements, payslips."],
        ["Details of where you'll stay", "GOV.UK notes you don't need to book or pay for travel before you get a visa.", "itinerary"],
        ["Travel plans / itinerary", "", "itinerary"],
        ["Employment letter or evidence of study / business", ""],
        ["Invitation letter (if visiting family, friends, or a business)", ""],
        ["Cover letter", "", "cover"],
        ["Certified translations of any documents not in English or Welsh", ""],
      ]},
    ],
  },
  us: {
    name: "US Visitor visa (B-1/B-2)",
    official: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html",
    officialLabel: "US Department of State: Visitor Visa",
    intro: "Nationals of Visa Waiver Program countries may use ESTA instead. Everyone else applies with the DS-160 and attends an interview. The State Department says not to make final travel arrangements until you have the visa.",
    sections: [
      { title: "Required", items: [
        ["Passport", "Valid at least 6 months beyond your stay, unless your country is exempt."],
        ["DS-160 confirmation page", ""],
        ["Visa fee payment receipt", ""],
        ["Photo", "Uploaded with the DS-160. Some posts also want a print."],
        ["Interview appointment confirmation", ""],
      ]},
      { title: "Helpful supporting documents", items: [
        ["Evidence of the trip's purpose", "Itinerary, conference invite, family invitation.", "itinerary"],
        ["Evidence you can pay for the trip", ""],
        ["Evidence of ties to home", "Employment, property, family, studies."],
        ["Previous US visas / travel history", ""],
      ]},
    ],
  },
  canada: {
    name: "Canada Visitor visa (TRV)",
    official: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html",
    officialLabel: "IRCC: Visit Canada",
    intro: "Apply online through IRCC. Visa-exempt nationals flying in need an eTA instead. Your personalised document checklist appears when you start the online application.",
    sections: [
      { title: "Core documents", items: [
        ["IRCC online account and application forms", ""],
        ["Valid passport scan", ""],
        ["Digital photo meeting IRCC specifications", ""],
        ["Biometrics", "Fingerprints and photo at a visa application centre, unless you're exempt."],
      ]},
      { title: "Supporting evidence", items: [
        ["Proof of financial support", "Bank statements, pay stubs."],
        ["Purpose of travel / itinerary", "", "itinerary"],
        ["Letter of invitation (if visiting someone in Canada)", ""],
        ["Employment or study letter", ""],
        ["Travel history", "Previous visas and stamps."],
        ["Cover letter", "", "cover"],
      ]},
    ],
  },
  australia: {
    name: "Australia Visitor visa (subclass 600)",
    official: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600",
    officialLabel: "Department of Home Affairs: Visitor (600)",
    intro: "Apply online through ImmiAccount. Some nationalities are eligible for an ETA (601) or eVisitor (651) instead.",
    sections: [
      { title: "Core documents", items: [
        ["ImmiAccount application", ""],
        ["Passport bio page", ""],
        ["National identity card (if you have one)", ""],
        ["Recent photo", ""],
      ]},
      { title: "Supporting evidence", items: [
        ["Evidence of funds", "Bank statements, tax returns."],
        ["Evidence of employment or study and approved leave", ""],
        ["Travel plans / itinerary", "", "itinerary"],
        ["Invitation from family or friends in Australia (if applicable)", ""],
        ["Health insurance", "Strongly recommended."],
        ["Cover letter", "", "cover"],
      ]},
    ],
  },
  japan: {
    name: "Japan Temporary Visitor visa",
    official: "https://www.mofa.go.jp/j_info/visit/visa/index.html",
    officialLabel: "Ministry of Foreign Affairs of Japan: Visa",
    intro: "Requirements differ a lot by nationality and by embassy, and some nationals can apply for an eVISA. A written schedule of your stay is commonly required.",
    sections: [
      { title: "Commonly required", items: [
        ["Visa application form", ""],
        ["Passport", ""],
        ["Photo", "Usually 45 × 35 mm."],
        ["Schedule of stay (day-by-day itinerary)", "The itinerary builder's day-by-day section covers this.", "itinerary"],
        ["Flight reservation or itinerary", "", "itinerary"],
        ["Documents proving you can cover travel expenses", "Bank certificate or statements."],
        ["Employment certificate", ""],
      ]},
      { title: "If invited", items: [
        ["Letter of invitation and guarantor documents from the inviter in Japan", ""],
      ]},
    ],
  },
  uae: {
    name: "UAE Tourist visa",
    official: "https://u.ae/en/information-and-services/visa-and-emirates-id",
    officialLabel: "UAE Government portal: Visas",
    intro: "Many nationalities get a visa on arrival or visa-free entry. Others apply through an airline, a hotel, a licensed travel agent, or a sponsor.",
    sections: [
      { title: "Commonly required", items: [
        ["Passport valid at least 6 months", ""],
        ["Passport-style colour photo", ""],
        ["Return or onward travel plan", "", "itinerary"],
        ["Hotel reservation or host address", ""],
        ["Bank statement (sometimes requested)", ""],
        ["Health insurance (sometimes requested)", ""],
      ]},
    ],
  },
};
