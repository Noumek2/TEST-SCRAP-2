/**
 * detect.js
 * Uses a real Puppeteer browser with your saved Facebook session
 * to scrape company Facebook pages as a logged-in user.
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

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ── Regex patterns ─────────────────────────────────────────────────────────
const PATTERNS = {
  email:    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  phone:    /(?:\+237|00237)?[\s\-.]?(?:6|2|3)\d{1}[\s\-.]?\d{2}[\s\-.]?\d{2}[\s\-.]?\d{2}/g,
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9.\-_/?=]+/gi,
};

// ── Parse shorthand numbers e.g. "1.2K", "3M" ─────────────────────────────
function parseCount(str) {
  if (!str) return null;
  const clean = str.replace(/,/g, "").replace(/\s/g, "").trim();
  if (/k/i.test(clean)) return Math.round(parseFloat(clean) * 1_000);
  if (/m/i.test(clean)) return Math.round(parseFloat(clean) * 1_000_000);
  const n = parseInt(clean.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
}

// ── Facebook URL utilities ─────────────────────────────────────────────────
function normalizeFacebookUrl(url) {
  try {
    const u = new URL(url);
    return "https://www.facebook.com" + u.pathname.replace(/\/$/, "");
  } catch { return url; }
}

function isScrapableFacebookUrl(url) {
  if (!url || !url.includes("facebook.com")) return false;
  const blocklist = [
    "/sharer", "/share?", "/plugins/", "/tr?", "/l.php",
    "/login", "/dialog/", "/photo", "/video",
    "/events", "/groups", "/marketplace", "/watch", "/stories", "/reel",
    "profile.php",
  ];
  return !blocklist.some((b) => url.includes(b));
}

// ── Load saved Puppeteer session ───────────────────────────────────────────
function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.warn("\n  [session] No fb_session.json found.");
    console.warn("  [session] Run: node check_session.js  to set up your session first.\n");
    return null;
  }
  try {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    console.log("  [session] Session loaded (saved at " + session.savedAt + ")");
    return session;
  } catch (err) {
    console.warn("  [session] Could not read fb_session.json: " + err.message);
    return null;
  }
}

// ── Launch Puppeteer browser ───────────────────────────────────────────────
async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: "new",   // Invisible browser — runs in background
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1366,768",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  return browser;
}

// ── Apply session to a Puppeteer page ─────────────────────────────────────
async function applySession(page, session) {
  await page.setUserAgent(session.userAgent || DESKTOP_UA);

  // Hide bot signals
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // Inject saved cookies
  if (session.cookies && session.cookies.length > 0) {
    for (const cookie of session.cookies) {
      try {
        await page.setCookie(cookie);
      } catch {}
    }
    console.log("  [session] Injected " + session.cookies.length + " cookies");
  }
}

// ── Scrape a Facebook page using Puppeteer ─────────────────────────────────
async function scrapeFacebookWithPuppeteer(fbUrl, page) {
  const info = {
    facebookPageName: null, followers: null,
    category: null, facebookPhone: null,
    facebookEmail: null, facebookAddress: null,
  };

  try {
    await page.goto(fbUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000); // Let dynamic content load

    const html = await page.content();
    const $    = cheerio.load(html);
    const text = $.text();

    // ── Page name ──────────────────────────────────────────────
    info.facebookPageName =
      await page.$eval("h1", (el) => el.innerText.trim()).catch(() => null) ||
      $("title").text().replace(/ [|\-–] Facebook.*/, "").trim() || null;

    // ── Verified ───────────────────────────────────────────────
    info.isVerified =
      html.includes("VerifiedBadge") ||
      html.includes("verified_badge") ||
      await page.$('[aria-label*="erified"]').then((el) => !!el).catch(() => false);

    // ── Followers — try to find the element directly ───────────
    const followerSelectors = [
      'a[href*="followers"] span',
      'a[href*="followers"]',
      '[data-testid*="follower"]',
    ];
    for (const sel of followerSelectors) {
      if (info.followers) break;
      const txt = await page.$eval(sel, (el) => el.innerText).catch(() => null);
      if (txt) {
        const m = txt.match(/([0-9][0-9,\.]*\s*[KkMm]?)/);
        if (m) info.followers = parseCount(m[1]);
      }
    }

    // ── Followers — regex fallback on page text ────────────────
    if (!info.followers) {
      const patterns = [
        /([0-9][0-9,\.]*\s*[KkMm]?)\s+followers/gi,
        /([0-9][0-9,\.]*\s*[KkMm]?)\s+abonnés/gi,
        /"follower_count"\s*:\s*([0-9]+)/gi,
        /followerCount["'\s:]+([0-9]+)/gi,
      ];
      for (const p of patterns) {
        const matches = [...(text + html).matchAll(p)];
        if (matches.length > 0) { info.followers = parseCount(matches[0][1]); break; }
      }
    }


    // Also try visiting the About tab
    if (!info.facebookAbout) {
      try {
// ── Phone from About page ──────────────────────────────
        if (!info.facebookPhone) {
          const phones = $a.text().match(PATTERNS.phone);
          if (phones) info.facebookPhone = phones[0].replace(/[\s\-.]/g, "").trim();
        }

        // ── Email from About page ──────────────────────────────
        if (!info.facebookEmail) {
          const emails = aboutHtml.match(PATTERNS.email) || [];
          const clean = emails.filter((e) =>
            !e.includes("sentry") && !e.includes("example") && !e.includes("facebook.com")
          );
          if (clean.length > 0) info.facebookEmail = clean[0];
        }

        // ── Address from About page ────────────────────────────
        if (!info.facebookAddress) {
          const cities = ["Douala", "Yaoundé", "Yaounde", "Bafoussam", "Garoua", "Bamenda", "Cameroon", "Cameroun"];
          $a("div, span, td").each((_, el) => {
            if ($a(el).children().length > 0) return;
            const t = $a(el).text().trim();
            if (!info.facebookAddress && t.length > 5 && t.length < 200 && cities.some((c) => t.includes(c))) {
              info.facebookAddress = t;
            }
          });
        }
        // ── Rating ─────────────────────────────────────────────
        if (!info.rating) {
          const aboutText = $a.text();
          const m = aboutText.match(/([1-5]\.[0-9])\s*(?:out of 5|\/\s*5)/i);
          if (m) info.rating = parseFloat(m[1]);
          const mc = aboutText.match(/([0-9][0-9,]*)\s*(?:ratings?|reviews?|avis)/i);
          if (mc) info.ratingCount = parseCount(mc[1]);
        }

      } catch {}
    }

    // ── Phone / Email fallback from main page ──────────────────
    if (!info.facebookPhone) {
      const phones = text.match(PATTERNS.phone);
      if (phones) info.facebookPhone = phones[0].replace(/[\s\-.]/g, "").trim();
    }
    if (!info.facebookEmail) {
      const emails = html.match(PATTERNS.email) || [];
      const clean = emails.filter((e) =>
        !e.includes("sentry") && !e.includes("example") && !e.includes("facebook.com")
      );
      if (clean.length > 0) info.facebookEmail = clean[0];
    }

  } catch (err) {
    console.log("    [fb] Puppeteer error on " + fbUrl + ": " + err.message);
  }

  return info;
}

// ── Scrape company website (plain axios) ───────────────────────────────────
async function scrapeWebsite(siteUrl) {
  const result = { emails: [], phones: [], facebookUrls: [] };
  try {
    const res = await axios.get(siteUrl, {
      headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" },
      timeout: 12000, maxRedirects: 5,
    });
    const html = res.data;
    const $    = cheerio.load(html);

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("facebook.com") && isScrapableFacebookUrl(href)) {
        result.facebookUrls.push(normalizeFacebookUrl(href));
      }
    });

    const fbInHtml = html.match(PATTERNS.facebook) || [];
    fbInHtml.forEach((u) => {
      if (isScrapableFacebookUrl(u)) result.facebookUrls.push(normalizeFacebookUrl(u));
    });

    result.emails = [...new Set(
      (html.match(PATTERNS.email) || []).filter((e) =>
        !e.includes("example") && !e.includes("sentry") && !e.includes("@2x")
      )
    )];
    result.phones = [...new Set(
      ($.text().match(PATTERNS.phone) || []).map((p) => p.replace(/[\s\-.]/g, "").trim())
    )];
    result.facebookUrls = [...new Set(result.facebookUrls)];
  } catch (err) {
    console.log("    [website] " + siteUrl + " -> " + err.message);
  }
  return result;
}

// ── Detect single company ──────────────────────────────────────────────────
async function detectCompany(company, page, delayMs) {
  delayMs = delayMs || 2500;

  const enriched = {
    name: company.name,
    websiteUrl: company.url,
    snippet: company.snippet || "",
    source: company.source || "search",
    emails: [], phones: [],
    hasFacebook: false, 
    facebookUrl: null,
    facebookPageName: null, 
    followers: null,
    facebookPhone: null,
    facebookEmail: null,
    facebookAddress: null,
    scrapedAt: new Date().toISOString(),
  };

  console.log("  Detecting: " + company.name);

  // Step 1 — Scrape company website
  if (company.url && company.url.startsWith("http")) {
    const siteData = await scrapeWebsite(company.url);
    enriched.emails = siteData.emails;
    enriched.phones = siteData.phones;
    if (siteData.facebookUrls.length > 0) {
      enriched.facebookUrl = siteData.facebookUrls[0];
      enriched.hasFacebook = true;
      console.log("    Facebook found on website: " + enriched.facebookUrl);
    }
  }

  // Step 2 — DuckDuckGo fallback
  if (!enriched.hasFacebook) {
    await sleep(1000);
    const fbFromDdg = await ddgFacebookSearch(company.name);
    if (fbFromDdg) {
      enriched.facebookUrl = fbFromDdg;
      enriched.hasFacebook = true;
      console.log("    Facebook found via DuckDuckGo: " + enriched.facebookUrl);
    } else {
      console.log("    No Facebook page found");
    }
  }

  // Step 3 — Scrape Facebook page with Puppeteer
  if (enriched.hasFacebook && enriched.facebookUrl && isScrapableFacebookUrl(enriched.facebookUrl)) {
    console.log("    Scraping Facebook page...");
    const fbInfo = await scrapeFacebookWithPuppeteer(enriched.facebookUrl, page);
    Object.assign(enriched, fbInfo);

    const found = [];
    if (fbInfo.followers)        found.push("followers: " + fbInfo.followers.toLocaleString());
    if (fbInfo.facebookPageName) found.push("name: " + fbInfo.facebookPageName);
    console.log("    " + (found.length > 0 ? found.join(" | ") : "Limited public data"));
  }

  await sleep(delayMs);
  return enriched;
}

// ── Detect all ─────────────────────────────────────────────────────────────
async function detectAll(companies, options) {
  options = options || {};
  const facebookOnly = options.facebookOnly || false;
  const delayMs      = options.delayMs || 2500;
  const results      = [];

  // Load session
  const session = loadSession();
  if (!session) {
    console.error("No session found. Run: node check_session.js");
    process.exit(1);
  }

  // Launch one browser for all companies
  console.log("\n  Launching browser...");
  const browser = await launchBrowser();
  const page    = await browser.newPage();
  await applySession(page, session);

  // Block images/fonts to speed up loading
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (["image", "font", "media"].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  console.log("  Browser ready.");
  console.log("  Starting detection on " + companies.length + " companies...\n");

  try {
    for (let i = 0; i < companies.length; i++) {
      console.log("[" + (i + 1) + "/" + companies.length + "]");
      const enriched = await detectCompany(companies[i], page, delayMs);
      if (!facebookOnly || enriched.hasFacebook) results.push(enriched);
    }
  } finally {
    await browser.close();
    console.log("  Browser closed.");
  }

  const withFb = results.filter((r) => r.hasFacebook).length;
  console.log("\nDetection complete.");
  console.log("  Total    : " + results.length);
  console.log("  Facebook : " + withFb);
  console.log("  No FB    : " + (results.length - withFb) + "\n");

  return results;
}

module.exports = { detectAll, detectCompany };