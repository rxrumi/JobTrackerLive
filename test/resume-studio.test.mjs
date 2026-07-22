import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import worker from "../src/worker.js";
import { localTimeParts } from "../src/resume-studio.js";
import { renderResumeArtifacts } from "../src/resume-renderer.js";

import {
  atsReadinessChecklist,
  auditCanonicalClaims,
  calculateCandidateFit,
  calculateResumeCoverage,
  emailBodiesAreValid,
  sanitizeFilename,
  validateResumeUpload
} from "../src/resume-core.js";

test("candidate fit uses the published weighted formula exactly", () => {
  const result = calculateCandidateFit({
    responsibilities: 100,
    skills_platforms: 80,
    outcomes: 60,
    seniority: 50,
    domain_adjacency: 40,
    location_work_arrangement: 20
  });
  assert.equal(result.score, 69);
  assert.deepEqual(result.breakdown, {
    responsibilities: 100,
    skills_platforms: 80,
    outcomes: 60,
    seniority: 50,
    domain_adjacency: 40,
    location_work_arrangement: 20
  });
});

test("resume coverage uses the published weighted formula exactly", () => {
  const result = calculateResumeCoverage({
    must_have_skills: 100,
    responsibilities: 80,
    tools_keywords: 60,
    title_qualification_alignment: 40,
    impact_evidence: 20
  });
  assert.equal(result.score, 70);
});

test("resume upload validation enforces size, extension, MIME, magic bytes, and macro rejection", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nfixture").buffer;
  const zipBytes = zipSync({ "word/document.xml": strToU8("<w:document/>") });
  const zip = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength);
  assert.equal(validateResumeUpload("resume.pdf", "application/pdf", pdf).extension, "pdf");
  assert.equal(validateResumeUpload("resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip).extension, "docx");
  assert.equal(validateResumeUpload("resume.pdf", "application/pdf", zip).error, "file_type_mismatch");
  assert.equal(validateResumeUpload("../resume.pdf", "application/pdf", pdf).error, "unsafe_filename");
  assert.equal(validateResumeUpload("resume.docm", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip).error, "macros_not_allowed");
  const macroBytes = zipSync({ "word/document.xml": strToU8("<w:document/>"), "word/vbaProject.bin": strToU8("macro") });
  const macroZip = macroBytes.buffer.slice(macroBytes.byteOffset, macroBytes.byteOffset + macroBytes.byteLength);
  assert.equal(validateResumeUpload("resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", macroZip).error, "macros_not_allowed");
  const bombBytes = zipSync({ "word/document.xml": strToU8("A".repeat(2 * 1024 * 1024)) }, { level: 9 });
  const bomb = bombBytes.buffer.slice(bombBytes.byteOffset, bombBytes.byteOffset + bombBytes.byteLength);
  assert.equal(validateResumeUpload("resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bomb).error, "unsafe_archive");
});

test("Worker-native rendering produces structurally identifiable DOCX and PDF artifacts", async () => {
  const rendered = await renderResumeArtifacts({
    template: "classic",
    page_target: 1,
    canonical_resume: {
      contact: { name: "Sohaib Kazmi", email: "candidate@example.com", location: "Dubai" },
      headline: "Revenue Operations Leader",
      summary_claims: [{ text: "Built evidence-led revenue operations systems.", evidence_ids: ["e1"] }],
      skills: ["HubSpot", "n8n", "Clay"],
      experience: [{ employer: "Example", title: "BizOps Manager", start_date: "2022", end_date: "Present", bullets: [{ text: "Improved operating cadence using verified workflows.", evidence_ids: ["e1"] }] }],
      education: [], certifications: [], projects: []
    }
  });
  assert.deepEqual([...rendered.docx.slice(0, 2)], [0x50, 0x4b]);
  assert.equal(new TextDecoder().decode(rendered.pdf.slice(0, 5)), "%PDF-");
  assert.equal(rendered.qa.passed, true);
  assert.equal(rendered.qa.renderer, "worker-native-v1");
  assert.equal(rendered.qa.page_count, 1);
});

test("claim audit blocks missing and cross-evidence citations", () => {
  const canonical = {
    summary_claims: [{ text: "Supported summary", evidence_ids: ["e1"] }],
    experience: [{ bullets: [
      { text: "Unsupported metric", evidence_ids: [] },
      { text: "Unknown employer", evidence_ids: ["other-user-evidence"] }
    ] }],
    projects: []
  };
  const audit = auditCanonicalClaims(canonical, ["e1"]);
  assert.equal(audit.unsupported_count, 2);
  assert.equal(audit.passed, false);
});

test("ATS readiness blocks non-selectable, overflowing, or structurally unsafe output", () => {
  const result = atsReadinessChecklist({
    contact: { name: "Candidate", email: "candidate@example.com" },
    experience: [{ start_date: "2020" }],
    section_order: ["experience", "skills"],
    layout: { columns: 1, graphics: false, tables: false, page_target: 1 }
  }, { page_count: 2, selectable_pdf_text: false, text_agreement: true, overflow: true });
  assert.equal(result.passed, false);
  assert.ok(result.checks.some(check => check.key === "page_limit" && check.status === "warning"));
  assert.ok(result.checks.some(check => check.key === "selectable_pdf_text" && check.status === "warning"));
});

test("email bundle requires all three variants, three subjects, and 80-140 words", () => {
  const body = Array.from({ length: 90 }, (_, index) => `word${index}`).join(" ");
  const valid = ["recruiter_introduction", "hiring_manager_outreach", "general_application"]
    .map(type => ({ type, subjects: ["One", "Two", "Three"], body }));
  assert.equal(emailBodiesAreValid(valid), true);
  assert.equal(emailBodiesAreValid(valid.map((item, index) => index ? item : { ...item, body: "too short" })), false);
});

test("artifact filenames remove unsafe path and punctuation characters", () => {
  assert.equal(sanitizeFilename("../Sohaib Kazmi / ACME: RevOps?"), "Sohaib-Kazmi-ACME-RevOps");
});

test("digest scheduling resolves the user's local date and hour across timezones", () => {
  const instant = new Date("2026-07-17T03:15:00.000Z");
  assert.deepEqual(localTimeParts(instant, "Asia/Karachi"), { date: "2026-07-17", hour: 8 });
  assert.deepEqual(localTimeParts(instant, "America/Los_Angeles"), { date: "2026-07-16", hour: 20 });
});

test("Resume Studio migration applies with foreign keys and cascades candidate-owned records", () => {
  const directory = mkdtempSync(join(tmpdir(), "resume-studio-migration-"));
  const database = join(directory, "test.sqlite");
  try {
    const migration = ["0001_clerk_d1_app_data.sql", "0002_default_brand_theme_cobalt.sql", "0003_resume_studio.sql"]
      .map(name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"))
      .join("\n");
    execFileSync("sqlite3", [database], { input: migration });
    const tables = execFileSync("sqlite3", [database, "select count(*) from sqlite_master where type='table' and name in ('resume_sources','candidate_evidence','resume_profiles','resume_builds','usage_events','provider_cost_events');"], { encoding: "utf8" }).trim();
    assert.equal(tables, "6");
    const script = `
      PRAGMA foreign_keys=ON;
      insert into users (id,email,onboarding_completed,account_type,brand_theme,created_at,updated_at) values ('u1','u1@example.com',1,'individual','cobalt','now','now');
      insert into resume_sources (id,user_id,original_filename,safe_filename,mime_type,byte_size,sha256,r2_key,extraction_state,created_at,updated_at) values ('s1','u1','r.pdf','r.pdf','application/pdf',10,'hash','users/u1/sources/s1/original','complete','now','now');
      insert into candidate_evidence (id,user_id,source_id,evidence_type,verification_state,canonical_value,content_hash,created_at,updated_at) values ('e1','u1','s1','skill','verified','{}','ehash','now','now');
      delete from users where id='u1';
      select (select count(*) from resume_sources) || ':' || (select count(*) from candidate_evidence);
    `;
    const remaining = execFileSync("sqlite3", [database], { input: script, encoding: "utf8" }).trim();
    assert.equal(remaining, "0:0");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tenantIsolationDB() {
  const mutations = [];
  return {
    mutations,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
      return {
        bind(...params) {
          return {
            async run() {
              mutations.push({ sql: normalized, params });
              return { success: true };
            },
            async first() {
              if (normalized.startsWith("select account_type from users")) return { account_type: "individual" };
              if (normalized.includes("from candidate_evidence where id = ? and user_id = ?")) {
                return params[0] === "owner-evidence" && params[1] === "owner" ? { id: "owner-evidence", user_id: "owner" } : null;
              }
              if (normalized.includes("from resume_builds where id = ? and user_id = ?")) {
                return params[0] === "owner-build" && params[1] === "owner" ? { id: "owner-build", user_id: "owner", status: "READY" } : null;
              }
              return null;
            },
            async all() { return { results: [] }; }
          };
        }
      };
    }
  };
}

test("Resume Studio denies cross-tenant evidence deletion and artifact access", async () => {
  const DB = tenantIsolationDB();
  let r2Reads = 0;
  const env = {
    DB,
    RESUME_STUDIO_ENABLED: "true",
    CLERK_USER: { id: "owner", email: "owner@example.com", full_name: "Owner" },
    RESUME_FILES: { async get() { r2Reads++; return null; } }
  };
  const deletion = await worker.fetch(new Request("https://livejobindex.com/api/evidence/other-user-evidence", { method: "DELETE" }), env, {});
  const artifact = await worker.fetch(new Request("https://livejobindex.com/api/resume-builds/other-user-build/artifacts/pdf"), env, {});
  assert.equal(deletion.status, 404);
  assert.equal(artifact.status, 404);
  assert.equal(r2Reads, 0);
  assert.equal(DB.mutations.some(item => item.sql.startsWith("delete from candidate_evidence")), false);
});

test("account deletion removes the private R2 prefix before deleting the D1 user", async () => {
  const DB = tenantIsolationDB();
  const deletedKeys = [];
  const env = {
    DB,
    CLERK_USER: { id: "owner", email: "owner@example.com", full_name: "Owner" },
    RESUME_FILES: {
      async list({ prefix }) {
        assert.equal(prefix, "users/owner/");
        return { objects: [{ key: "users/owner/sources/s1/original" }, { key: "users/owner/builds/b1/versions/1/resume.pdf" }], truncated: false };
      },
      async delete(keys) { deletedKeys.push(...keys); }
    }
  };
  const result = await worker.fetch(new Request("https://livejobindex.com/api/me", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" })
  }), env, {});
  assert.equal(result.status, 200);
  assert.deepEqual(deletedKeys, ["users/owner/sources/s1/original", "users/owner/builds/b1/versions/1/resume.pdf"]);
  assert.ok(DB.mutations.some(item => item.sql === "delete from users where id = ?" && item.params[0] === "owner"));
});
