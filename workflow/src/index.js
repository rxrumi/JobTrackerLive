import { WorkflowEntrypoint } from "cloudflare:workers";
import { processResumeBuild, processResumeRevision } from "../../src/resume-studio.js";
import { processAccountDeletion, processDataExport } from "../../src/account-lifecycle.js";

async function run(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).run();
}

async function first(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).first();
}

async function all(env, sql, ...params) {
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result?.results || [];
}

const deps = { run, first, all };

export class ResumeBuildWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const buildId = String(event.payload?.build_id || "");
    const type = event.payload?.type === "revision" ? "revision" : "build";
    if (!buildId) throw new Error("build_id_required");

    await step.do(type === "revision" ? "execute-resume-revision" : "execute-resume-build", {
      retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
      timeout: "15 minutes"
    }, async () => {
      if (type === "revision") await processResumeRevision(this.env, buildId, deps);
      else await processResumeBuild(this.env, buildId, deps);
    });

    return { build_id: buildId, type, completed: true };
  }
}

export class AccountLifecycleWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const requestId = String(event.payload?.request_id || "");
    const type = event.payload?.type;
    if (!requestId || !new Set(["delete_account", "export_account"]).has(type)) {
      throw new Error("invalid_account_lifecycle_request");
    }
    await step.do(type === "delete_account" ? "delete-account" : "export-account", {
      retries: { limit: 8, delay: "30 seconds", backoff: "exponential" },
      timeout: "30 minutes"
    }, async () => {
      if (type === "delete_account") await processAccountDeletion(this.env, requestId);
      else await processDataExport(this.env, requestId);
    });
    return { request_id: requestId, type, completed: true };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/instances" && request.method === "POST") {
      const payload = await request.json();
      const buildId = String(payload.build_id || "");
      if (!buildId) return Response.json({ error: "build_id_required" }, { status: 400 });
      const instance = await env.RESUME_BUILD_WORKFLOW.create({ id: buildId, params: { build_id: buildId } });
      return Response.json({ id: instance.id }, { status: 202 });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }
};
