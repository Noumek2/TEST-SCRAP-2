const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");

const isVercelRuntime = process.env.VERCEL === "1";

let puppeteer = null;
try {
  puppeteer = require(isVercelRuntime ? "puppeteer-core" : "puppeteer");
} catch {
  try {
    puppeteer = require("puppeteer");
  } catch {
    puppeteer = null;
  }
}

let chromium = null;
if (isVercelRuntime) {
  try {
    chromium = require("@sparticuz/chromium");
  } catch {
    chromium = null;
  }
}

const CONFIG = {
  serpApiKey: process.env.SERPAPI_KEY,
};

const SEARCH_QUERIES = [
<<<<<<< HEAD
<<<<<<< HEAD
  "Hotels du Cameroun",
  "real estate company Cameroon",
  "societe construction Cameroun",
  "entreprise bâtiment Cameroun",
  "Retauration services Cameroon",
  "Hotels in Cameroon",
  "Tourism companies in Cameroon",
  "Transport companies in Cameroon",
  "Agriculture companies in Cameroon",
  "Manufacturing companies in Cameroon",
  
 ];
=======
=======
  "companies in Cameroon",
  "entreprises Cameroun",
  "business directory Cameroon",
>>>>>>> 9f32b66 (increase querry26)
  "construction company in Cameroon",
  "real estate company Cameroon",
  "societe construction Cameroun",
  "entreprise batiment Cameroun",
  "restaurant company Cameroon",
  "hotel company Cameroon",
  "tour operator Cameroon",
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
  "africabizinfo",
  "zoominfo",
  "kompass",
];

const DIRECTORY_DETAIL_PATH_PATTERNS = [
  /\/category\//i,
  /\/company\//i,
  /\/business\//i,
  /\/listing\//i,
  /\/profile\//i,
  /\/view\//i,
  /\/cmp\//i,
  /\/annuaire\//i,
  /\/resultat\//i,
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
  "author",
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
  "disclaimer",
  "be the first to comment",
  "send enquiry",
  "small business",
  "public sector",
  "d-u-n-s",
  "business credit",
  "business growth",
  "business risk",
  "service center",
  "resources",
];

const GENERIC_ANCHOR_KEYWORDS = [
  "business insight",
  "career advice",
  "campus gist",
  "project tips",
  "construction news",
  "cv & motivation letters",
  "cv and motivation letters",
  "read more",
  "learn more",
  "en savoir plus",
  "original",
  "disclaimer",
  "send enquiry",
  "be the first to comment!",
  "be the first to comment",
  "english",
  "francais",
  "français",
  "espanol",
  "español",
  "romana",
  "bahasa indonesia",
  "portugues",
  "português",
  "home",
  "about",
  "contact",
  "services",
  "blog",
  "news",
  "tips",
  "jobs",
  "careers",
  "login",
  "sign up",
  "privacy policy",
  "terms of service",
];

const COUNTRY_LINK_TEXT = [
  "afrique",
  "algerie",
  "algérie",
  "angola",
  "benin",
  "bénin",
  "burkina faso",
  "congo-brazzaville",
  "congo-kinshasa",
  "cote d’ivoire",
  "côte d’ivoire",
  "djibouti",
  "egypte",
  "égypte",
  "gabon",
  "ghana",
  "guinee",
  "guinée",
  "mali",
  "senegal",
  "sénégal",
  "togo",
];

const CAMEROON_TERMS = [
  "cameroon",
  "cameroun",
  "douala",
  "yaounde",
  "yaoundé",
  "bafoussam",
  "bamenda",
  "garoua",
  "buea",
  "+237",
];

const NON_TARGET_HOST_KEYWORDS = [
  "businessincameroon.com",
  "stopblablacam.com",
  "scribd.com",
  "slideshare.net",
  "dnb.com",
  "f6s.com",
  "globaldatabase.com",
  "lusha.com",
  "coresignal.com",
  "constructiondive.com",
  "realtor.com",
  "therealreal.com",
  "zillow.com",
  "redfin.com",
  "loopnet.com",
  "apartments.com",
  "forbes.com",
  "wikipedia.org",
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
>>>>>>> 3bbe7ef (increase querry5)

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
    const parsed = new URL(decodeSpecialRedirectUrl(url));
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getHostname(url) {
  try {
    return new URL(decodeSpecialRedirectUrl(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function decodeSpecialRedirectUrl(url) {
  if (!url || typeof url !== "string") return url;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname.includes("bing.com") && parsed.pathname.startsWith("/ck/")) {
      const wrapped = parsed.searchParams.get("u");
      if (wrapped) {
        if (/^a1/i.test(wrapped)) {
          try {
            return Buffer.from(wrapped.slice(2), "base64").toString("utf8");
          } catch {}
        }
        return wrapped;
      }
    }
  } catch {}

  return url;
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

  if (!hostname || isSkippableLink(result.url)) {
    return false;
  }

  if (NON_TARGET_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
    return false;
  }

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

function looksLikeDirectoryDetailPage(url) {
  return DIRECTORY_DETAIL_PATH_PATTERNS.some((pattern) => pattern.test(url || ""));
}

function looksLikeArticleOrUiPath(url) {
  return /\/(author|news|article|articles|economy|slideshow|doc|docs|teachers|resources|smb)\b/i.test(url || "");
}

function looksLikeCompanyAnchor(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 3 || normalized.length > 120) return false;
  const lowered = normalized.toLowerCase();
  if (NON_COMPANY_TEXT_KEYWORDS.some((keyword) => lowered.includes(keyword))) return false;
  if (DIRECTORY_TEXT_KEYWORDS.some((keyword) => lowered.includes(keyword))) return false;
  if (GENERIC_ANCHOR_KEYWORDS.some((keyword) => lowered.includes(keyword))) return false;
  if (COUNTRY_LINK_TEXT.includes(lowered)) return false;
  return true;
}

function hasNavigationAncestor($, el) {
  return $(el).parents("nav, header, footer, menu").length > 0;
}

function pathDepth(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function isCameroonRelevantText(text) {
  const haystack = (text || "").toLowerCase();
  return CAMEROON_TERMS.some((term) => haystack.includes(term));
}

function isCameroonRelevantUrl(url) {
  const normalized = normalizeUrl(url) || "";
  const hostname = getHostname(normalized);
  if (hostname.endsWith(".cm")) return true;
  return isCameroonRelevantText(normalized);
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

  if (NON_TARGET_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
    return false;
  }

  const cameroonRelevant =
    isCameroonRelevantUrl(result.url) ||
    isCameroonRelevantText(title) ||
    isCameroonRelevantText(snippet);

  if (!cameroonRelevant) {
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
      const resolved = normalizeUrl(href);
      if (title && resolved && resolved.startsWith("http")) {
        results.push({ name: title, url: resolved, snippet: "", source: "bing" });
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
      const resolved = normalizeUrl(href);
      if (name && resolved && resolved.startsWith("http")) {
        results.push({ name, url: resolved, snippet: "", source: "duckduckgo" });
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

function getAxiosHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };
}

async function getServerlessChromePath() {
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.CHROMIUM_PATH;

  if (envPath) return envPath;
  if (chromium && typeof chromium.executablePath === "function") {
    return chromium.executablePath();
  }
  return null;
}

async function fetchListingHtmlWithBrowser(url) {
  if (!puppeteer) {
    throw new Error("Puppeteer is not available for browser fallback");
  }

  const executablePath = isVercelRuntime ? await getServerlessChromePath() : undefined;
  const launchOptions = {
    headless: isVercelRuntime ? true : "new",
    ignoreHTTPSErrors: true,
    args: isVercelRuntime && chromium ? chromium.args : [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
    ],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
  if (isVercelRuntime && chromium) {
    launchOptions.defaultViewport = chromium.defaultViewport;
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(1500);
    return await page.content();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function fetchListingHtml(url) {
  try {
    const response = await axios.get(url, {
      headers: getAxiosHeaders(),
      timeout: 15000,
      maxRedirects: 5,
    });
    return response.data;
  } catch (err) {
    const status = err.response && err.response.status;
    const message = err.message || "";

    if (status === 403) {
      console.log(`    [listing] Axios blocked on ${url}, retrying with browser fallback...`);
      return await fetchListingHtmlWithBrowser(url);
    }

    if (/certificate|self[- ]signed|SSL|unable to verify/i.test(message)) {
      console.log(`    [listing] SSL issue on ${url}, retrying with insecure HTTPS...`);
      const insecureResponse = await axios.get(url, {
        headers: getAxiosHeaders(),
        timeout: 15000,
        maxRedirects: 5,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });
      return insecureResponse.data;
    }

    throw err;
  }
}

async function extractCompaniesFromListing(result, options = {}) {
  const maxLinks = options.maxLinks || 8;
  const extracted = [];
  const listingIsCameroonRelevant =
    isCameroonRelevantUrl(result.url) ||
    isCameroonRelevantText(result.name) ||
    isCameroonRelevantText(result.snippet) ||
    isCameroonRelevantText(result.url);

  try {
    const html = await fetchListingHtml(result.url);
    const $ = cheerio.load(html);
    const seen = new Set();

    $("a[href]").each((_, el) => {
      if (extracted.length >= maxLinks) return false;
      if (hasNavigationAncestor($, el)) return;

      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      const absolute = resolveAbsoluteUrl(href, result.url);

      if (!absolute || isSkippableLink(absolute)) return;
      if (absolute === normalizeUrl(result.url)) return;

      const hostname = getHostname(absolute);
      const sameHost = hostname === getHostname(result.url);
      const looksLikeDetailPage = looksLikeDirectoryDetailPage(absolute);
      const looksLikeArticlePath = looksLikeArticleOrUiPath(absolute);
      const hasUsefulAnchor = looksLikeCompanyAnchor(text);
      const candidateText = `${text} ${absolute}`;
      const candidateIsCameroonRelevant =
        isCameroonRelevantUrl(absolute) ||
        isCameroonRelevantText(candidateText);

      if (!hasUsefulAnchor && !looksLikeDetailPage) return;
      if (looksLikeArticlePath && !looksLikeDetailPage) return;
      if (sameHost && !looksLikeDetailPage && pathDepth(absolute) < 2) return;
      if (!listingIsCameroonRelevant && !candidateIsCameroonRelevant) return;
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
<<<<<<< HEAD
  const isServerless = process.env.RENDER === "true" || process.env.VERCEL === "1";
  const queriesToRun = SEARCH_QUERIES;
=======
  const isVercel = process.env.VERCEL === "1";
  const queriesToRun = SEARCH_QUERIES;

<<<<<<< HEAD
>>>>>>> 5313f5a (increase querry4)

  console.log("\n🔍 Searching across Google + Bing + DuckDuckGo...\n");
=======
  console.log("\nSearching across Google + Bing + DuckDuckGo...\n");
>>>>>>> 3bbe7ef (increase querry5)

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
    maxLinksPerListing: isVercel ? 10 : 10,
  });

  try {
    const { filterNew } = require("./scraped");
    return await filterNew(expanded);
  } catch {
    return expanded;
  }
}

module.exports = { searchCompanies };
