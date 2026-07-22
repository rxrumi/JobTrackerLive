import { readFile, writeFile } from "node:fs/promises";

const assetVersion = "20260722-2";
const indexPath = new URL("../public/index.html", import.meta.url);
const appPath = new URL("../public/app.js", import.meta.url);
let html = await readFile(indexPath, "utf8");

const alreadySplit = /src="\/app\.js(?:\?v=[^"]+)?"/.test(html);

if (!alreadySplit) {
  const styleMatch = html.match(/<style>\n?([\s\S]*?)<\/style>/);
  if (!styleMatch) throw new Error("inline_style_not_found");
  await writeFile(new URL("../public/critical.css", import.meta.url), `${styleMatch[1].trim()}\n`);
  html = html.replace(styleMatch[0], '<link rel="stylesheet" href="/critical.css">');

  const themeStart = html.indexOf("<script>\n(function() {");
  const themeEnd = html.indexOf("</script>", themeStart);
  if (themeStart < 0 || themeEnd < 0) throw new Error("theme_script_not_found");
  const themeCode = html.slice(themeStart + "<script>\n".length, themeEnd).trim();
  await writeFile(new URL("../public/theme.js", import.meta.url), `${themeCode}\n`);
  html = `${html.slice(0, themeStart)}<script src="/theme.js"></script>${html.slice(themeEnd + "</script>".length)}`;

  const appStart = html.lastIndexOf("<script>\n");
  const appEnd = html.lastIndexOf("</script>");
  if (appStart < 0 || appEnd <= appStart) throw new Error("app_script_not_found");
  const appCode = html.slice(appStart + "<script>\n".length, appEnd).trim();
  await writeFile(appPath, `${appCode}\n`);
  html = `${html.slice(0, appStart)}<script type="module" src="/app.js?v=${assetVersion}"></script>${html.slice(appEnd + "</script>".length)}`;
}

let app = await readFile(appPath, "utf8");
if (app.startsWith("const STATIC_COMPANIES = [")) {
  const taxonomyStart = app.indexOf("const COUNTRY_NAMES =");
  if (taxonomyStart < 0) throw new Error("frontend_taxonomy_boundary_not_found");
  const targets = app
    .slice(0, taxonomyStart)
    .replace(/^const STATIC_COMPANIES/, "export const STATIC_COMPANIES")
    .replace(/\nconst ENGINEERING_STATIC_COMPANIES/, "\nexport const ENGINEERING_STATIC_COMPANIES");
  await writeFile(new URL("../public/targets.js", import.meta.url), targets);
  app = `import { STATIC_COMPANIES, ENGINEERING_STATIC_COMPANIES } from "./targets.js?v=${assetVersion}";\nimport { COUNTRY_NAMES, COUNTRY_FLAGS, ROLE_FAMILY_NAMES as ROLE_FAMILIES, SENIORITY_NAMES as SENIORITIES, scoreJob } from "./taxonomy.js?v=${assetVersion}";\n${app.slice(taxonomyStart)}`;
  app = app
    .replace(/^const COUNTRY_NAMES = .*;\n/m, "")
    .replace(/^const COUNTRY_FLAGS = .*;\n/m, "")
    .replace(/^const ROLE_FAMILIES = .*;\n/m, "")
    .replace(/^const SENIORITIES = .*;\n/m, "");
  await writeFile(appPath, app);
}

html = html.replace(/<script(?: type="module")? src="\/app\.js(?:\?v=[^"]+)?"(?: defer)?><\/script>/, `<script type="module" src="/app.js?v=${assetVersion}"></script>`);

html = html
  .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
  .replace(/>\s+</g, "><")
  .replace(/^\s+|\s+$/g, "");

await writeFile(indexPath, `${html}\n`);
process.stdout.write(alreadySplit ? "frontend_minified\n" : "frontend_split_complete\n");
