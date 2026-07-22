(function () {
  const COOKIE = "lji_consent";
  const GA_ID = "G-CNP336YP4G";
  const CLARITY_ID = "x1ofvybrrq";
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", wait_for_update: 500 });

  function cookieValue(name) {
    return document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.split("=").slice(1).join("=") || "";
  }

  function loadAnalytics() {
    if (window.LJI_ANALYTICS_ALLOWED) return;
    window.LJI_ANALYTICS_ALLOWED = true;
    window.gtag("consent", "update", { analytics_storage: "granted", ad_storage: "denied" });
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { anonymize_ip: true });
    const ga = document.createElement("script");
    ga.async = true;
    ga.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    document.head.appendChild(ga);

    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    window.clarity("set", "input-mask", "strict");
    const clarity = document.createElement("script");
    clarity.async = true;
    clarity.src = `https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_ID)}`;
    document.head.appendChild(clarity);
  }

  async function save(analytics) {
    if (navigator.globalPrivacyControl) analytics = false;
    const response = await fetch("/api/privacy/consent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analytics })
    });
    if (!response.ok) throw new Error("consent_save_failed");
    document.getElementById("consent-banner").hidden = true;
    if (analytics) {
      loadAnalytics();
      await fetch("/api/session", { method: "POST", credentials: "same-origin" }).catch(() => null);
    } else {
      window.LJI_ANALYTICS_ALLOWED = false;
      window.gtag?.("consent", "update", { analytics_storage: "denied" });
      window.clarity?.("consent", false);
      document.cookie.split(";").map(item => item.split("=")[0].trim()).filter(name => name.startsWith("_cl") || name.startsWith("_ga"))
        .forEach(name => { document.cookie = `${name}=; Max-Age=0; Path=/; Secure; SameSite=Lax`; });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const banner = document.getElementById("consent-banner");
    if (!banner) return;
    const existing = cookieValue(COOKIE);
    if (navigator.globalPrivacyControl) {
      save(false).catch(() => { banner.hidden = false; });
    } else if (existing === "analytics") {
      loadAnalytics();
    } else if (!existing) {
      banner.hidden = false;
    }
    document.getElementById("consent-essential")?.addEventListener("click", () => save(false).catch(() => { banner.hidden = false; }));
    document.getElementById("consent-analytics")?.addEventListener("click", () => save(true).catch(() => { banner.hidden = false; }));
    document.querySelectorAll("[data-privacy-choices]").forEach(button => button.addEventListener("click", () => {
      banner.hidden = false;
      document.getElementById("consent-essential")?.focus();
    }));
  });
})();
