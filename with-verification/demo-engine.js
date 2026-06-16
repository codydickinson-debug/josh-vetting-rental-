/* ============================================================================
   DEMO ENGINE — makes the prototype fully presentable with NO backend.
   Loaded by index.html and dashboard.html. Only kicks in when the /api
   functions aren't reachable (i.e. opened locally or hosted as static files).
   Once the app is deployed to Vercel with env vars, the real backend answers
   and none of this runs.
============================================================================ */
(function () {
  "use strict";
  const CAPS = { mvr: 60, fraud: 20, insurance: 10, rental: 10 };
  const TH = { approveMax: 24, reviewMax: 49 };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const intOf = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };
  function ageFromDOB(s) {
    if (!s) return null; const d = new Date(s + "T00:00:00"); if (isNaN(d)) return null;
    const n = new Date(); let a = n.getFullYear() - d.getFullYear();
    const m = n.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--; return a;
  }
  function pastDate(s) { if (!s) return false; const d = new Date(s + "T00:00:00"); if (isNaN(d)) return false; const t = new Date(); t.setHours(0, 0, 0, 0); return d < t; }

  function normalize(b) {
    return {
      firstName: (b.firstName || "").trim(), lastName: (b.lastName || "").trim(),
      vehicle: (b.vehicle || "").trim(), pickupDate: b.pickupDate || "", returnDate: b.returnDate || "",
      dob: b.dob || "", age: ageFromDOB(b.dob), phone: (b.phone || "").trim(), email: (b.email || "").trim(),
      address: (b.address || "").trim(), yearsAddr: intOf(b.yearsAddr), licClass: (b.licClass || "").trim(),
      licExp: b.licExp || "", nameMatch: !!b.nameMatch, licStatus: b.licStatus || "",
      violations: intOf(b.violations), accidents: intOf(b.accidents), dui: intOf(b.dui),
      priorSusp: !!b.priorSusp, reckless: !!b.reckless, refsAvailable: !!b.refsAvailable,
      hasIns: b.hasIns || "", insProvider: (b.insProvider || "").trim(), insPolicy: (b.insPolicy || "").trim(),
      insExp: b.insExp || "", insGood: !!b.insGood, insListed: !!b.insListed, insLimits: !!b.insLimits,
      rentedBefore: b.rentedBefore || "", lateReturns: intOf(b.lateReturns), damageClaims: intOf(b.damageClaims),
      smoking: intOf(b.smoking), chargebacks: intOf(b.chargebacks), commIssues: !!b.commIssues,
    };
  }

  function assess(d) {
    const flags = []; let decline = false;
    // identity gates
    if (d.age !== null && d.age < 21) { decline = true; flags.push({ level: "critical", text: `Applicant is ${d.age} — below the minimum rental age of 21.` }); }
    if (pastDate(d.licExp)) { decline = true; flags.push({ level: "critical", text: `Driver's license expired on ${d.licExp}.` }); }
    if (!d.nameMatch) flags.push({ level: "medium", text: "Name/DOB match to license not confirmed." });

    // MVR
    let mvr = 0; const mvrL = [];
    if (d.licStatus === "suspended" || d.licStatus === "revoked") { mvr += 60; flags.push({ level: "critical", text: `License is ${d.licStatus}.` }); mvrL.push(`License ${d.licStatus}: +60`); }
    else if (d.licStatus === "expired") { mvr += 40; flags.push({ level: "high", text: "License reported expired." }); mvrL.push("License expired: +40"); }
    const v = Math.min(d.violations * 5, 20); if (v) { mvr += v; mvrL.push(`${d.violations} violation(s): +${v}`); }
    if (d.violations >= 3) flags.push({ level: "medium", text: `${d.violations} moving violations.` });
    const a = Math.min(d.accidents * 8, 24); if (a) { mvr += a; mvrL.push(`${d.accidents} at-fault: +${a}`); }
    if (d.accidents >= 2) flags.push({ level: "high", text: `${d.accidents} at-fault accidents.` });
    const du = Math.min(d.dui * 30, 60); if (du) { mvr += du; mvrL.push(`${d.dui} DUI/DWI: +${du}`); flags.push({ level: "critical", text: `${d.dui} DUI/DWI reported.` }); }
    if (d.priorSusp) { mvr += 10; mvrL.push("Prior suspension: +10"); flags.push({ level: "medium", text: "Prior license suspension." }); }
    if (d.reckless) { mvr += 10; mvrL.push("Reckless driving: +10"); flags.push({ level: "high", text: "Reckless-driving citation." }); }
    mvr = clamp(mvr, 0, CAPS.mvr); if (!mvrL.length) mvrL.push("Clean driving record");

    // Fraud
    let fr = 0; const frL = [];
    const dom = (d.email.split("@")[1] || "").toLowerCase();
    if (/mailinator|guerrilla|10minute|tempmail|trashmail|yopmail|sharklasers|getnada/.test(dom)) { fr += 10; frL.push("Disposable email: +10"); flags.push({ level: "high", text: "Disposable email domain." }); }
    if ((d.phone.match(/\d/g) || []).length !== 10) { fr += 6; frL.push("Phone format: +6"); }
    if (!(/\d/.test(d.address) && d.address.length >= 10)) { fr += 6; frL.push("Address incomplete: +6"); }
    if (!d.nameMatch) fr += 4;
    if (d.yearsAddr < 1) fr += 2;
    fr = clamp(fr, 0, CAPS.fraud); if (!frL.length) frL.push("No fraud signals detected");

    // Insurance
    let ins = 0; const insL = [];
    if (d.hasIns === "no") { ins += 10; insL.push("No insurance: +10 (protection-plan route)"); flags.push({ level: "medium", text: "No personal policy — protection-plan route." }); }
    else {
      if (!d.insGood) { ins += 5; insL.push("Good-standing unconfirmed: +5"); }
      if (!d.insListed) { ins += 4; insL.push("Listed-driver unconfirmed: +4"); }
      if (!d.insLimits) { ins += 4; insL.push("Coverage limits unconfirmed: +4"); }
      if (d.insGood && d.insListed && d.insLimits) { insL.push("Active policy, fully verified"); flags.push({ level: "good", text: "Active insurance — all checks confirmed." }); }
    }
    ins = clamp(ins, 0, CAPS.insurance);

    // Rental history
    let rh = 0; const rhL = [];
    if (d.rentedBefore === "no") { rhL.push("First-time renter — neutral"); flags.push({ level: "good", text: "First-time renter (no negative history)." }); }
    else {
      const lr = Math.min(d.lateReturns * 2, 6); if (lr) { rh += lr; rhL.push(`${d.lateReturns} late: +${lr}`); }
      const dc = Math.min(d.damageClaims * 3, 9); if (dc) { rh += dc; rhL.push(`${d.damageClaims} damage: +${dc}`); flags.push({ level: "medium", text: `${d.damageClaims} prior damage claim(s).` }); }
      const sm = Math.min(d.smoking * 2, 4); if (sm) { rh += sm; rhL.push(`${d.smoking} smoking: +${sm}`); }
      const cb = Math.min(d.chargebacks * 4, 8); if (cb) { rh += cb; rhL.push(`${d.chargebacks} chargebacks: +${cb}`); flags.push({ level: "high", text: `${d.chargebacks} payment chargeback(s).` }); }
      if (d.commIssues) { rh += 2; rhL.push("Comm/no-show issue: +2"); flags.push({ level: "medium", text: "Prior communication/no-show issue." }); }
      if (!rhL.length) rhL.push("Positive rental history");
    }
    rh = clamp(rh, 0, CAPS.rental);

    const total = clamp(mvr + fr + ins + rh, 0, 100);
    const hasCritical = flags.some((f) => f.level === "critical");
    let verdict = decline ? "decline" : total <= TH.approveMax ? "approve" : total <= TH.reviewMax ? "review" : "decline";
    if (verdict === "approve" && hasCritical) verdict = "review";

    return {
      total, verdict,
      categories: {
        mvr: { points: mvr, cap: CAPS.mvr, lines: mvrL }, fraud: { points: fr, cap: CAPS.fraud, lines: frL },
        insurance: { points: ins, cap: CAPS.insurance, lines: insL }, rental: { points: rh, cap: CAPS.rental, lines: rhL },
      },
      flags,
    };
  }

  // Templated "AI" read for the offline demo (no API key needed). Mirrors the
  // real ai.js output shape: identity cross-check, fake-ID screen, insurance review.
  function fakeAI(p, r, opts) {
    opts = opts || {};
    const hasInsDoc = !!opts.hasInsDoc;
    const name = p.firstName || "This applicant";
    const strengths = [], concerns = [], credibility = [];

    if (p.yearsAddr >= 3) strengths.push(`${p.yearsAddr} years at the current address signals stability.`);
    if (p.hasIns === "yes" && p.insGood && p.insListed && p.insLimits) strengths.push("Active insurance with all coverage checks confirmed.");
    if (p.violations === 0 && p.accidents === 0 && p.dui === 0) strengths.push("Clean self-reported driving record.");
    if (p.refsAvailable) strengths.push("Offered references proactively.");
    if (p.rentedBefore === "no") strengths.push("First-time renter with no negative history.");
    if (!strengths.length) strengths.push("Application was completed in full.");

    if (p.dui > 0) concerns.push(`${p.dui} DUI/DWI on record — a significant liability flag.`);
    if (p.accidents >= 2) concerns.push(`${p.accidents} at-fault accidents in three years.`);
    if (p.licStatus === "suspended" || p.licStatus === "revoked") concerns.push(`License is ${p.licStatus} — cannot legally drive.`);
    if (p.chargebacks > 0) concerns.push(`${p.chargebacks} prior payment chargeback(s).`);
    if (p.hasIns === "no") concerns.push("No personal insurance policy on file.");
    concerns.push("Self-reported driving history not yet cross-checked against the official MVR.");

    // identity cross-check
    const idMatch = p.nameMatch;
    if (!idMatch) credibility.push("Applicant did not confirm the name/DOB matches the license — possible mismatch.");
    if ((p.email.split("@")[1] || "").match(/mailinator|guerrilla|tempmail|trashmail|yopmail/)) credibility.push("Disposable / throwaway email address.");
    if (!/\d/.test(p.address)) credibility.push("Address looks incomplete (no street number).");
    const identity_check = {
      verdict: idMatch ? "match" : "mismatch",
      extracted: {
        full_name: `${p.firstName} ${p.lastName}`.trim() || "not legible",
        date_of_birth: p.dob || "not legible",
        license_number: "D" + String(Math.abs((p.email || "x").length * 137 + 100000)).slice(0, 9),
        expiration_date: p.licExp || "not legible",
        address: p.address || "not legible",
      },
      mismatches: idMatch ? [] : ["Name / DOB on the license could not be confirmed against the application — verify in person."],
    };

    // fake-ID screen
    const authFlags = [];
    if (p.licStatus === "expired") authFlags.push("License is reported expired.");
    if (p.licStatus === "suspended" || p.licStatus === "revoked") authFlags.push(`License status is ${p.licStatus}.`);
    if (!idMatch) authFlags.push("Selfie-to-ID match not confirmed; photo substitution can't be ruled out.");
    const authVerdict = !idMatch ? "suspicious" : (p.licStatus !== "valid" ? "suspicious" : "appears_genuine");
    const document_authenticity = { verdict: authVerdict, flags: authFlags.length ? authFlags : ["No obvious signs of tampering in the demo sample."] };

    // insurance review
    let insurance_check;
    if (p.hasIns !== "yes") insurance_check = { status: "no_document", notes: "Applicant reports no personal policy — route to the in-house protection plan." };
    else if (hasInsDoc) insurance_check = { status: "document_reviewed", notes: `Insurance card on file. Named insured appears to match ${name}; ${p.insProvider || "carrier"} policy ${p.insExp ? "valid through " + p.insExp : "current"}.` };
    else insurance_check = { status: "self_reported_only", notes: "Insurance is self-reported — no card uploaded. Request the declaration page before handing over keys." };

    const lead = {
      approve: `${name} presents as a low-risk, dependable applicant. The ID is consistent with the application and the profile is clean across the major categories.`,
      review: `${name} is a borderline case worth a human look. There are positives, but at least one item below — documentation or history — keeps this out of automatic approval.`,
      decline: `${name} carries risk factors outside the comfortable range. The identity, document, or history concerns below are material and warrant a decline or an in-person conversation.`,
    }[r.verdict];

    const aiScore = clamp(r.total + (r.verdict === "review" ? 3 : 0) + (!idMatch ? 8 : 0), 0, 100);
    return {
      ai_score: aiScore, recommendation: r.verdict, confidence: idMatch ? "high" : "medium",
      summary: lead, identity_check, document_authenticity, insurance_check,
      credibility_flags: credibility, strengths, concerns,
      document_notes: "Demo: simulated assessment. The deployed app runs Claude vision on the actual uploaded license, selfie, and insurance card to extract and cross-check these fields for real.",
    };
  }

  // Lightweight placeholder images so the demo's "documents" section looks complete.
  const ph = (label, body) => "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='320' height='200' rx='14' fill='#EDE6D6'/><rect x='14' y='14' width='292' height='172' rx='10' fill='none' stroke='#C9BFA6' stroke-width='1.5'/>${body}<text x='160' y='185' text-anchor='middle' font-family='Georgia,serif' font-size='11' fill='#8a8266'>${label}</text></svg>`);
  const placeholders = {
    front: ph("SAMPLE — License (front)", "<rect x='28' y='34' width='84' height='104' rx='6' fill='#dfe3e8'/><rect x='128' y='40' width='150' height='12' rx='4' fill='#d3d8de'/><rect x='128' y='64' width='120' height='9' rx='4' fill='#dfe3e8'/><rect x='128' y='84' width='140' height='9' rx='4' fill='#dfe3e8'/><rect x='128' y='104' width='90' height='9' rx='4' fill='#dfe3e8'/>"),
    back: ph("SAMPLE — License (back)", "<rect x='28' y='34' width='264' height='26' rx='4' fill='#2b2b2b'/><rect x='28' y='74' width='200' height='9' rx='4' fill='#dfe3e8'/><rect x='28' y='94' width='240' height='9' rx='4' fill='#dfe3e8'/><rect x='28' y='114' width='160' height='9' rx='4' fill='#dfe3e8'/>"),
    selfie: ph("SAMPLE — Selfie", "<circle cx='160' cy='78' r='34' fill='#dfe3e8'/><path d='M112 150 q48 -44 96 0' fill='#dfe3e8'/>"),
    insurance: ph("SAMPLE — Insurance card", "<rect x='28' y='32' width='140' height='12' rx='4' fill='#d3d8de'/><rect x='28' y='58' width='200' height='8' rx='4' fill='#dfe3e8'/><rect x='28' y='78' width='170' height='8' rx='4' fill='#dfe3e8'/><rect x='28' y='98' width='190' height='8' rx='4' fill='#dfe3e8'/><rect x='28' y='118' width='120' height='8' rx='4' fill='#dfe3e8'/>"),
  };
  function docUrls(withIns) {
    const u = { front: placeholders.front, back: placeholders.back, selfie: placeholders.selfie };
    if (withIns) u.insurance = placeholders.insurance;
    return u;
  }

  // ---- baked-in sample applications (varied — enough to show search/filter at scale) ----
  const iso = (hrsAgo) => new Date(Date.now() - hrsAgo * 3600e3).toISOString();
  function mk(id, hrsAgo, fields, opts) {
    opts = opts || {};
    const p = normalize(fields); const r = assess(p); const ai = fakeAI(p, r, opts);
    return { id, created_at: iso(hrsAgo), applicant_name: `${p.firstName} ${p.lastName}`.trim(), email: p.email,
      rule_total: r.total, ai_score: ai.ai_score, recommendation: r.verdict, data: p, scores: r, ai, photos: {}, photo_urls: docUrls(!!opts.hasInsDoc) };
  }
  const samples = [
    mk("demo-marcus", 2, { firstName: "Marcus", lastName: "Webb", dob: "1990-04-12", phone: "(305) 555-0148", email: "marcus.webb@gmail.com", address: "1820 Brickell Ave, Miami FL 33129", yearsAddr: "5", licClass: "Class E", licExp: "2029-04-12", licStatus: "valid", violations: "1", accidents: "0", dui: "0", hasIns: "yes", insProvider: "Progressive", insPolicy: "4471", insExp: "2026-10-01", insGood: true, insListed: true, insLimits: true, rentedBefore: "yes", lateReturns: "1", nameMatch: true, refsAvailable: true }, { hasInsDoc: true }),
    mk("demo-aisha", 1, { firstName: "Aisha", lastName: "Bello", dob: "1993-02-18", phone: "(305) 555-0163", email: "aisha.bello@gmail.com", address: "2400 NE 2nd Ave, Miami FL 33137", yearsAddr: "4", licClass: "Class E", licExp: "2030-02-18", licStatus: "valid", violations: "0", accidents: "0", dui: "0", hasIns: "yes", insProvider: "State Farm", insPolicy: "8820", insExp: "2026-12-15", insGood: true, insListed: true, insLimits: true, rentedBefore: "no", nameMatch: true, refsAvailable: true }, { hasInsDoc: true }),
    mk("demo-maria", 4, { firstName: "Maria", lastName: "Lopez", dob: "1998-06-25", phone: "(786) 555-0144", email: "maria.lopez@outlook.com", address: "812 SW 12th Ave, Miami FL 33130", yearsAddr: "2", licClass: "Class E", licExp: "2029-06-25", licStatus: "valid", violations: "2", accidents: "1", dui: "0", hasIns: "no", rentedBefore: "yes", lateReturns: "1", nameMatch: true }, {}),
    mk("demo-dana", 6, { firstName: "Dana", lastName: "Ruiz", dob: "1996-09-03", phone: "(786) 555-0192", email: "dana.ruiz@outlook.com", address: "455 NW 7th St, Miami FL 33136", yearsAddr: "1", licClass: "Class E", licExp: "2028-09-03", licStatus: "valid", violations: "2", accidents: "1", dui: "0", hasIns: "no", rentedBefore: "yes", lateReturns: "2", damageClaims: "1", nameMatch: true }, {}),
    mk("demo-kyle", 10, { firstName: "Kyle", lastName: "Mercer", dob: "1988-11-09", phone: "(954) 555-0125", email: "k.mercer@mailinator.com", address: "Sunrise FL", yearsAddr: "0", licClass: "Class E", licExp: "2024-11-09", licStatus: "expired", violations: "1", accidents: "0", dui: "0", hasIns: "no", rentedBefore: "no", nameMatch: true }, {}),
    mk("demo-sofia", 30, { firstName: "Sofia", lastName: "Grant", dob: "1991-03-30", phone: "(305) 555-0188", email: "sofia.grant@gmail.com", address: "100 Biscayne Blvd, Miami FL 33132", yearsAddr: "6", licClass: "Class E", licExp: "2031-03-30", licStatus: "valid", violations: "0", accidents: "0", dui: "0", hasIns: "yes", insProvider: "Geico", insPolicy: "1190", insExp: "2027-01-20", insGood: true, insListed: true, insLimits: true, rentedBefore: "yes", nameMatch: true, refsAvailable: true }, { hasInsDoc: true }),
    mk("demo-trent", 26, { firstName: "Trent", lastName: "Olsen", dob: "1985-12-20", phone: "(954) 555-0110", email: "t.olsen@gmail.com", address: "910 Sunrise Blvd, Fort Lauderdale FL 33304", yearsAddr: "2", licClass: "Class E", licExp: "2027-12-20", licStatus: "valid", violations: "3", accidents: "2", dui: "1", hasIns: "no", rentedBefore: "yes", chargebacks: "1", damageClaims: "1", commIssues: true, nameMatch: false }, {}),
    mk("demo-derek", 48, { firstName: "Derek", lastName: "Voss", dob: "1994-08-14", phone: "(786) 555-0101", email: "derek.voss@gmail.com", address: "330 SW 27th Ave, Miami FL 33135", yearsAddr: "3", licClass: "Class E", licExp: "2028-08-14", licStatus: "suspended", violations: "2", accidents: "1", dui: "0", hasIns: "no", rentedBefore: "yes", nameMatch: true }, {}),
  ];
  const VEH = {
    "demo-marcus": ["2024 Tesla Model 3", "2026-06-20", "2026-06-24"],
    "demo-aisha": ["2025 Toyota RAV4", "2026-06-18", "2026-06-21"],
    "demo-maria": ["2023 Honda Civic", "2026-06-22", "2026-06-25"],
    "demo-dana": ["2024 Jeep Wrangler", "2026-06-19", "2026-06-26"],
    "demo-kyle": ["2025 Ford Mustang", "2026-06-17", "2026-06-19"],
    "demo-sofia": ["2024 BMW X5", "2026-07-01", "2026-07-05"],
    "demo-trent": ["2025 Dodge Charger", "2026-06-20", "2026-06-23"],
    "demo-derek": ["2024 Chevrolet Tahoe", "2026-06-18", "2026-06-22"],
  };
  samples.forEach((s) => { const v = VEH[s.id]; if (v) { s.data.vehicle = v[0]; s.data.pickupDate = v[1]; s.data.returnDate = v[2]; } });

  // Verified-version demo: bake in Stripe Identity + Canopy Connect results (some pass, some fail).
  samples.forEach((s) => {
    const okId = { verified: true, provider: "Stripe Identity", name: s.applicant_name, dob: s.data.dob, document_number: "D" + (100000000 + (s.id.length * 7654321) % 899999999), expiration: s.data.licExp, document_status: "authentic", face_match: "98%" };
    const ins = (carrier) => ({ verified: true, provider: "Canopy Connect", carrier, policy_number: "••••" + (1000 + (s.id.length * 131) % 9000), named_insured: s.applicant_name, status: "Active", effective: "2026-06-15", expiration: "2026-12-15", coverage: "100/300/100", matches_applicant: true });
    const map = {
      "demo-marcus": [okId, ins("Progressive")],
      "demo-aisha": [okId, ins("State Farm")],
      "demo-maria": [okId, null],
      "demo-dana": [okId, null],
      "demo-kyle": [{ verified: false, provider: "Stripe Identity", name: s.applicant_name, document_status: "document expired — could not verify", face_match: "—" }, null],
      "demo-sofia": [okId, ins("Geico")],
      "demo-trent": [{ verified: false, provider: "Stripe Identity", name: s.applicant_name, document_status: "failed — face match below threshold (possible photo substitution)", face_match: "41%" }, null],
      "demo-derek": [okId, null],
    };
    const v = map[s.id]; if (v) s.verifications = { id: v[0], insurance: v[1] };
  });

  function makeSubmission(formData) {
    const p = normalize(formData);
    const r = assess(p);
    const hasInsDoc = !!(formData.photos && formData.photos.insurance);
    const ai = fakeAI(p, r, { hasInsDoc });
    return {
      id: "local-" + Math.abs(Math.floor((Date.now() % 1e9) + p.email.length * 7)),
      created_at: new Date().toISOString(),
      applicant_name: `${p.firstName} ${p.lastName}`.trim(), email: p.email,
      rule_total: r.total, ai_score: ai.ai_score, recommendation: r.verdict,
      data: p, scores: r, ai, photos: {}, photo_urls: docUrls(hasInsDoc),
      verifications: formData.verifications || { id: null, insurance: null },
    };
  }
  function saveLocal(formData) {
    try {
      const list = JSON.parse(localStorage.getItem("vetting_demo") || "[]");
      list.unshift(makeSubmission(formData));
      localStorage.setItem("vetting_demo", JSON.stringify(list.slice(0, 25)));
    } catch (e) {}
  }
  function getLocal() { try { return JSON.parse(localStorage.getItem("vetting_demo") || "[]"); } catch (e) { return []; } }

  window.DEMO = { PW: "Kobe0024", samples, placeholders, assess, normalize, fakeAI, saveLocal, getLocal };
})();
