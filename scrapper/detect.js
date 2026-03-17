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
  const launchOpts = {
    headless: "new",   // Invisible browser — runs in background
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1366,768",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
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

    const html = await page.content();
    const $    = cheerio.load(html);
    const text = $.text();

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