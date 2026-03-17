/**
 * search.js
 * Searches for construction and real estate companies in Cameroon using:
 *
 *  1. Google  — via SerpApi (free 100 searches/month) OR direct scraping with Puppeteer
 *  2. Bing    — direct scraping (much more lenient than Google)
 *  3. DuckDuckGo — HTML endpoint (no bot protection)
 *  4. Directory sites — africacompanies.com, kompass.com, annuaire.cm, yellowpages.cm
 *
 * CONFIG in config.json (optional):
 *   { "serpApiKey": "YOUR_KEY" }   <- Get free key at https://serpapi.com (100 searches/month free)
 *
 * If no SerpApi key is set, Google is scraped directly using Puppeteer (slower but free).
 */

const axios     = require("axios");
const cheerio   = require("cheerio");
const puppeteer = require("puppeteer");
const fs        = require("fs");
const path      = require("path");

// ── Load optional config ───────────────────────────────────────────────────
function loadConfig() {
  const cfgPath = path.join(__dirname, "config.json");
  if (fs.existsSync(cfgPath)) {
    try { return JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
  }
  return {};
}
const CONFIG = loadConfig();

// ── Queries ────────────────────────────────────────────────────────────────
const SEARCH_QUERIES = [
  "construction company Cameroon Douala",
  "construction company Cameroon Yaounde",
  "real estate company Cameroon",
  "apartment selling Cameroon",
  "societe construction Cameroun",
  "promoteur immobilier Cameroun Douala",
  "entreprise bâtiment Cameroun",
  "property developer Cameroon",
  "agence immobiliere Cameroun",
  "housing company Cameroon",
  "building contractor Cameroon",
  "real estate agent Yaounde Douala",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];
function randomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

function buildHeaders(referer) {
  return {
    "User-Agent":      randomUA(),
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer":         referer || "https://www.google.com/",
    "Cache-Control":   "no-cache",
  };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── 1A. Google via SerpApi (free 100/month) ────────────────────────────────
async function searchGoogleSerpApi(query, apiKey) {
  const results = [];
  const url = "https://serpapi.com/search.json?q=" + encodeURIComponent(query)
    + "&location=Cameroon&hl=en&gl=cm&num=10&api_key=" + apiKey;

  try {
    const res = await axios.get(url, { timeout: 15000 });
    const data = res.data;

    (data.organic_results || []).forEach((r) => {
      if (r.title && r.link && !r.link.includes("google.com")) {
        results.push({ name: r.title, url: r.link, snippet: r.snippet || "", source: "google_serpapi" });
      }
    });

    console.log("    [Google/SerpApi] \"" + query + "\" -> " + results.length + " results");
  } catch (err) {
    console.log("    [Google/SerpApi] Error: " + err.message);
  }
  return results;
}

// ── 1B. Google via Puppeteer (no API key needed) ───────────────────────────
// Uses a real headless Chrome — Google cannot distinguish it from a real user
async function searchGooglePuppeteer(queries) {
  const results = [];
  let browser;

  console.log("    [Google/Puppeteer] Launching browser for Google search...");

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--lang=en-US",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(randomUA());
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    // Block images and fonts to speed up
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "font", "media", "stylesheet"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    for (const query of queries) {
      try {
        const googleUrl = "https://www.google.com/search?q=" + encodeURIComponent(query) + "&num=10&hl=en&gl=cm";
        await page.goto(googleUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await sleep(1500 + Math.random() * 1000);

        const html = await page.content();
        const $    = cheerio.load(html);
        let found  = 0;

        // Extract results — Google uses div.g or [data-hveid] containers
        $("div.g, [data-sokoban-container], [jscontroller] h3").each((_, el) => {
          const container = $(el).closest("div.g, [data-hveid]").length
            ? $(el).closest("div.g, [data-hveid]")
            : $(el).parent();

          const titleEl   = $(el).is("h3") ? $(el) : $(el).find("h3").first();
          const linkEl    = container.find("a[href]").first();
          const snippetEl = container.find('[data-sncf], .VwiC3b, span.aCOpRe, div[style*="-webkit-line-clamp"]').first();

          const name    = titleEl.text().trim();
          let   href    = linkEl.attr("href") || "";
          const snippet = snippetEl.text().trim();

          // Clean Google redirect URLs
          if (href.startsWith("/url?q=")) {
            try { href = new URL("https://google.com" + href).searchParams.get("q") || href; } catch {}
          }

          if (name && href && href.startsWith("http") &&
              !href.includes("google.com") && !href.includes("youtube.com")) {
            results.push({ name, url: href, snippet, source: "google" });
            found++;
          }
        });

        console.log("    [Google/Puppeteer] \"" + query + "\" -> " + found + " results");
        await sleep(2000 + Math.random() * 1500); // Human-like delay between searches

      } catch (err) {
        console.log("    [Google/Puppeteer] Failed for \"" + query + "\": " + err.message);
      }
    }

  } catch (err) {
    console.log("    [Google/Puppeteer] Browser error: " + err.message);
  } finally {
    if (browser) await browser.close();
  }

  return results;
}

// ── 2. Bing search (much more lenient than Google) ─────────────────────────
async function searchBing(query) {
  const results = [];
  const url = "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&count=10&mkt=en-CM";

  try {
    const res = await axios.get(url, {
      headers: {
        ...buildHeaders("https://www.bing.com/"),
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(res.data);

    // Bing result structure: li.b_algo contains h2 > a and p.b_lineclamp
    $("li.b_algo").each((_, el) => {
      const titleEl   = $(el).find("h2 a").first();
      const snippetEl = $(el).find("p.b_lineclamp, .b_caption p, p").first();

      const name    = titleEl.text().trim();
      const href    = titleEl.attr("href") || "";
      const snippet = snippetEl.text().trim();

      if (name && href && href.startsWith("http") &&
          !href.includes("bing.com") && !href.includes("microsoft.com")) {
        results.push({ name, url: href, snippet, source: "bing" });
      }
    });

    console.log("    [Bing] \"" + query + "\" -> " + results.length + " results");
  } catch (err) {
    console.log("    [Bing] Error for \"" + query + "\": " + err.message);
  }

  return results;
}

// ── 3. DuckDuckGo ──────────────────────────────────────────────────────────
async function searchDuckDuckGo(query) {
  const results = [];
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query) + "&kl=cm-fr";

  try {
    const res = await axios.get(url, { headers: buildHeaders("https://duckduckgo.com/"), timeout: 15000 });
    const $   = cheerio.load(res.data);

    $(".result").each((_, el) => {
      const titleEl   = $(el).find(".result__title a, a.result__a").first();
      const snippetEl = $(el).find(".result__snippet").first();

      const name    = titleEl.text().trim();
      let   href    = titleEl.attr("href") || "";
      const snippet = snippetEl.text().trim();

      if (href.includes("uddg=")) {
        try { href = decodeURIComponent(new URL("https:" + href).searchParams.get("uddg") || ""); } catch {}
      }

      if (name && href && href.startsWith("http") && !href.includes("duckduckgo.com")) {
        results.push({ name, url: href, snippet, source: "duckduckgo" });
      }
    });

    console.log("    [DuckDuckGo] \"" + query + "\" -> " + results.length + " results");
  } catch (err) {
    console.log("    [DuckDuckGo] Error: " + err.message);
  }

  return results;
}

// ── 4. Directory scrapers ──────────────────────────────────────────────────
async function scrapeDirectory(url, baseUrl, label) {
  const results = [];
  try {
    const res = await axios.get(url, { headers: buildHeaders(baseUrl), timeout: 15000 });
    const $   = cheerio.load(res.data);

    $("h2 a, h3 a, .company-name a, .listing-name a, .business-name a, li a, .companyName a").each((_, el) => {
      const name = $(el).text().trim();
      let   href = $(el).attr("href") || "";
      if (href && !href.startsWith("http")) href = baseUrl + href;
      const snippet = $(el).closest("li, div, article").find("p, .description, .snippet").first().text().trim().slice(0, 150);
      if (name && name.length > 3) results.push({ name, url: href || url, snippet, source: label });
    });

    console.log("    [" + label + "] " + url + " -> " + results.length + " entries");
  } catch (err) {
    console.log("    [" + label + "] " + url + ": " + err.message);
  }
  return results;
}

async function scrapeAllDirectories() {
  let results = [];
  const dirs = [
    { url: "https://www.africacompanies.com/cameroon/construction/",  base: "https://www.africacompanies.com", label: "africacompanies" },
    { url: "https://www.africacompanies.com/cameroon/real-estate/",   base: "https://www.africacompanies.com", label: "africacompanies" },
    { url: "https://cm.kompass.com/a/construction-companies/cm001030/", base: "https://cm.kompass.com",        label: "kompass" },
    { url: "https://cm.kompass.com/a/real-estate-companies/cm001070/",  base: "https://cm.kompass.com",        label: "kompass" },
    { url: "http://www.annuaire.cm/construction",                      base: "http://www.annuaire.cm",         label: "annuaire.cm" },
    { url: "http://www.annuaire.cm/immobilier",                        base: "http://www.annuaire.cm",         label: "annuaire.cm" },
    { url: "https://www.yellowpages.cm/en/search?q=construction",      base: "https://www.yellowpages.cm",     label: "yellowpages.cm" },
    { url: "https://www.yellowpages.cm/en/search?q=immobilier",        base: "https://www.yellowpages.cm",     label: "yellowpages.cm" },
    { url: "https://www.yellowpages.cm/en/search?q=real+estate",       base: "https://www.yellowpages.cm",     label: "yellowpages.cm" },
  ];

  for (const d of dirs) {
    results = results.concat(await scrapeDirectory(d.url, d.base, d.label));
    await sleep(1500);
  }
  return results;
}

// ── Deduplication ──────────────────────────────────────────────────────────
function deduplicate(results) {
  const seen = new Set();
  return results.filter((r) => {
    const key = (r.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 35);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Main export ────────────────────────────────────────────────────────────
async function searchCompanies(options) {
  options = options || {};
  const delayMs = options.delayMs || 2000;
  let allResults = [];

  console.log("\n🔍 Searching across Google + Bing + DuckDuckGo + Directories...\n");

  // ── Google ──────────────────────────────────────────────────
  if (CONFIG.serpApiKey) {
    console.log("  [1/4] Google via SerpApi (API key found)...");
    for (const q of SEARCH_QUERIES) {
      allResults = allResults.concat(await searchGoogleSerpApi(q, CONFIG.serpApiKey));
      await sleep(500); // SerpApi has generous rate limits
    }
  } else {
    console.log("  [1/4] Google via Puppeteer (no API key — using headless browser)...");
    console.log("        Tip: Add a free SerpApi key to config.json for faster Google results");
    console.log("        Get one at https://serpapi.com (100 free searches/month)\n");
    // Pass all queries at once — Puppeteer opens one browser for all
    const googleResults = await searchGooglePuppeteer(SEARCH_QUERIES);
    allResults = allResults.concat(googleResults);
    console.log("    [Google/Puppeteer] Total: " + googleResults.length + " results\n");
  }

  // ── Bing ─────────────────────────────────────────────────────
  console.log("  [2/4] Bing searches...");
  for (const q of SEARCH_QUERIES) {
    allResults = allResults.concat(await searchBing(q));
    await sleep(delayMs + Math.random() * 800);
  }

  // ── DuckDuckGo ───────────────────────────────────────────────
  console.log("\n  [3/4] DuckDuckGo searches...");
  for (const q of SEARCH_QUERIES) {
    allResults = allResults.concat(await searchDuckDuckGo(q));
    await sleep(delayMs + Math.random() * 800);
  }

  // ── Directories ──────────────────────────────────────────────
  console.log("\n  [4/4] Scraping business directories...");
  allResults = allResults.concat(await scrapeAllDirectories());

  // Deduplicate
  const unique = deduplicate(allResults.filter((r) => r.name && r.name.length > 3));

  // Remove companies we've already scraped in earlier runs
  const { filterNew } = require("./scraped");
  const filtered = filterNew(unique);

  console.log("\n✅ Search complete. Total unique companies: " + unique.length);
  console.log("✅ New companies (not seen before): " + filtered.length);

  // Breakdown by source
  const sources = {};
  unique.forEach((r) => { sources[r.source] = (sources[r.source] || 0) + 1; });
  console.log("\n  Results by source:");
  Object.entries(sources).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => {
    console.log("    " + s.padEnd(20) + c);
  });
  console.log("");

  return filtered;
}

module.exports = { searchCompanies };