# Full SEO Audit Report: Live Job Index

Audit date: 2026-06-04 07:33 UTC  
Audited URL: https://livejobindex.com/  
Business type detected: SaaS-style job index and personal job-tracking web app  
Crawl scope: Homepage, legal pages, API feed, key crawler files, source inspection  
Browser checks: Skipped by repository instruction

## Executive Summary

Overall SEO Health Score: 65/100

Live Job Index is accessible, fast enough at the edge, and has clean basic metadata on the public pages. Its USP is finding active roles at big and top companies across leading countries, departments, and seniority levels from company careers pages and leading public job boards. It serves both candidates already in those countries and international candidates looking for visa-sponsored jobs in top markets where large companies often have a history of sponsorship. The homepage, privacy policy, and terms pages all return HTTP 200 over HTTPS, use unique titles/descriptions, include canonical tags, and expose a visible legal footer. The `/privacy` page is responsive in production.

The main SEO risk is crawler infrastructure. `robots.txt`, `sitemap.xml`, and `llms.txt` currently return the homepage HTML through the SPA asset fallback instead of valid crawler files. Plain HTTP also returns a 200 page instead of redirecting to HTTPS. The app has no structured data, limited server-rendered indexable body content, no sitemap discovery, and weak security/canonicalization headers.

## Score Breakdown

| Category | Weight | Score | Weighted |
| --- | ---: | ---: | ---: |
| Technical SEO | 22% | 62 | 13.6 |
| Content Quality | 23% | 70 | 16.1 |
| On-Page SEO | 20% | 82 | 16.4 |
| Schema / Structured Data | 10% | 25 | 2.5 |
| Performance | 10% | 72 | 7.2 |
| AI Search Readiness | 10% | 45 | 4.5 |
| Images | 5% | 88 | 4.4 |
| Total | 100% |  | 64.7 |

Rounded health score: 65/100

## Top Issues

1. `robots.txt` returns HTML with `content-type: text/html` instead of a robots file.
2. `sitemap.xml` returns HTML with `content-type: text/html` instead of XML.
3. Plain `http://livejobindex.com/` returns 200 instead of redirecting to HTTPS.
4. No JSON-LD structured data is present on homepage, privacy, or terms pages.
5. Homepage has only about 428 visible words outside scripts/styles, while most useful job data is client-rendered.

## Top Quick Wins

1. Add `public/robots.txt` with a sitemap directive.
2. Add `public/sitemap.xml` listing `/`, `/privacy`, and `/terms`.
3. Add a Worker-level HTTP-to-HTTPS redirect before route handling.
4. Add basic `WebSite`, `Organization`, and `WebApplication` JSON-LD to the homepage.
5. Add `Strict-Transport-Security` and lightweight security headers to HTML responses.

## Crawl Results

| URL | Status | Content-Type | Notes |
| --- | ---: | --- | --- |
| `https://livejobindex.com/` | 200 | `text/html` | Homepage accessible |
| `https://livejobindex.com/privacy` | 200 | `text/html` | Privacy page responsive |
| `https://livejobindex.com/terms` | 200 | `text/html` | Terms page responsive |
| `https://livejobindex.com/api/jobs` | 200 | `application/json` | Feed available; 15 postings returned in sampled response |
| `https://livejobindex.com/robots.txt` | 200 | `text/html` | Incorrectly serves homepage HTML |
| `https://livejobindex.com/sitemap.xml` | 200 | `text/html` | Incorrectly serves homepage HTML |
| `https://livejobindex.com/llms.txt` | 200 | `text/html` | Incorrectly serves homepage HTML |
| `http://livejobindex.com/` | 200 | `text/html` | Should redirect to HTTPS |
| `https://www.livejobindex.com/` | 200 | `text/html` | No canonical redirect to apex domain |

## Technical SEO

Technical SEO score: 62/100

Strengths:

- HTTPS endpoint is live and returns HTTP/2.
- Worker serves `/privacy` and `/terms` explicitly from static assets in `src/worker.js`.
- `/api/jobs` is cacheable with `cache-control: public, max-age=300`.
- Canonical tags point to the apex HTTPS URLs on public HTML pages.

Issues:

- `wrangler.toml` uses `not_found_handling = "single-page-application"`, so missing crawler files currently fall through to homepage HTML.
- `robots.txt` is invalid because it returns HTML.
- `sitemap.xml` is invalid because it returns HTML.
- HTTP does not redirect to HTTPS.
- `www.livejobindex.com` returns 200 instead of redirecting to the canonical apex domain.
- HTML responses do not expose visible hardening headers such as `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, or `Referrer-Policy`.

Recommendations:

- Add static `robots.txt`, `sitemap.xml`, and optionally `llms.txt`.
- Add Worker redirects for `http:` to `https:` and `www.livejobindex.com` to `livejobindex.com`.
- Add common HTML security headers through a response wrapper or Cloudflare rules.
- Consider returning 404 for unknown non-app routes that look like crawler files or assets.

## Content Quality

Content quality score: 70/100

Strengths:

- Homepage positioning is clear: active top-company job index for local candidates in leading countries and international candidates seeking visa-sponsored opportunities.
- Privacy and terms pages are substantive enough for trust/compliance and each has 300+ visible words.
- The product has a clear niche: international tech jobs, relocation markets, visa heuristics, ATS scans, and application tracking.

Issues:

- Homepage visible HTML has about 428 words after scripts/styles are removed.
- The most useful indexable content, including companies, countries, and live jobs, is generated client-side from JavaScript and API data.
- There are no static landing sections for target countries, role families, visa sponsorship, or public methodology.
- Trust details are minimal outside legal pages.

Recommendations:

- Add a short crawlable methodology section to the homepage explaining sources, update cadence, countries, role families, and visa heuristics.
- Add crawlable landing pages or sections for high-value intents such as "visa sponsorship tech jobs Europe", "RevOps jobs with visa sponsorship", and "relocation job tracker".
- Add an "About" or "Methodology" page if the homepage should stay app-focused.

## On-Page SEO

On-page SEO score: 82/100

Strengths:

- Homepage has a unique title and meta description.
- Privacy and terms pages have unique titles and descriptions.
- Each public page has one H1.
- Canonical tags are present.
- OG and Twitter image metadata exist on the homepage.
- Image alt text is present on inspected images.
- Current source now includes machine-readable privacy and terms links in `public/index.html`.

Issues:

- The deployed homepage still showed relative legal links during the crawl; the current working tree has already changed these to absolute canonical links.
- No Search Console verification token is configured yet; the source contains a placeholder comment.
- Footer and legal links are present, but there are no crawlable links to deeper SEO-relevant pages because those pages do not exist.

Recommendations:

- Deploy the pending homepage legal-link update.
- Add Search Console verification once the token is available.
- Add a small set of durable internal links to methodology, privacy, terms, and any future country/role pages.

## Schema & Structured Data

Schema score: 25/100

No JSON-LD was found on:

- `public/index.html`
- `public/privacy.html`
- `public/terms.html`
- Deployed homepage HTML

Recommended schema:

- `Organization` for Live Job Index / Sohaib Kazmi as operator.
- `WebSite` for the canonical domain.
- `WebApplication` or `SoftwareApplication` for the tracker.
- Optional `Dataset` or `ItemList` only if the public job feed is intended to be indexed and kept stable.

## Performance

Performance score: 72/100

Measured with curl timing, not browser/Lighthouse:

| URL | Total | TTFB/start transfer | Size |
| --- | ---: | ---: | ---: |
| Homepage | 0.529s | 0.391s | 128,973 bytes |
| Privacy | 0.390s | 0.390s | 5,846 bytes |
| API jobs | 0.492s | 0.492s | 7,828 bytes |

Strengths:

- Edge response times were acceptable from the audit environment.
- The API feed payload is modest.
- The homepage has only one external script: Google Analytics.

Issues:

- `public/index.html` is a large single file: about 129 KB deployed.
- Inline CSS is about 29 KB and inline JavaScript about 75 KB.
- Large local image assets exist, including `public/assets/og-image.png` at about 1.3 MB and `public/assets/logo.png` at about 1.2 MB.
- Static asset cache headers observed as `max-age=0, must-revalidate`, which limits browser caching benefit.

Recommendations:

- Keep the app simple, but consider splitting heavy non-critical JS if the homepage grows.
- Add longer cache TTLs for immutable fingerprinted assets, or use Cloudflare cache rules for `/assets/*`.
- Compress or replace oversized PNGs where visual quality allows.
- Run Lighthouse manually when browser verification is acceptable.

## Images

Image score: 88/100

Strengths:

- Inspected `<img>` tags include alt text.
- Favicon, SVG logo, webmanifest, and social image assets are present.
- OG image is reachable.

Issues:

- Some PNG assets are large for their role.
- No explicit dimensions were found for social images in the file system check, though homepage metadata declares 1200 x 1200.

Recommendations:

- Optimize `og-image.png` and `logo.png`.
- Keep explicit dimensions on any newly added images to reduce layout shift.

## AI Search Readiness

AI search readiness score: 45/100

Strengths:

- The homepage title and description clearly define the product category.
- Legal pages identify the operator.
- The API exposes fresh structured job data.

Issues:

- `llms.txt` returns homepage HTML instead of an AI-readable text file.
- No structured data is present.
- No crawlable methodology/source page explains how postings are collected, filtered, scored, and updated.
- Brand/entity signals are light: no sameAs links, organization schema, or public social/profile references.

Recommendations:

- Add `llms.txt` with a concise description, canonical URLs, allowed use, and key product facts.
- Add JSON-LD schema.
- Add a methodology page or section with stable facts that AI systems can cite.
- Add sameAs links where appropriate.

## Verification Findings From Previous Attempt

Reported issue: `https://livejobindex.com/privacy` is unresponsive.  
Current audit result: responsive, HTTP 200, `content-type: text/html`.

Reported issue: homepage does not include a privacy policy link.  
Current audit result: deployed homepage includes a visible `/privacy` footer link. Current source also adds canonical absolute privacy and terms links plus `<link rel="privacy-policy">`.

Reported issue: homepage URL ownership is not registered.  
Current audit result: this is an external ownership verification issue, not something the crawler can confirm from source. The source still has a placeholder for a Search Console verification meta tag.

## Data Limitations

- Browser rendering, screenshots, Lighthouse, Core Web Vitals lab tests, and Playwright checks were skipped by repository instruction.
- Google Search Console and GA4 credentials were not present in this repo.
- Semrush traffic analytics was unavailable on the current plan, so no third-party traffic, keyword, or ranking estimates are included.
