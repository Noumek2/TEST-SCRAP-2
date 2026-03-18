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

// ── Extract the most recent year found in a string (e.g. from post timestamps)
function extractYearFromString(str) {
  if (!str || typeof str !== "string") return null;
  const matches = [...str.matchAll(/\b(20\d{2})\b/g)];
  const years = matches
    .map((m) => parseInt(m[1], 10))
    .filter((y) => !isNaN(y) && y >= 2020);
  if (years.length === 0) return null;
  return Math.max(...years);
}

function findLatestPostYear(html) {
  if (!html) return null;
  // Heuristic: look for years in the HTML (prefer newer values)
  const yearFromHtml = extractYearFromString(html);
  return yearFromHtml;
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
const { getChromeExecutablePath } = require("./chrome-path");

async function launchBrowser() {
  const executablePath = getChromeExecutablePath();

  // Use a stable userDataDir (not a tmp folder) to avoid Puppeteer trying to delete locked files
  // like first_party_sets.db when the process ends.
  const userDataDir = path.join(__dirname, "puppeteer_profile");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const launchOpts = {
    headless: "new",   // Invisible browser — runs in background
    userDataDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1366,768",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=TranslateUI",
      "--disable-ipc-flooding-protection",
      "--disable-dev-shm-usage",  // Prevent crashes on low-memory systems
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-component-extensions-with-background-pages",
      "--disable-default-apps",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-crash-upload",
      "--disable-logging",
      "--disable-login-animations",
      "--disable-notifications",
      "--disable-permissions-api",
      "--disable-session-crashed-bubble",
      "--disable-infobars",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    ignoreHTTPSErrors: true,
    timeout: 60000,  // 60 second timeout
  };

  if (executablePath) {
    launchOpts.executablePath = executablePath;
  }

  try {
    const browser = await puppeteer.launch(launchOpts);
    return browser;
  } catch (err) {
    console.error("Failed to launch browser: " + err.message);
    console.error("  - Run: npm run puppeteer-install");
    console.error("  - Or set PUPPETEER_EXECUTABLE_PATH / CHROME_PATH to a valid chrome.exe");
    console.error("  - If you get EBUSY errors, try: taskkill /F /IM chrome.exe /T");
    process.exit(1);
  }
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
    facebookPageName: null, followers: null, likes: null,
    category: null, facebookAbout: null, facebookPhone: null,
    facebookEmail: null, facebookAddress: null, facebookWebsite: null,
    rating: null, ratingCount: null, isVerified: false,
  };

  try {
    await page.goto(fbUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000); // Let dynamic content load

    const html = await page.content();
    const $    = cheerio.load(html);
    const text = $.text();

    // Determine most recent year found in the page (used to filter stale pages)
    const pageYear = findLatestPostYear(html);
    if (pageYear) info.lastPostYear = pageYear;

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

    // ── Likes ──────────────────────────────────────────────────
    if (!info.likes) {
      const patterns = [
        /([0-9][0-9,\.]*\s*[KkMm]?)\s+(?:people\s+)?likes?\s+this/gi,
        /([0-9][0-9,\.]*\s*[KkMm]?)\s+j['']aime/gi,
        /"like_count"\s*:\s*([0-9]+)/gi,
      ];
      for (const p of patterns) {
        const matches = [...(text + html).matchAll(p)];
        if (matches.length > 0) { info.likes = parseCount(matches[0][1]); break; }
      }
    }

    // ── Category ───────────────────────────────────────────────
    if (!info.category) {
      $("a, span, div").filter((_, el) => {
        const t = $(el).text().trim();
        return t.length > 3 && t.length < 80 &&
          /company|enterprise|real estate|construction|immobilier|bâtiment|promoteur|agence/i.test(t);
      }).each((_, el) => {
        if (!info.category) info.category = $(el).text().trim();
      });
    }

    // ── About ──────────────────────────────────────────────────
    if (!info.facebookAbout) {
      const ogDesc = $('meta[property="og:description"]').attr("content") || "";
      if (ogDesc.length > 10) info.facebookAbout = ogDesc.slice(0, 300);
    }

    // Also try visiting the About tab
    if (!info.facebookAbout) {
      try {
        const aboutUrl = fbUrl.replace(/\/$/, "") + "/about";
        await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await sleep(1500);
        const aboutHtml = await page.content();
        const $a = cheerio.load(aboutHtml);

        // Get all visible text sections that look like "about" content
        $a("div, p, span").filter((_, el) => {
          const t = $a(el).children().length === 0 ? $a(el).text().trim() : "";
          return t.length > 30 && t.length < 500;
        }).each((_, el) => {
          if (!info.facebookAbout) info.facebookAbout = $a(el).text().trim().slice(0, 300);
        });

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

        // ── Website from About page ────────────────────────────
        if (!info.facebookWebsite) {
          $a("a[href]").each((_, el) => {
            const href = $a(el).attr("href") || "";
            if (href.includes("l.php?u=")) {
              try {
                const ext = decodeURIComponent(new URL(href).searchParams.get("u") || "");
                if (ext && ext.startsWith("http") && !ext.includes("facebook.com")) {
                  if (!info.facebookWebsite) info.facebookWebsite = ext;
                }
              } catch {}
            }
          });
        }

        // Keep the latest year we can find (posts, timestamps)
        const aboutYear = findLatestPostYear(aboutHtml);
        if (aboutYear) {
          info.lastPostYear = Math.max(info.lastPostYear || 0, aboutYear);
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

// ── DuckDuckGo Facebook search ─────────────────────────────────────────────
async function ddgFacebookSearch(companyName) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent('"' + companyName + '" site:facebook.com');
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" },
      timeout: 12000,
    });
    const $ = cheerio.load(res.data);
    let found = null;
    $(".result__title a, a.result__a").each((_, el) => {
      let href = $(el).attr("href") || "";
      if (href.includes("uddg=")) {
        try { href = decodeURIComponent(new URL("https:" + href).searchParams.get("uddg") || ""); } catch {}
      }
      if (href.includes("facebook.com") && isScrapableFacebookUrl(href) && !found) {
        found = normalizeFacebookUrl(href);
      }
    });
    return found;
  } catch (err) {
    console.log("    [ddg] Search failed for \"" + companyName + "\": " + err.message);
    return null;
  }
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
    hasFacebook: false, facebookUrl: null,
    facebookPageName: null, followers: null,
    category: null, facebookPhone: null,
    facebookEmail: null, facebookAddress: null, facebookWebsite: null,
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
    if (fbInfo.likes)            found.push("likes: " + fbInfo.likes.toLocaleString());
    if (fbInfo.category)         found.push("cat: " + fbInfo.category);
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
      try {
        const enriched = await detectCompany(companies[i], page, delayMs);
        if (!facebookOnly || enriched.hasFacebook) results.push(enriched);
      } catch (error) {
        console.error("  ❌ Error processing company '" + companies[i].name + "': " + error.message);
        // Add the company with minimal info if detection fails
        const failedCompany = { ...companies[i], hasFacebook: false, error: error.message };
        if (!facebookOnly) results.push(failedCompany);
      }
    }
  } finally {
    if (browser) {
      try {
        // Give Puppeteer a moment to finish any pending work.
        await new Promise((r) => setTimeout(r, 250));
        await browser.close();
        console.log("  Browser closed.");
      } catch (closeError) {
        console.error("  ❌ Error closing browser: " + closeError.message);
        try {
          browser.disconnect();
          console.log("  Browser disconnected after close failure.");
        } catch (disconnectError) {
          console.error("  ❌ Error disconnecting browser: " + disconnectError.message);
        }
      }
    }
  }

  const withFb = results.filter((r) => r.hasFacebook).length;
  console.log("\nDetection complete.");
  console.log("  Total    : " + results.length);
  console.log("  Facebook : " + withFb);
  console.log("  No FB    : " + (results.length - withFb) + "\n");

  return results;
}

module.exports = { detectAll, detectCompany };