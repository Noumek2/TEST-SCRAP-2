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

const SEARCH_QUERY_TEMPLATES = [
  "entreprises au {country}",
  "entreprises {country}",
  "startups au {country}",
  "societes financieres au {country}",
  "entreprise de construction au {country}",
  "entreprise immobiliere au {country}",
  "entreprise BTP {country}",
  "ecoles au {country}",
  "hotel au {country}",
  "imprimerie au {country}",
  "entreprise import export au {country}",
  "entreprises agricoles au {country}",
  "entreprises industrielles au {country}",
];

const TRUSTED_DIRECTORY_HOSTS = [
  "businesslist.co.cm",
  "goafricaonline.com",
  "africannuaire.com",
];

const DIRECTORY_DETAIL_PATH_PATTERNS = [
  /\/category\//i,
  /\/companies\//i,
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
  "voir plus",
  "s inscrire",
  "s'inscrire",
  "get listed",
  "cameroon",
  "restaurants",
  "hotel",
  "hotels",
  "tourism",
  "shopping",
  "legal",
  "employment",
  "schools",
  "real estate",
  "contractors",
  "doctors",
  "business",
  "data analytics",
  "data & analytics",
  "communication publicite",
  "communication publicité",
  "agences de communication",
  "imprimeries",
  "batiment et construction",
  "bâtiment et construction",
  "adduction d eau",
  "adduction d'eau",
  "aluminium",
  "finances",
  "assurances",
  "commerces",
  "food beverage",
  "food & beverage",
  "energy power",
  "energy & power",
  "electronics electrical",
  "electronics & electrical",
  "construction real estate",
  "construction & real estate",
  "computer it",
  "computer & it",
  "chemicals",
  "automotive",
  "automotive automobile",
  "automotive & automobile",
  "arts crafts gifts",
  "arts crafts gifts",
  "arts, crafts gifts",
  "arts, crafts & gifts",
  "apparel fashion",
  "apparel & fashion",
  "agro agriculture",
  "agro & agriculture",
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

const COUNTRY_ALIASES = {
  cameroon: {
    canonical: "Cameroon",
    gl: "cm",
    serpLocation: "Cameroon",
    aliases: ["cameroon", "cameroun", "douala", "yaounde", "yaoundé", "bafoussam", "bamenda", "garoua", "buea", "+237"],
  },
  "ivory coast": {
    canonical: "Ivory Coast",
    gl: "ci",
    serpLocation: "",
    aliases: ["ivory coast", "cote d'ivoire", "cote divoire", "côte d'ivoire", "cote d ivoire", "abidjan", "+225"],
  },
  "cote d'ivoire": {
    canonical: "Ivory Coast",
    gl: "ci",
    serpLocation: "",
    aliases: ["ivory coast", "cote d'ivoire", "cote divoire", "côte d'ivoire", "cote d ivoire", "abidjan", "+225"],
  },
  "cote divoire": {
    canonical: "Ivory Coast",
    gl: "ci",
    serpLocation: "",
    aliases: ["ivory coast", "cote d'ivoire", "cote divoire", "côte d'ivoire", "cote d ivoire", "abidjan", "+225"],
  },
};

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
  "zoominfo.com",
  "pagesjaunes.online",
  "b2bmap.com",
  "afrikta.com",
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

  if (!TRUSTED_DIRECTORY_HOSTS.some((trustedHost) => hostname.includes(trustedHost))) {
    return false;
  }

  if (hostname === "businesslist.co.cm") {
    return /\/(category|location|companies)\//i.test(url) || title.includes("business list");
  }

  if (hostname.includes("goafricaonline.com")) {
    return /\/cm\/annuaire\//i.test(url);
  }

  if (hostname.includes("africannuaire.com")) {
    return /\/resultat\//i.test(url);
  }

  return false;
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
  const lowered = normalized
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

function buildCountryContext(country = "Cameroon") {
  const normalizedCountry = String(country || "Cameroon").trim();
  const key = normalizedCountry.toLowerCase();
  const alphaOnly = key.replace(/[^a-z]/g, "");
  const config = COUNTRY_ALIASES[key] || COUNTRY_ALIASES[alphaOnly] || null;
  const aliases = config ? config.aliases : [key];

  return {
    country: config ? config.canonical : normalizedCountry,
    aliases: [...new Set([key, alphaOnly, ...aliases].filter(Boolean))],
    gl: config ? config.gl : "",
    serpLocation: config ? config.serpLocation : "",
  };
}

function buildSearchQueries(country, customTemplates) {
  const templates = (Array.isArray(customTemplates) && customTemplates.length > 0) ? customTemplates : SEARCH_QUERY_TEMPLATES;
  return templates.map((template) => template.replace(/\{country\}/g, country));
}

function isCountryRelevantText(text, countryContext) {
  const haystack = (text || "").toLowerCase();
  return countryContext.aliases.some((term) => haystack.includes(term));
}

function isCountryRelevantUrl(url, countryContext) {
  const normalized = normalizeUrl(url) || "";
  const hostname = getHostname(normalized);
  if (countryContext.gl && hostname.endsWith("." + countryContext.gl)) return true;
  return isCountryRelevantText(normalized, countryContext);
}

function looksLikeCompanyCandidate(result, countryContext) {
  const hostname = getHostname(result.url);
  if (!hostname || isSkippableLink(result.url)) return false;

  const title = (result.name || "").toLowerCase();
  const snippet = (result.snippet || "").toLowerCase();
  const haystack = `${title} ${snippet}`;

  if (NON_COMPANY_TEXT_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return false;
  }

  if (NON_TARGET_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
    return false;
  }

  if (looksLikeArticleOrUiPath(result.url)) {
    return false;
  }

  const countryRelevant =
    isCountryRelevantUrl(result.url, countryContext) ||
    isCountryRelevantText(title, countryContext) ||
    isCountryRelevantText(snippet, countryContext) ||
    isCountryRelevantText(result.query || "", countryContext);

  if (!countryRelevant) {
    return false;
  }

  if (title.length < 3) return false;
  return true;
}

async function searchGoogleSerpApi(query, apiKey, countryContext) {
  const results = [];
  const params = new URLSearchParams({
    q: query,
    hl: "en",
    num: "10",
    api_key: apiKey,
  });

  if (countryContext.serpLocation) {
    params.set("location", countryContext.serpLocation);
  }

  if (countryContext.gl) {
    params.set("gl", countryContext.gl);
  }

  const url = `https://serpapi.com/search.json?${params.toString()}`;

  try {
    const res = await fetchWithRetry(() => axios.get(url, { timeout: 15000 }), "SerpApi");
    const data = res.data;

    (data.organic_results || []).forEach((r) => {
      if (r.title && r.link && !r.link.includes("google.com")) {
        results.push({ name: r.title, url: r.link, snippet: r.snippet || "", source: "google_serpapi", query });
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
      const snippet = $(el).find(".b_caption p").first().text().trim();
      const resolved = normalizeUrl(href);
      if (title && resolved && resolved.startsWith("http")) {
        results.push({ name: title, url: resolved, snippet, source: "bing", query });
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
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {    const res = await axios.get(url, {
      headers: getAxiosHeaders(), // Ajout de l'en-tête User-Agent
      timeout: 15000,
    });
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
        results.push({ name, url: resolved, snippet: "", source: "duckduckgo", query });
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
  const countryContext = options.countryContext || buildCountryContext();
  const listingIsCountryRelevant =
    isCountryRelevantUrl(result.url, countryContext) ||
    isCountryRelevantText(result.name, countryContext) ||
    isCountryRelevantText(result.snippet, countryContext) ||
    isCountryRelevantText(result.url, countryContext);

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
      const candidateIsCountryRelevant =
        isCountryRelevantUrl(absolute, countryContext) ||
        isCountryRelevantText(candidateText, countryContext);

      if (!hasUsefulAnchor && !looksLikeDetailPage) return;
      if (looksLikeArticlePath && !looksLikeDetailPage) return;
      if (sameHost && !looksLikeDetailPage) return;
      if (!sameHost && (!countryContext.gl || !hostname.endsWith("." + countryContext.gl)) && !candidateIsCountryRelevant) return;
      if (!listingIsCountryRelevant && !candidateIsCountryRelevant) return;
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
    const extracted = await extractCompaniesFromListing(result, {
      maxLinks: options.maxLinksPerListing || 8,
      countryContext: options.countryContext,
    });

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
  const companyLimit = Math.max(1, parseInt(options.companyLimit, 10) || 25);
  let allResults = [];
  const isVercel = process.env.VERCEL === "1";
  const countryContext = buildCountryContext(options.country || "Cameroon");
  // Utilise les templates personnalisés s'ils sont fournis dans options
  const queriesToRun = buildSearchQueries(countryContext.country, options.queryTemplates);

  console.log(`\nSearching across Google + Bing + DuckDuckGo for ${countryContext.country}...\n`);

  for (const q of queriesToRun) {
    if (CONFIG.serpApiKey) {
      allResults = allResults.concat(await searchGoogleSerpApi(q, CONFIG.serpApiKey, countryContext));
    }
    allResults = allResults.concat(await searchBing(q));
    await sleep(delayMs);
    allResults = allResults.concat(await searchDuckDuckGo(q));
    await sleep(delayMs);
  }

  const unique = deduplicate(allResults.filter((r) => r.name && r.name.length > 3));
  const companyCandidates = unique.filter((result) => isLikelyDirectoryResult(result) || looksLikeCompanyCandidate(result, countryContext));
  console.log(`    [filter] ${unique.length} raw candidates -> ${companyCandidates.length} likely company/listing pages`);
  const expanded = await expandDirectoryResults(companyCandidates, {
    delayMs: isVercel ? 400 : 1000,
    maxLinksPerListing: isVercel ? 5 : 6,
    countryContext,
  });

  try {
    const { filterNew } = require("./scraped");
    const filtered = await filterNew(expanded);
    return filtered.slice(0, companyLimit);
  } catch {
    return expanded.slice(0, companyLimit);
  }
}

module.exports = { searchCompanies };
