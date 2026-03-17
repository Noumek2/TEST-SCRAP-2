/**
 * detect.js
 * For each company found by search.js:
 *  1. Checks if the company has a Facebook page (via DuckDuckGo search)
 *  2. If yes, opens the Facebook page with your saved session and collects:
 *       - Page name
 *       - Phone number
 *       - Address
 *       - Facebook URL
 */

const puppeteer = require("puppeteer");
const axios     = require("axios");
const cheerio   = require("cheerio");
const fs        = require("fs");
const path      = require("path");

const SESSION_FILE = path.join(__dirname, "fb_session.json");

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Load saved Facebook session ────────────────────────────────────────────
function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.log("\n  No fb_session.json found.");
    console.log("  Run: node setup.js  to log in to Facebook first.\n");
    process.exit(1);
  }
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  console.log("  Facebook session loaded (saved " + session.savedAt + ")");
  return session;
}

// ── Find Facebook page via DuckDuckGo ──────────────────────────────────────
async function findFacebookPage(companyName) {
  try {
    const query = companyName + " site:facebook.com";
    const res   = await axios.get(
      "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 12000,
      }
    );

    const $    = cheerio.load(res.data);
    let   found = null;

    $(".result__title a").each((_, el) => {
      let href = $(el).attr("href") || "";
      if (href.includes("uddg=")) {
        try { href = decodeURIComponent(new URL("https:" + href).searchParams.get("uddg") || ""); } catch {}
      }

      // Accept only real page URLs, not login/share/video pages
      if (
        href.includes("facebook.com") &&
        !href.includes("/login") &&
        !href.includes("/sharer") &&
        !href.includes("/video") &&
        !href.includes("/photo") &&
        !href.includes("profile.php") &&
        !found
      ) {
        // Normalize: keep only the page path
        try {
          const u = new URL(href);
          found = "https://www.facebook.com" + u.pathname.replace(/\/$/, "");
        } catch {}
      }
    });

    return found;
  } catch {
    return null;
  }
}

// ── Parse numbers like "1.2K" or "3M" into integers ───────────────────────
function parseCount(str) {
  if (!str) return null;
  const clean = str.replace(/,/g, "").trim();
  if (/k/i.test(clean)) return Math.round(parseFloat(clean) * 1_000);
  if (/m/i.test(clean)) return Math.round(parseFloat(clean) * 1_000_000);
  const n = parseInt(clean.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
}

// ── Scrape Facebook page details ───────────────────────────────────────────
async function scrapeFacebookPage(fbUrl, page) {
  const info = {
    facebookUrl:      fbUrl,
    facebookName:     null,
    facebookFollowers: null,
    facebookPhone:    null,
    facebookAddress:  null,
  };

  try {
    // Go to the main page first
    await page.goto(fbUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    await sleep(2000);

    let html = await page.content();
    let $    = cheerio.load(html);
    let text = $.text();

    // ── Page name ──────────────────────────────────────────────
    info.facebookName =
      await page.$eval("h1", (el) => el.innerText.trim()).catch(() => null) ||
      $("title").text().replace(/ [|\-–] Facebook.*/, "").replace("Facebook", "").trim() ||
      null;

    // ── Followers — scan the main page text ───────────────────
    // Facebook shows "X followers" or "X abonnés" near the top
    const followerPatterns = [
      /([0-9][0-9,\.]*\s*[KkMm]?)\s+followers/i,
      /([0-9][0-9,\.]*\s*[KkMm]?)\s+abonnés/i,
      /([0-9][0-9,\.]*\s*[KkMm]?)\s+personnes? suivent/i,
    ];
    for (const pattern of followerPatterns) {
      const m = text.match(pattern);
      if (m) { info.facebookFollowers = parseCount(m[1]); break; }
    }

    // Also check the og:description meta tag — sometimes has "X followers"
    if (!info.facebookFollowers) {
      const ogDesc = $('meta[property="og:description"]').attr("content") || "";
      for (const pattern of followerPatterns) {
        const m = ogDesc.match(pattern);
        if (m) { info.facebookFollowers = parseCount(m[1]); break; }
      }
    }

    // ── Now visit the About page for phone and address ─────────
    const aboutUrl = fbUrl.replace(/\/$/, "") + "/about";
    await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    await sleep(2000);

    html = await page.content();
    $    = cheerio.load(html);
    text = $.text();

    // ── Followers fallback from About page ────────────────────
    if (!info.facebookFollowers) {
      for (const pattern of followerPatterns) {
        const m = text.match(pattern);
        if (m) { info.facebookFollowers = parseCount(m[1]); break; }
      }
    }

    // ── Phone — Cameroon format (+237 or 6xx/2xx/3xx) ─────────
    const phoneMatch = text.match(
      /(\+237[\s\-.]?[0-9]{2}[\s\-.]?[0-9]{2}[\s\-.]?[0-9]{2}[\s\-.]?[0-9]{2}|(?:6|2|3)[0-9]{8})/
    );
    if (phoneMatch) {
      info.facebookPhone = phoneMatch[0].replace(/[\s\-.]/g, "").trim();
    }

    // ── Address — look for Cameroon city names ─────────────────
    const cities = ["Douala", "Yaoundé", "Yaounde", "Bafoussam", "Garoua", "Bamenda", "Cameroon", "Cameroun"];
    $("div, span").each((_, el) => {
      // Only look at leaf elements (no children) to avoid huge blocks
      if ($(el).children().length > 0) return;
      const t = $(el).text().trim();
      if (!info.facebookAddress && t.length > 5 && t.length < 150) {
        if (cities.some((city) => t.includes(city))) {
          info.facebookAddress = t;
        }
      }
    });

  } catch (err) {
    console.log("    Could not scrape " + fbUrl + ": " + err.message);
  }

  return info;
}

// ── Process all companies ──────────────────────────────────────────────────
async function detectAll(companies) {
  const session = loadSession();
  const results = [];

  console.log("--- STEP 2: Detecting Facebook pages ---\n");

  // Launch one browser for all companies
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();

  // Apply your Facebook session
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  for (const cookie of session.cookies || []) {
    try { await page.setCookie(cookie); } catch {}
  }

  // Block images to load faster
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["image", "font", "media"].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  console.log("  Browser ready. Processing " + companies.length + " companies...\n");

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log("  [" + (i + 1) + "/" + companies.length + "] " + company.name);

    const result = {
      companyName:       company.name,
      websiteUrl:        company.url,
      source:            company.source,
      hasFacebook:       false,
      facebookUrl:       "",
      facebookName:      "",
      facebookFollowers: "",
      facebookPhone:     "",
      facebookAddress:   "",
      scrapedAt:         new Date().toISOString().slice(0, 10),
    };

    // Step A — find Facebook page URL
    const fbUrl = await findFacebookPage(company.name);

    if (fbUrl) {
      console.log("    Facebook found: " + fbUrl);
      result.hasFacebook = true;

      // Step B — scrape the Facebook page
      const info = await scrapeFacebookPage(fbUrl, page);
      result.facebookUrl       = info.facebookUrl       || fbUrl;
      result.facebookName      = info.facebookName      || "";
      result.facebookFollowers = info.facebookFollowers != null ? info.facebookFollowers : "";
      result.facebookPhone     = info.facebookPhone     || "";
      result.facebookAddress   = info.facebookAddress   || "";

      console.log("    Name     : " + (result.facebookName      || "not found"));
      console.log("    Followers: " + (result.facebookFollowers !== "" ? result.facebookFollowers.toLocaleString() : "not found"));
      console.log("    Phone    : " + (result.facebookPhone     || "not found"));
      console.log("    Address  : " + (result.facebookAddress   || "not found"));

    } else {
      console.log("    No Facebook page found");
    }

    results.push(result);
    await sleep(2000);
  }

  await browser.close();

  const withFb = results.filter((r) => r.hasFacebook).length;
  console.log("\n  Total companies : " + results.length);
  console.log("  With Facebook   : " + withFb);
  console.log("  Without Facebook: " + (results.length - withFb) + "\n");

  return results;
}

module.exports = { detectAll };