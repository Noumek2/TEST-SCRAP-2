const axios = require("axios");
const cheerio = require("cheerio");

const CONFIG = {
  serpApiKey: process.env.SERPAPI_KEY,
};

const SEARCH_QUERIES = [
  "construction company in Cameroon",
  "real estate company Cameroon",
  "societe construction Cameroun",
  "entreprise batiment Cameroun",
  "restauration services Cameroon",
  "hotels in Cameroon",
  "tourism companies in Cameroon",
  "transport companies in Cameroon",
  "agriculture companies in Cameroon",
  "manufacturing companies in Cameroon",
];

const DIRECTORY_HOST_KEYWORDS = [
  "yellowpages",
  "businesslist",
  "business-directory",
  "directory",
  "annuaire",
  "listing",
  "listings",
  "tripadvisor",
  "expedia",
  "booking",
  "africabizinfo",
  "zoominfo",
  "kompass",
];

const DIRECTORY_TEXT_KEYWORDS = [
  "companies",
  "businesses",
  "directory",
  "annuaire",
  "list of",
  "top ",
  "best ",
  "near me",
  "find ",
  "hotels in",
  "restaurants in",
];

const NON_COMPANY_TEXT_KEYWORDS = [
  "blog",
  "news",
  "article",
  "guide",
  "wikipedia",
  "map",
  "maps",
  "review",
  "reviews",
  "careers",
  "jobs",
  "vacancy",
  "login",
  "signup",
  "sign in",
  "privacy policy",
  "terms of service",
  "contact us",
];

const SKIP_HOST_KEYWORDS = [
  "google.",
  "bing.",
  "duckduckgo.",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "x.com",
  "twitter.com",
  "tripadvisor.",
  "booking.com",
];

async function fetchWithRetry(fn, label = "API", maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.response && err.response.status === 429;
      if (isRateLimit && attempt < maxRetries - 1) {
        attempt++;
        const waitTime = 5000 * attempt;
        console.log(`    [${label}] Rate limit hit. Retrying in ${waitTime / 1000}s...`);
        await sleep(waitTime);
      } else {
        throw err;
      }
    }
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function resolveAbsoluteUrl(href, baseUrl) {
  if (!href || typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!trimmed || /^(mailto:|tel:|javascript:|#)/i.test(trimmed)) return null;
  try {
    return normalizeUrl(trimmed.startsWith("http") ? trimmed : new URL(trimmed, baseUrl).toString());
  } catch {
    return null;
  }
}

function isLikelyDirectoryResult(result) {
  const url = (result.url || "").toLowerCase();
  const title = (result.name || "").toLowerCase();
  const snippet = (result.snippet || "").toLowerCase();
  const hostname = getHostname(result.url);

  if (DIRECTORY_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
    return true;
  }

  const haystack = `${title} ${snippet} ${url}`;
  return DIRECTORY_TEXT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function isSkippableLink(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return true;
  if (!/^https?:\/\//i.test(normalized)) return true;
  if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip)$/i.test(normalized)) return true;
  const hostname = getHostname(normalized);
  return SKIP_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword));
}

function inferCompanyName(anchorText, href) {
  const text = (anchorText || "").replace(/\s+/g, " ").trim();
  if (text && text.length >= 3) return text;

  try {
    const parsed = new URL(href);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

function looksLikeCompanyCandidate(result) {
  const hostname = getHostname(result.url);
  if (!hostname || isSkippableLink(result.url)) return false;

  const title = (result.name || "").toLowerCase();
  const snippet = (result.snippet || "").toLowerCase();
  const haystack = `${title} ${snippet}`;

  if (NON_COMPANY_TEXT_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return false;
  }

  if (DIRECTORY_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
    return false;
  }

  if (title.length < 3) return false;
  return true;
}

async function searchGoogleSerpApi(query, apiKey) {
  const results = [];
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&location=Cameroon&hl=en&gl=cm&num=10&api_key=${apiKey}`;

  try {
    const res = await fetchWithRetry(() => axios.get(url, { timeout: 15000 }), "SerpApi");
    const data = res.data;

    (data.organic_results || []).forEach((r) => {
      if (r.title && r.link && !r.link.includes("google.com")) {
        results.push({ name: r.title, url: r.link, snippet: r.snippet || "", source: "google_serpapi" });
      }
    });
    console.log(`    [Google/SerpApi] "${query}" -> ${results.length} results`);
  } catch (err) {
    console.log(`    [Google/SerpApi] Error: ${err.message}`);
  }
  return results;
}

async function searchBing(query) {
  const results = [];
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      timeout: 15000,
    });
    const $ = cheerio.load(res.data);
    $("li.b_algo").each((_, el) => {
      const title = $(el).find("h2 a").first().text().trim();
      const href = $(el).find("h2 a").first().attr("href") || "";
      if (title && href.startsWith("http")) {
        results.push({ name: title, url: href, snippet: "", source: "bing" });
      }
    });
    console.log(`    [Bing] "${query}" -> ${results.length} results`);
  } catch (err) {
    console.log(`    [Bing] Error: ${err.message}`);
  }
  return results;
}

async function searchDuckDuckGo(query) {
  const results = [];
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cm-fr`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const $ = cheerio.load(res.data);
    $(".result").each((_, el) => {
      const name = $(el).find(".result__title a").first().text().trim();
      let href = $(el).find(".result__title a").attr("href") || "";
      if (href.includes("uddg=")) {
        try {
          href = decodeURIComponent(new URL("https:" + href).searchParams.get("uddg") || "");
        } catch {}
      }
      if (name && href.startsWith("http")) {
        results.push({ name, url: href, snippet: "", source: "duckduckgo" });
      }
    });
    console.log(`    [DuckDuckGo] "${query}" -> ${results.length} results`);
  } catch (err) {
    console.log(`    [DuckDuckGo] Error: ${err.message}`);
  }
  return results;
}

function deduplicate(results) {
  const seen = new Set();
  return results.filter((r) => {
    const normalized = normalizeUrl(r.url);
    const key = normalized || (r.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 35);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    if (normalized) r.url = normalized;
    return true;
  });
}

async function extractCompaniesFromListing(result, options = {}) {
  const maxLinks = options.maxLinks || 8;
  const extracted = [];

  try {
    const res = await axios.get(result.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(res.data);
    const seen = new Set();

    $("a[href]").each((_, el) => {
      if (extracted.length >= maxLinks) return false;

      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      const absolute = resolveAbsoluteUrl(href, result.url);

      if (!absolute || isSkippableLink(absolute)) return;
      if (absolute === normalizeUrl(result.url)) return;

      const hostname = getHostname(absolute);
      const sameHost = hostname === getHostname(result.url);
      const looksLikeDetailPage = /\/company\/|\/business\/|\/listing\/|\/profile\/|\/hotel\/|\/restaurant\//i.test(absolute);
      const hasUsefulAnchor = text.length >= 3 && text.length <= 120;

      if (!hasUsefulAnchor && !looksLikeDetailPage) return;
      if (sameHost && !looksLikeDetailPage) return;
      if (seen.has(absolute)) return;

      seen.add(absolute);
      extracted.push({
        name: inferCompanyName(text, absolute),
        url: absolute,
        snippet: `Discovered from listing: ${result.name}`,
        source: `listing:${result.source}`,
      });
    });

    console.log(`    [listing] ${result.url} -> ${extracted.length} extracted company links`);
  } catch (err) {
    console.log(`    [listing] Failed to expand ${result.url}: ${err.message}`);
  }

  return extracted;
}

async function expandDirectoryResults(results, options = {}) {
  const expanded = [];
  const delayMs = options.delayMs || 1500;

  for (const result of results) {
    if (!isLikelyDirectoryResult(result)) {
      expanded.push(result);
      continue;
    }

    console.log(`    [listing] Expanding directory result: ${result.url}`);
    const extracted = await extractCompaniesFromListing(result, { maxLinks: options.maxLinksPerListing || 8 });

    if (extracted.length > 0) {
      expanded.push(...extracted);
    } else {
      console.log(`    [listing] Dropping unexpanded listing result: ${result.url}`);
    }

    await sleep(delayMs);
  }

  return deduplicate(expanded);
}

async function searchCompanies(options = {}) {
  const delayMs = options.delayMs || 2000;
  let allResults = [];
  const isVercel = process.env.VERCEL === "1";
  const queriesToRun = isVercel ? SEARCH_QUERIES.slice(0, 1) : SEARCH_QUERIES;

  console.log("\nSearching across Google + Bing + DuckDuckGo...\n");

  for (const q of queriesToRun) {
    if (CONFIG.serpApiKey) {
      allResults = allResults.concat(await searchGoogleSerpApi(q, CONFIG.serpApiKey));
    }
    allResults = allResults.concat(await searchBing(q));
    await sleep(delayMs);
    allResults = allResults.concat(await searchDuckDuckGo(q));
    await sleep(delayMs);
  }

  const unique = deduplicate(allResults.filter((r) => r.name && r.name.length > 3));
  const companyCandidates = unique.filter((result) => isLikelyDirectoryResult(result) || looksLikeCompanyCandidate(result));
  console.log(`    [filter] ${unique.length} raw candidates -> ${companyCandidates.length} likely company/listing pages`);
  const expanded = await expandDirectoryResults(companyCandidates, {
    delayMs: isVercel ? 500 : 1500,
    maxLinksPerListing: isVercel ? 4 : 8,
  });

  try {
    const { filterNew } = require("./scraped");
    return await filterNew(expanded);
  } catch {
    return expanded;
  }
}

module.exports = { searchCompanies };
