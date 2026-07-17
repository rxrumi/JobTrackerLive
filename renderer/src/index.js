import { Container, getContainer } from "@cloudflare/containers";

export class ResumeRenderer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname !== "/render" || request.method !== "POST") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return getContainer(env.RENDERER, "resume-renderer").fetch(request);
  }
};

