// ============================================================================
// Claude assessment of a renter applicant.
// Reads the uploaded ID + selfie + insurance card with vision, cross-checks
// the documents against what the applicant typed, flags possible forgery,
// reviews the insurance document, and returns a structured judgment.
//
// IMPORTANT: this is decision-support ("flag for review"), not authoritative
// verification. True ID authentication / MVR / insurance verification require
// the third-party services in the v2 flowchart (Vouched, ADD123, insurer API).
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";

const ASSESSMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "ai_score", "recommendation", "confidence", "summary",
    "identity_check", "document_authenticity", "insurance_check",
    "credibility_flags", "strengths", "concerns", "document_notes",
  ],
  properties: {
    ai_score: { type: "integer", description: "Holistic RISK score 0-100. Higher = higher risk. Same scale as the rule engine." },
    recommendation: { type: "string", enum: ["approve", "review", "decline"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string", description: "3-5 sentence holistic read of the applicant as a whole." },
    identity_check: {
      type: "object",
      additionalProperties: false,
      required: ["verdict", "extracted", "mismatches"],
      properties: {
        verdict: { type: "string", enum: ["match", "partial_match", "mismatch", "unreadable"] },
        extracted: {
          type: "object",
          additionalProperties: false,
          required: ["full_name", "date_of_birth", "license_number", "expiration_date", "address"],
          properties: {
            full_name: { type: "string" }, date_of_birth: { type: "string" },
            license_number: { type: "string" }, expiration_date: { type: "string" }, address: { type: "string" },
          },
        },
        mismatches: { type: "array", items: { type: "string" }, description: "Specific discrepancies between the ID and what the applicant typed." },
      },
    },
    document_authenticity: {
      type: "object",
      additionalProperties: false,
      required: ["verdict", "flags"],
      properties: {
        verdict: { type: "string", enum: ["appears_genuine", "suspicious", "likely_fake", "cannot_determine"] },
        flags: { type: "array", items: { type: "string" }, description: "Signs of tampering, template anomalies, photo-of-a-screen, mismatched fonts, missing security features, expired, etc." },
      },
    },
    insurance_check: {
      type: "object",
      additionalProperties: false,
      required: ["status", "notes"],
      properties: {
        status: { type: "string", enum: ["document_reviewed", "no_document", "possibly_expired", "name_mismatch", "unreadable", "self_reported_only"] },
        notes: { type: "string" },
      },
    },
    credibility_flags: { type: "array", items: { type: "string" }, description: "Concrete signs the applicant may be misrepresenting themselves." },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    document_notes: { type: "string" },
  },
};

const SYSTEM = `You are a meticulous risk & fraud analyst for a private vehicle-rental company. Your job is to tell the operator everything that can be known about an applicant from what they submitted — short of an external background check or MVR pull.

You receive: (1) the applicant's self-reported profile, (2) a deterministic rule-based risk score, and (3) photos — driver's license front, license back, a selfie, and (optionally) an insurance card/declaration page.

Do all of the following:
1. IDENTITY CROSS-CHECK — read the name, date of birth, license number, expiration date, and address off the license, and compare to what the applicant typed. List every discrepancy. Mismatches are a strong sign the applicant is being untruthful.
2. DOCUMENT AUTHENTICITY (fake-ID screen) — examine the license for signs of forgery or tampering: inconsistent fonts/spacing, misaligned text, missing or wrong state security features (holograms, microprint, ghost image), edited photo, a photo of a screen rather than a physical card, an expired date, or a selfie that does not plausibly match the license photo. Give a verdict and list concrete flags.
3. INSURANCE — if an insurance document is provided, read the named insured, carrier, policy number, and effective/expiration dates; check the named insured matches the applicant and the policy is current. If no document, say so.
4. CREDIBILITY — call out anything that suggests misrepresentation (e.g. claims "clean record" but the ID is expired; address doesn't match; disposable email).
5. Synthesize an overall read, strengths, concerns, an ai_score (0-100 risk; same bands as the engine: 0-24 approve, 25-49 review, 50-100 decline) and a recommendation.

RULES:
- You are NOT a forensic document examiner. Never state with certainty that an ID is genuine or fake — use "appears_genuine / suspicious / likely_fake / cannot_determine" and explain why. Anything other than "appears_genuine" should push toward manual review or decline.
- Only report what is visibly supported by the documents and data. If something is unreadable, say "unreadable" rather than guessing.
- Be specific and concrete, not generic.`;

function imageBlock(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

export async function runAIAssessment({ profile, ruleResult, photos, verification }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set — AI assessment skipped." };
  const client = new Anthropic({ apiKey });

  // Third-party verification results (Vouched ID check / Plaid bank link) are
  // authoritative-ish signals — pass a secrets-free summary when present.
  let verificationText = "";
  const v = verification || {};
  if (v.vouched || v.plaid) {
    const summary = {};
    if (v.vouched) {
      summary.vouched_id_verification = v.vouched.error
        ? { error: v.vouched.error }
        : { verified: v.vouched.verified === true, success: v.vouched.success, nameOnIdMatchesApplicant: v.vouched.nameMatch, status: v.vouched.status, confidences: v.vouched.confidences, name_on_id: [v.vouched.firstName, v.vouched.lastName].filter(Boolean).join(" ") || null, birthDate: v.vouched.birthDate, idType: v.vouched.idType, issues: v.vouched.issues };
    }
    if (v.plaid) {
      summary.plaid_bank_verification = v.plaid.error
        ? { error: v.plaid.error }
        : { institution: v.plaid.institution || null, accountHolderNames: v.plaid.ownerNames, nameMatchesApplicant: v.plaid.nameMatch, accounts: (v.plaid.accounts || []).map((a) => ({ type: a.type, subtype: a.subtype, mask: a.mask })) };
    }
    verificationText = `\n\nTHIRD-PARTY VERIFICATION RESULTS (from Vouched/Plaid — weigh these ABOVE self-reported data):\n${JSON.stringify(summary, null, 2)}`;
  }

  const profileText = JSON.stringify({
    name: `${profile.firstName} ${profile.lastName}`,
    dob: profile.dob, age: profile.age, phone: profile.phone, email: profile.email,
    address: profile.address, yearsAtAddress: profile.yearsAddr,
    license: { status: profile.licStatus, expires: profile.licExp },
    driving: { movingViolations: profile.violations, atFaultAccidents: profile.accidents, duiDwi: profile.dui, priorSuspension: profile.priorSusp, recklessDriving: profile.reckless },
    insurance: profile.hasIns === "yes"
      ? { active: true, provider: profile.insProvider, policyLast4: profile.insPolicy, expires: profile.insExp, goodStanding: profile.insGood, listedDriver: profile.insListed, meetsLimits: profile.insLimits }
      : { active: false },
    // The form only asks IF they have rented before — incident details are not
    // collected, so none may be presented to the model as self-reported facts.
    rentalHistory: profile.rentedBefore === "yes"
      ? "has rented before (incident details are not collected on the form)"
      : "first-time renter",
    nameMatchAttested: profile.nameMatch,
  }, null, 2);

  const ruleText = JSON.stringify({ total: ruleResult.total, verdict: ruleResult.verdict, breakdown: ruleResult.categories, flags: ruleResult.flags }, null, 2);

  const labels = { front: "DRIVER'S LICENSE — FRONT", back: "DRIVER'S LICENSE — BACK", selfie: "SELFIE", insurance: "INSURANCE CARD / DECLARATION" };
  const imageContent = [];
  for (const key of ["front", "back", "selfie", "insurance"]) {
    const blk = imageBlock(photos?.[key]);
    if (blk) { imageContent.push({ type: "text", text: labels[key] }); imageContent.push(blk); }
  }
  // Never tell the model images follow when none do (a Vouched-verified renter
  // may legitimately skip manual uploads) — it invites fabricated extractions.
  const imagesNote = imageContent.length
    ? "Images follow (each labelled)."
    : `No photos were uploaded${v.vouched ? " — the ID capture was performed by Vouched (see the third-party results above); mark image-based checks as unreadable/cannot_determine rather than guessing" : "; mark image-based checks as unreadable/cannot_determine rather than guessing"}.`;
  const content = [{ type: "text", text: `APPLICANT PROFILE (self-reported):\n${profileText}\n\nRULE-BASED ENGINE RESULT:\n${ruleText}${verificationText}\n\n${imagesNote} Assess this applicant per your instructions and return the structured result.` }];
  content.push(...imageContent);

  try {
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      // Adaptive thinking + high effort + up to 4 images all draw from this budget,
      // and the final structured JSON must fit too — keep generous headroom so a
      // long reasoning pass can't truncate the JSON (which would fail the parse).
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: ASSESSMENT_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    const textBlock = resp.content.find((b) => b.type === "text");
    if (!textBlock) return { error: "AI returned no text block." };
    return { ...JSON.parse(textBlock.text), model: resp.model };
  } catch (err) {
    return { error: `AI assessment failed: ${err?.message || String(err)}` };
  }
}
