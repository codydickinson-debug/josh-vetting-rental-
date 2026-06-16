// ============================================================================
// Deterministic rule-based risk engine (server-side, authoritative).
// Mirrors Josh's v2 flowchart weights: MVR 60 / Fraud 20 / Insurance 10 / History 10.
// Additive model — higher score = higher risk. Identity gates can force decline.
// ============================================================================

export const CONFIG = {
  minAge: 21,
  caps: { mvr: 60, fraud: 20, insurance: 10, rental: 10 },
  thresholds: { approveMax: 24, reviewMax: 49 }, // 0-24 approve, 25-49 review, 50-100 decline
};

const DISPOSABLE_DOMAINS = [
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "trashmail.com", "yopmail.com", "sharklasers.com",
  "getnada.com", "throwawaymail.com", "maildrop.cc",
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const intOf = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };

function emailValid(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || ""); }
function phoneDigits(p) { return ((p || "").match(/\d/g) || []).length; }

export function ageFromDOB(dobStr) {
  if (!dobStr) return null;
  const dob = new Date(dobStr + "T00:00:00");
  if (isNaN(dob)) return null;
  const now = new Date();
  let a = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) a--;
  return a;
}
function isPastDate(dStr) {
  if (!dStr) return false;
  const d = new Date(dStr + "T00:00:00");
  if (isNaN(d)) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}

function scoreIdentity(d) {
  const flags = [];
  let decline = false;
  if (d.age !== null && d.age < CONFIG.minAge) {
    decline = true;
    flags.push({ level: "critical", text: `Applicant is ${d.age} — below the minimum rental age of ${CONFIG.minAge}.` });
  }
  if (isPastDate(d.licExp)) {
    decline = true;
    flags.push({ level: "critical", text: `Driver's license expired on ${d.licExp}.` });
  }
  if (!d.nameMatch) flags.push({ level: "medium", text: "Applicant did not confirm name/DOB matches the license." });
  return { decline, flags };
}

function scoreMVR(d) {
  let p = 0; const flags = []; const lines = [];
  if (d.licStatus === "suspended" || d.licStatus === "revoked") {
    p += 60; flags.push({ level: "critical", text: `License is ${d.licStatus} — cannot legally operate a vehicle.` });
    lines.push(`License ${d.licStatus}: +60`);
  } else if (d.licStatus === "expired") {
    p += 40; flags.push({ level: "high", text: "License reported as expired." }); lines.push("License expired: +40");
  }
  const v = Math.min(d.violations * 5, 20);
  if (v) { p += v; lines.push(`${d.violations} moving violation(s): +${v}`); }
  if (d.violations >= 3) flags.push({ level: "medium", text: `${d.violations} moving violations in 3 years.` });
  const a = Math.min(d.accidents * 8, 24);
  if (a) { p += a; lines.push(`${d.accidents} at-fault accident(s): +${a}`); }
  if (d.accidents >= 2) flags.push({ level: "high", text: `${d.accidents} at-fault accidents in 3 years.` });
  const dui = Math.min(d.dui * 30, 60);
  if (dui) { p += dui; lines.push(`${d.dui} DUI/DWI: +${dui}`); flags.push({ level: "critical", text: `${d.dui} DUI/DWI conviction(s) reported.` }); }
  if (d.priorSusp) { p += 10; lines.push("Prior suspension (5 yrs): +10"); flags.push({ level: "medium", text: "Prior license suspension within 5 years." }); }
  if (d.reckless) { p += 10; lines.push("Reckless driving: +10"); flags.push({ level: "high", text: "Reckless-driving citation within 5 years." }); }
  const points = clamp(p, 0, CONFIG.caps.mvr);
  if (points === 0) lines.push("Clean driving record");
  return { points, cap: CONFIG.caps.mvr, flags, lines };
}

function scoreFraud(d) {
  let p = 0; const flags = []; const lines = [];
  const domain = (d.email.split("@")[1] || "").toLowerCase();
  if (domain && DISPOSABLE_DOMAINS.includes(domain)) {
    p += 10; flags.push({ level: "high", text: `Disposable/temporary email domain (${domain}).` }); lines.push("Disposable email: +10");
  }
  if (phoneDigits(d.phone) !== 10) { p += 6; flags.push({ level: "medium", text: "Phone is not a standard 10-digit number." }); lines.push("Phone format: +6"); }
  const addrOk = /\d/.test(d.address) && d.address.trim().length >= 10;
  if (!addrOk) { p += 6; flags.push({ level: "medium", text: "Address looks incomplete." }); lines.push("Address completeness: +6"); }
  if (!d.nameMatch) { p += 4; lines.push("Identity match unconfirmed: +4"); }
  if (d.yearsAddr < 1) { p += 2; lines.push("Less than 1 year at address: +2"); }
  const points = clamp(p, 0, CONFIG.caps.fraud);
  if (points === 0) lines.push("No fraud signals detected");
  return { points, cap: CONFIG.caps.fraud, flags, lines };
}

function scoreInsurance(d) {
  let p = 0; const flags = []; const lines = [];
  if (d.hasIns === "no") {
    p += 10; flags.push({ level: "medium", text: "No personal auto policy — route to protection plan." }); lines.push("No insurance: +10 (protection-plan route)");
  } else {
    if (!d.insGood) { p += 5; lines.push("Not confirmed in good standing: +5"); flags.push({ level: "medium", text: "Policy good-standing not confirmed." }); }
    if (!d.insListed) { p += 4; lines.push("Not confirmed as listed driver: +4"); }
    if (!d.insLimits) { p += 4; lines.push("Coverage limits not confirmed: +4"); }
    if (d.insGood && d.insListed && d.insLimits) { lines.push("Active policy, fully verified"); flags.push({ level: "good", text: "Active insurance — all coverage checks confirmed." }); }
  }
  const points = clamp(p, 0, CONFIG.caps.insurance);
  return { points, cap: CONFIG.caps.insurance, flags, lines };
}

function scoreRental(d) {
  let p = 0; const flags = []; const lines = [];
  if (d.rentedBefore === "no") {
    lines.push("First-time renter — scored neutral");
    return { points: 0, cap: CONFIG.caps.rental, flags: [{ level: "good", text: "First-time renter (no negative history)." }], lines };
  }
  const lr = Math.min(d.lateReturns * 2, 6);
  if (lr) { p += lr; lines.push(`${d.lateReturns} late return(s): +${lr}`); }
  const dc = Math.min(d.damageClaims * 3, 9);
  if (dc) { p += dc; lines.push(`${d.damageClaims} damage claim(s): +${dc}`); if (d.damageClaims > 0) flags.push({ level: "medium", text: `${d.damageClaims} prior damage claim(s).` }); }
  const sm = Math.min(d.smoking * 2, 4);
  if (sm) { p += sm; lines.push(`${d.smoking} smoking/cleaning incident(s): +${sm}`); }
  const cb = Math.min(d.chargebacks * 4, 8);
  if (cb) { p += cb; lines.push(`${d.chargebacks} chargeback(s): +${cb}`); if (d.chargebacks > 0) flags.push({ level: "high", text: `${d.chargebacks} payment chargeback(s)/dispute(s).` }); }
  if (d.commIssues) { p += 2; lines.push("Communication/no-show issue: +2"); flags.push({ level: "medium", text: "Reported prior communication/no-show issue." }); }
  const points = clamp(p, 0, CONFIG.caps.rental);
  if (points === 0) lines.push("Positive rental history");
  return { points, cap: CONFIG.caps.rental, flags, lines };
}

// Normalize a raw posted payload into typed fields the scorers expect.
export function normalize(body) {
  return {
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    vehicle: String(body.vehicle || "").trim(),
    pickupDate: String(body.pickupDate || ""),
    returnDate: String(body.returnDate || ""),
    dob: String(body.dob || ""),
    age: ageFromDOB(body.dob),
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim(),
    address: String(body.address || "").trim(),
    yearsAddr: intOf(body.yearsAddr),
    licClass: String(body.licClass || "").trim(),
    licExp: String(body.licExp || ""),
    nameMatch: !!body.nameMatch,
    licStatus: String(body.licStatus || ""),
    violations: intOf(body.violations),
    accidents: intOf(body.accidents),
    dui: intOf(body.dui),
    priorSusp: !!body.priorSusp,
    reckless: !!body.reckless,
    refsAvailable: !!body.refsAvailable,
    consent: !!body.consent,
    hasIns: String(body.hasIns || ""),
    insProvider: String(body.insProvider || "").trim(),
    insPolicy: String(body.insPolicy || "").trim(),
    insExp: String(body.insExp || ""),
    insGood: !!body.insGood,
    insListed: !!body.insListed,
    insLimits: !!body.insLimits,
    rentedBefore: String(body.rentedBefore || ""),
    lateReturns: intOf(body.lateReturns),
    damageClaims: intOf(body.damageClaims),
    smoking: intOf(body.smoking),
    chargebacks: intOf(body.chargebacks),
    commIssues: !!body.commIssues,
  };
}

export function assess(d) {
  const identity = scoreIdentity(d);
  const mvr = scoreMVR(d);
  const fraud = scoreFraud(d);
  const insurance = scoreInsurance(d);
  const rental = scoreRental(d);
  const total = clamp(mvr.points + fraud.points + insurance.points + rental.points, 0, 100);
  const flags = [...identity.flags, ...mvr.flags, ...fraud.flags, ...insurance.flags, ...rental.flags];
  const hasCritical = flags.some((f) => f.level === "critical");

  let verdict;
  if (identity.decline) verdict = "decline";
  else if (total <= CONFIG.thresholds.approveMax) verdict = "approve";
  else if (total <= CONFIG.thresholds.reviewMax) verdict = "review";
  else verdict = "decline";
  if (verdict === "approve" && hasCritical) verdict = "review";

  return {
    total,
    verdict,
    categories: {
      mvr: { points: mvr.points, cap: mvr.cap, lines: mvr.lines },
      fraud: { points: fraud.points, cap: fraud.cap, lines: fraud.lines },
      insurance: { points: insurance.points, cap: insurance.cap, lines: insurance.lines },
      rental: { points: rental.points, cap: rental.cap, lines: rental.lines },
    },
    flags,
  };
}
