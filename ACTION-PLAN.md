# SEO Action Plan: Live Job Index

Audit date: 2026-06-04  
Target site: https://livejobindex.com/

## Critical

No true indexing-blocking critical issue was found. The homepage, privacy page, terms page, and API are reachable over HTTPS.

## High Priority

### 1. Add valid `robots.txt`

Problem: `https://livejobindex.com/robots.txt` currently returns homepage HTML.

Recommended file:

```txt
User-agent: *
Allow: /

Sitemap: https://livejobindex.com/sitemap.xml
```

Acceptance check:

```bash
curl -I https://livejobindex.com/robots.txt
curl https://livejobindex.com/robots.txt
```

Expected result: `content-type: text/plain` or compatible text type, and no HTML.

### 2. Add valid `sitemap.xml`

Problem: `https://livejobindex.com/sitemap.xml` currently returns homepage HTML.

Recommended initial sitemap:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://livejobindex.com/</loc>
  </url>
  <url>
    <loc>https://livejobindex.com/privacy</loc>
  </url>
  <url>
    <loc>https://livejobindex.com/terms</loc>
  </url>
</urlset>
```

Acceptance check:

```bash
curl -I https://livejobindex.com/sitemap.xml
curl https://livejobindex.com/sitemap.xml
```

Expected result: XML content, not homepage HTML.

### 3. Redirect HTTP to HTTPS

Problem: `http://livejobindex.com/` returns 200.

Implementation option: add this at the top of the Worker `fetch` handler after `const url = new URL(request.url);`:

```js
if (url.protocol === "http:") {
  url.protocol = "https:";
  return Response.redirect(url.toString(), 301);
}
```

Acceptance check:

```bash
curl -I http://livejobindex.com/
```

Expected result: `301` or `308` to `https://livejobindex.com/`.

### 4. Canonicalize `www` to apex

Problem: `https://www.livejobindex.com/` returns 200 while the canonical URL is apex.

Implementation option:

```js
if (url.hostname === "www.livejobindex.com") {
  url.hostname = "livejobindex.com";
  return Response.redirect(url.toString(), 301);
}
```

Acceptance check:

```bash
curl -I https://www.livejobindex.com/
```

Expected result: `301` or `308` to `https://livejobindex.com/`.

### 5. Deploy the pending legal-link update

Problem: the live crawl still showed relative legal links. Current source has already changed the homepage footer links to absolute canonical URLs and added `rel="privacy-policy"`.

Acceptance check after deploy:

```bash
curl -s https://livejobindex.com/ | rg 'rel="privacy-policy"|https://livejobindex.com/privacy'
```

Expected result: both the machine-readable privacy link and visible canonical privacy link are present.

## Medium Priority

### 6. Add homepage JSON-LD

Add basic structured data to `public/index.html`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://livejobindex.com/#website",
      "url": "https://livejobindex.com/",
      "name": "Live Job Index",
      "description": "A live index of active jobs at top companies for candidates in leading countries and international job seekers targeting visa-sponsored roles."
    },
    {
      "@type": "WebApplication",
      "@id": "https://livejobindex.com/#app",
      "name": "Live Job Index",
      "url": "https://livejobindex.com/",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web"
    }
  ]
}
</script>
```

Acceptance check:

```bash
rg 'application/ld\\+json' public/index.html
```

### 7. Add `llms.txt`

Problem: `https://livejobindex.com/llms.txt` returns homepage HTML.

Recommended scope:

- Product description
- Canonical URLs
- Data sources and update cadence
- Role/country coverage
- Privacy and terms links
- Contact/access note

Acceptance check:

```bash
curl https://livejobindex.com/llms.txt
```

Expected result: plain text, not HTML.

### 8. Add a crawlable methodology section or page

Problem: the homepage is app-first and the useful job data is mostly client-rendered.

Recommended content:

- What Live Job Index tracks: active top-company jobs from careers pages and leading public job boards for local candidates and international candidates seeking visa-sponsored roles
- Which countries are covered
- How ATS sources are scanned
- Difference between live postings and static targets
- How visa, seniority, freshness, and score are calculated

Keep it concise and useful; this is for trust and citability, not marketing filler.

### 9. Add security headers

Recommended baseline:

```txt
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

Use care with `Content-Security-Policy` because the current app uses inline CSS and JavaScript.

## Low Priority

### 10. Optimize oversized PNG assets

Observed local sizes:

- `public/assets/og-image.png`: about 1.3 MB
- `public/assets/logo.png`: about 1.2 MB

Recommended:

- Convert non-transparent images to WebP or AVIF where supported.
- Keep PNG fallback only if needed.
- Use Cloudflare image/cache rules if this becomes a real performance issue.

### 11. Add Search Console verification

The homepage source contains a placeholder comment for a Google verification meta tag. Once the token is available, add it to `public/index.html` and deploy.

### 12. Consider static SEO landing pages later

Only do this if organic acquisition matters. Useful candidates:

- Visa sponsorship tech jobs
- RevOps jobs with visa sponsorship
- Technology jobs in relocation markets
- Country-specific pages for the 15 tracked markets

## Suggested Implementation Order

1. `robots.txt`, `sitemap.xml`, and `llms.txt`.
2. HTTP and `www` redirects.
3. Deploy pending legal-link update.
4. JSON-LD schema.
5. Security headers.
6. Methodology content.
7. Asset optimization.

## Post-Fix Verification

Run:

```bash
npm test
npx wrangler deploy --dry-run
curl -I http://livejobindex.com/
curl -I https://www.livejobindex.com/
curl -I https://livejobindex.com/robots.txt
curl -I https://livejobindex.com/sitemap.xml
curl -I https://livejobindex.com/llms.txt
curl -s https://livejobindex.com/ | rg 'privacy-policy|application/ld\\+json'
```

Per repository instruction, browser verification remains manual.
