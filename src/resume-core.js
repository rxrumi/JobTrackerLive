export const RESUME_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const RESUME_ARCHIVE_MAX_ENTRIES = 200;
const RESUME_ARCHIVE_MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const RESUME_ARCHIVE_MAX_RATIO = 100;
export const RESUME_GENERATION_VERSION = "resume-studio-v1";
export const RESUME_PROMPT_VERSION = "resume-studio-2026-07-17.v1";
export const BUILD_ACTIVE_STATES = new Set([
  "QUEUED", "JOB_REVALIDATION", "REQUIREMENTS_READY", "EVIDENCE_SELECTED",
  "RESUME_GENERATED", "CLAIM_AUDITED", "EMAIL_GENERATED", "RENDERING", "QA_PASSED"
]);
export const BUILD_TERMINAL_STATES = new Set([
  "READY", "NEEDS_EVIDENCE", "NEEDS_REVIEW", "JOB_CLOSED", "FAILED"
]);
export const NOTIFICATION_TYPES = new Set([
  "new_job_match", "build_ready", "build_needs_review", "build_failed",
  "job_closed", "evidence_needed", "credit_low"
]);

const RESUME_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

export function boundedNumber(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

export function weightedScore(parts, weights) {
  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    score += boundedNumber(parts?.[key]) * weight;
  }
  return Math.round(score);
}

export function calculateCandidateFit(parts = {}) {
  const breakdown = {
    responsibilities: boundedNumber(parts.responsibilities),
    skills_platforms: boundedNumber(parts.skills_platforms),
    outcomes: boundedNumber(parts.outcomes),
    seniority: boundedNumber(parts.seniority),
    domain_adjacency: boundedNumber(parts.domain_adjacency),
    location_work_arrangement: boundedNumber(parts.location_work_arrangement)
  };
  return {
    score: weightedScore(breakdown, {
      responsibilities: 0.30,
      skills_platforms: 0.20,
      outcomes: 0.20,
      seniority: 0.10,
      domain_adjacency: 0.10,
      location_work_arrangement: 0.10
    }),
    breakdown
  };
}

export function calculateResumeCoverage(parts = {}) {
  const breakdown = {
    must_have_skills: boundedNumber(parts.must_have_skills),
    responsibilities: boundedNumber(parts.responsibilities),
    tools_keywords: boundedNumber(parts.tools_keywords),
    title_qualification_alignment: boundedNumber(parts.title_qualification_alignment),
    impact_evidence: boundedNumber(parts.impact_evidence)
  };
  return {
    score: weightedScore(breakdown, {
      must_have_skills: 0.30,
      responsibilities: 0.25,
      tools_keywords: 0.20,
      title_qualification_alignment: 0.15,
      impact_evidence: 0.10
    }),
    breakdown
  };
}

function lowerTerms(values) {
  return new Set((values || []).map(value => String(value).trim().toLowerCase()).filter(Boolean));
}

function evidenceText(evidence) {
  return [
    evidence.employer,
    evidence.title,
    evidence.description,
    ...(Array.isArray(evidence.skills) ? evidence.skills : []),
    ...(Array.isArray(evidence.metrics) ? evidence.metrics : []),
    JSON.stringify(evidence.canonical_value || {})
  ].filter(Boolean).join(" ").toLowerCase();
}

function coveragePercent(terms, verifiedEvidence) {
  const wanted = [...lowerTerms(terms)];
  if (!wanted.length) return 100;
  const corpus = verifiedEvidence.map(evidenceText).join("\n");
  const matched = wanted.filter(term => corpus.includes(term));
  return Math.round((matched.length / wanted.length) * 100);
}

export function compareRequirementsToEvidence(requirements = {}, evidence = [], context = {}) {
  const verified = evidence.filter(item => item.verification_state === "verified");
  const unverified = evidence.filter(item => item.verification_state !== "verified");
  const verifiedCorpus = verified.map(evidenceText).join("\n");
  const unverifiedCorpus = unverified.map(evidenceText).join("\n");
  const keywordGroups = [
    ...(requirements.must_have_skills || []),
    ...(requirements.tools_keywords || []),
    ...(requirements.qualifications || [])
  ];
  const uniqueKeywords = [...new Set(keywordGroups.map(value => String(value).trim()).filter(Boolean))];
  const supported = [];
  const confirm = [];
  const unsupported = [];
  for (const keyword of uniqueKeywords) {
    const lowered = keyword.toLowerCase();
    if (verifiedCorpus.includes(lowered)) supported.push(keyword);
    else if (unverifiedCorpus.includes(lowered)) confirm.push(keyword);
    else unsupported.push(keyword);
  }

  const responsibilityCoverage = coveragePercent(requirements.responsibilities, verified);
  const skillCoverage = coveragePercent(requirements.must_have_skills, verified);
  const toolCoverage = coveragePercent(requirements.tools_keywords, verified);
  const outcomeCoverage = coveragePercent(requirements.outcomes, verified);
  const qualificationCoverage = coveragePercent(requirements.qualifications, verified);
  const seniority = context.seniorityCompatible === false ? 25 : context.seniorityCompatible === true ? 100 : 70;
  const domain = boundedNumber(context.domainAdjacency ?? 70);
  const location = context.locationCompatible === false ? 0 : context.locationCompatible === true ? 100 : 70;

  const fit = calculateCandidateFit({
    responsibilities: responsibilityCoverage,
    skills_platforms: Math.round((skillCoverage + toolCoverage) / 2),
    outcomes: outcomeCoverage,
    seniority,
    domain_adjacency: domain,
    location_work_arrangement: location
  });
  const coverage = calculateResumeCoverage({
    must_have_skills: skillCoverage,
    responsibilities: responsibilityCoverage,
    tools_keywords: toolCoverage,
    title_qualification_alignment: qualificationCoverage,
    impact_evidence: outcomeCoverage
  });

  return {
    fit,
    coverage,
    keywords: {
      supported_not_used: supported,
      potentially_supported_unverified: confirm,
      unsupported
    },
    verified_evidence_ids: verified.map(item => item.id)
  };
}

export function auditCanonicalClaims(canonicalResume, verifiedEvidenceIds) {
  const verified = new Set(verifiedEvidenceIds || []);
  const claims = [];
  const inspect = (claim, path) => {
    if (!claim || typeof claim !== "object") return;
    const citations = Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [];
    const unknown = citations.filter(id => !verified.has(id));
    const status = !citations.length || unknown.length ? "unsupported" : "supported";
    claims.push({ path, text: String(claim.text || ""), evidence_ids: citations, status, unknown_evidence_ids: unknown });
  };

  (canonicalResume?.summary_claims || []).forEach((claim, index) => inspect(claim, `summary_claims.${index}`));
  (canonicalResume?.experience || []).forEach((role, roleIndex) => {
    (role.bullets || []).forEach((claim, index) => inspect(claim, `experience.${roleIndex}.bullets.${index}`));
  });
  (canonicalResume?.projects || []).forEach((project, projectIndex) => {
    (project.bullets || []).forEach((claim, index) => inspect(claim, `projects.${projectIndex}.bullets.${index}`));
  });
  (canonicalResume?.education || []).forEach((item, index) => inspect({
    text: [item.credential, item.institution, item.date].filter(Boolean).join(" — "),
    evidence_ids: item.evidence_ids
  }, `education.${index}`));
  (canonicalResume?.certifications || []).forEach((item, index) => inspect({
    text: [item.name, item.issuer, item.date].filter(Boolean).join(" — "),
    evidence_ids: item.evidence_ids
  }, `certifications.${index}`));
  return {
    claims,
    unsupported_count: claims.filter(claim => claim.status === "unsupported").length,
    ambiguous_count: 0,
    passed: claims.length > 0 && claims.every(claim => claim.status === "supported")
  };
}

export function mergeClaimAudit(localAudit, modelAudit = {}) {
  const modelClaims = Array.isArray(modelAudit.claims) ? modelAudit.claims : [];
  const byPath = new Map(modelClaims.map(claim => [claim.path, claim]));
  const claims = localAudit.claims.map(local => {
    const model = byPath.get(local.path);
    if (local.status === "unsupported") return local;
    if (!model) return { ...local, status: "ambiguous", reason: "claim was not returned by the audit model" };
    const status = ["supported", "unsupported", "ambiguous"].includes(model.status)
      ? model.status
      : "ambiguous";
    return { ...local, status, reason: String(model.reason || "") };
  });
  return {
    claims,
    unsupported_count: claims.filter(claim => claim.status === "unsupported").length,
    ambiguous_count: claims.filter(claim => claim.status === "ambiguous").length,
    passed: claims.length > 0 && claims.every(claim => claim.status === "supported")
  };
}

export function atsReadinessChecklist(canonicalResume, renderQa = {}) {
  const contact = canonicalResume?.contact || {};
  const sections = canonicalResume?.section_order || [];
  const checks = [
    ["single_column", canonicalResume?.layout?.columns === 1, "Use one text column."],
    ["required_sections", sections.includes("experience") && sections.includes("skills"), "Include experience and skills sections."],
    ["contact_fields", Boolean(contact.name && (contact.email || contact.phone)), "Include a name and email or phone."],
    ["dates_present", (canonicalResume?.experience || []).every(role => role.start_date), "Each role needs a start date."],
    ["page_limit", renderQa.page_count == null || renderQa.page_count <= Number(canonicalResume?.layout?.page_target || 1), "Shorten content to the selected page target."],
    ["selectable_pdf_text", renderQa.selectable_pdf_text !== false, "PDF text must remain selectable."],
    ["file_text_agreement", renderQa.text_agreement !== false, "PDF and DOCX text must agree with the approved content."],
    ["no_overflow", renderQa.overflow !== true, "Remove clipped or overflowing content."],
    ["safe_characters", !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(JSON.stringify(canonicalResume || {})), "Remove unsupported control characters."],
    ["formatting_hygiene", !canonicalResume?.layout?.graphics && !canonicalResume?.layout?.tables, "Do not use graphics, text boxes, or layout tables."]
  ].map(([key, passed, remediation]) => ({ key, status: passed ? "pass" : "warning", remediation: passed ? null : remediation }));
  return { checks, passed: checks.every(check => check.status === "pass") };
}

export function sanitizeFilename(value, fallback = "resume") {
  const safe = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/[\s.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return safe || fallback;
}

export function validateResumeUpload(filename, contentType, bytes) {
  const name = String(filename || "").trim();
  const lower = name.toLowerCase();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return { error: "unsafe_filename" };
  }
  if (lower.endsWith(".docm") || lower.endsWith(".dotm")) return { error: "macros_not_allowed" };
  if (!bytes?.byteLength || bytes.byteLength > RESUME_SOURCE_MAX_BYTES) return { error: "invalid_file_size" };
  const first = new Uint8Array(bytes.slice(0, 8));
  const isPdf = first[0] === 0x25 && first[1] === 0x50 && first[2] === 0x44 && first[3] === 0x46 && first[4] === 0x2d;
  const isZip = first[0] === 0x50 && first[1] === 0x4b && [0x03, 0x05, 0x07].includes(first[2]) && [0x04, 0x06, 0x08].includes(first[3]);
  if (lower.endsWith(".pdf") && isPdf && contentType === RESUME_MIME.pdf) {
    return { mime_type: RESUME_MIME.pdf, extension: "pdf" };
  }
  if (lower.endsWith(".docx") && isZip && contentType === RESUME_MIME.docx) {
    const archive = new Uint8Array(bytes);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    let entries = 0;
    let expandedBytes = 0;
    for (let offset = 0; offset + 46 <= archive.byteLength; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      entries++;
      const compressed = view.getUint32(offset + 20, true);
      const expanded = view.getUint32(offset + 24, true);
      expandedBytes += expanded;
      if (entries > RESUME_ARCHIVE_MAX_ENTRIES
        || expandedBytes > RESUME_ARCHIVE_MAX_EXPANDED_BYTES
        || (expanded > 0 && expanded / Math.max(1, compressed) > RESUME_ARCHIVE_MAX_RATIO)) {
        return { error: "unsafe_archive" };
      }
      const filenameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      offset += 45 + filenameLength + extraLength + commentLength;
    }
    if (!entries) return { error: "invalid_docx_container" };
    const zipDirectoryText = new TextDecoder("latin1").decode(archive);
    if (/vbaProject\.bin|macroEnabled/i.test(zipDirectoryText)) return { error: "macros_not_allowed" };
    if (!/word\/document\.xml/i.test(zipDirectoryText)) return { error: "invalid_docx_container" };
    return { mime_type: RESUME_MIME.docx, extension: "docx" };
  }
  return { error: "file_type_mismatch" };
}

export function emailBodiesAreValid(emailOptions) {
  const expected = new Set(["recruiter_introduction", "hiring_manager_outreach", "general_application"]);
  const options = Array.isArray(emailOptions) ? emailOptions : [];
  if (options.length !== 3) return false;
  return options.every(option => {
    const words = String(option.body || "").trim().split(/\s+/).filter(Boolean).length;
    return expected.delete(option.type) && Array.isArray(option.subjects) && option.subjects.length === 3 && words >= 80 && words <= 140;
  }) && expected.size === 0;
}

export function equivalentBuildHashInput({ userId, jobKey, contentHash, profileId }) {
  return [userId, jobKey, contentHash || "pending", profileId, RESUME_GENERATION_VERSION].join("|");
}

export async function sha256Hex(value) {
  const bytes = value instanceof ArrayBuffer
    ? value
    : new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
