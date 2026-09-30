// Static site builder: wraps src/pages/**/*.html with shared partials into public/.
// Each page starts with a meta block:  <!--meta {"title": "...", "description": "..."} -->
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const config = JSON.parse(readFileSync("site.config.json", "utf8"));
// Allow per-host override, e.g. SITE_URL=https://visaprep.pages.dev for Cloudflare Pages.
if (process.env.SITE_URL) config.siteUrl = process.env.SITE_URL.replace(/\/$/, "");
const SRC = "src/pages";
// Path prefix when hosted under a sub-path (e.g. username.github.io/visaprep).
const BASE = new URL(config.siteUrl).pathname.replace(/\/$/, "");
const OUT = "public";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync("src/static", OUT, { recursive: true });

const partial = (name) => readFileSync(`src/partials/${name}.html`, "utf8");
const layout = partial("layout");
const header = partial("header");
const footer = partial("footer");

// AdSense is only emitted once a real publisher ID is configured.
const adsEnabled = /^ca-pub-\d+$/.test(config.adsenseClient);
const adScript = adsEnabled
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.adsenseClient}" crossorigin="anonymous"></script>`
  : "";
const adUnit = (slot) =>
  adsEnabled
    ? `<div class="ad"><ins class="adsbygoogle" style="display:block" data-ad-client="${config.adsenseClient}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`
    : `<div class="ad ad-placeholder" aria-hidden="true">Ad space</div>`;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : [];
  });
}

const urls = [];
for (const file of walk(SRC)) {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^<!--meta\s+([\s\S]*?)-->/);
  if (!m) throw new Error(`Missing meta block in ${file}`);
  const meta = JSON.parse(m[1]);
  const rel = relative(SRC, file);
  const path = "/" + rel.replace(/index\.html$/, "").replace(/\.html$/, "");
  const canonical = config.siteUrl + path;
  urls.push({ loc: canonical, priority: path === "/" ? "1.0" : "0.8" });

  let body = raw.slice(m[0].length);
  body = body.replace(/\{\{ad:(\w+)\}\}/g, (_, key) => adUnit(config.adSlots[key] || ""));

  const html = layout
    .replaceAll("{{title}}", meta.title === config.siteName ? meta.title : `${meta.title} | ${config.siteName}`)
    .replaceAll("{{description}}", meta.description)
    .replaceAll("{{canonical}}", canonical)
    .replaceAll("{{adScript}}", adScript)
    .replaceAll("{{scripts}}", (meta.scripts || []).map((s) => `<script src="{{base}}${s}" defer></script>`).join("\n"))
    .replace("{{header}}", header)
    .replace("{{footer}}", footer)
    .replace("{{body}}", body)
    .replaceAll("{{siteName}}", config.siteName)
    .replaceAll("{{year}}", String(new Date().getFullYear()))
    .replaceAll("{{contactEmail}}", config.contactEmail)
    .replaceAll("{{base}}", BASE);

  const outFile = join(OUT, rel);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority></url>`).join("\n") +
    `\n</urlset>\n`
);
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
if (adsEnabled) {
  const pubId = config.adsenseClient.replace("ca-", "");
  writeFileSync(join(OUT, "ads.txt"), `google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`);
}
if (config.customDomain) writeFileSync(join(OUT, "CNAME"), config.customDomain + "\n");

console.log(`Built ${urls.length} pages into ${OUT}/ (ads ${adsEnabled ? "on" : "off"})`);
