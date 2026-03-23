const axios = require("axios");
const cheerio = require("cheerio");


const CONFIG = {
  serpApiKey: process.env.SERPAPI_KEY
};


const SEARCH_QUERIES = [
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

// --- RETRY WRAPPER ---
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
        console.log(`    [${label}] ⚠️ Rate limit hit. Retrying in ${waitTime / 1000}s...`);
        await new Promise((r) => setTimeout(r, waitTime));
      } else {
        throw err;
      }
    }
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- GOOGLE SERPAPI ---
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

// --- BING ---
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

// --- DUCKDUCKGO ---
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
        } catch (e) {}
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

// --- DEDUPLICATION ---
function deduplicate(results) {
  const seen = new Set();
  return results.filter((r) => {
    const key = (r.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 35);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- MAIN EXPORT ---
async function searchCompanies(options = {}) {
  const delayMs = options.delayMs || 2000;
  let allResults = [];
<<<<<<< HEAD
  const isServerless = process.env.RENDER === "true" || process.env.VERCEL === "1";
  const queriesToRun = SEARCH_QUERIES;
=======
  const isVercel = process.env.VERCEL === "1";
  const queriesToRun = isVercel ? SEARCH_QUERIES.slice(0, 4) : SEARCH_QUERIES;

>>>>>>> 5313f5a (increase querry4)

  console.log("\n🔍 Searching across Google + Bing + DuckDuckGo...\n");

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

  try {
    const { filterNew } = require("./scraped");
    return await filterNew(unique);
  } catch (e) {
    return unique;
  }
}

module.exports = { searchCompanies };
