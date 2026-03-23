/**
 * detect.js
 * Uses a real Puppeteer browser with your saved Facebook session
 * to scrape company Facebook pages as a logged-in user.
 */

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Detect if running in a serverless environment (Render, Vercel, or other)
const isServerless = process.env.RENDER === "true" || process.env.VERCEL === "1";

console.log("[env] VERCEL =", process.env.VERCEL);
console.log("[env] VERCEL_URL =", process.env.VERCEL_URL);
console.log("[env] isVercel =", isVercel);
console.log("[env] chromium loaded =", !!chromium);


let puppeteer;
try {
  puppeteer = require(isServerless ? "puppeteer-core" : "puppeteer");
} catch {
  puppeteer = require("puppeteer");
}

let chromium = null;
if (isServerless) {
  try {
    chromium = require("@sparticuz/chromium");
  } catch {
    chromium = null;
  }
}

const SESSION_FILE = path.join(__dirname, "fb_session.json");

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const PATTERNS = {
  email: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  phone: /(?:\+237|00237)?[\s\-.]?(?:6|2|3)\d{1}[\s\-.]?\d{2}[\s\-.]?\d{2}[\s\-.]?\d{2}/g,
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9.\-_/?=]+/gi,
};

function parseCount(str) {
  if (!str) return null;
  const clean = str.replace(/,/g, "").replace(/\s/g, "").trim();
  if (/k/i.test(clean)) return Math.round(parseFloat(clean) * 1_000);
  if (/m/i.test(clean)) return Math.round(parseFloat(clean) * 1_000_000);
  const n = parseInt(clean.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
}

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
  return extractYearFromString(html);
}

function normalizeFacebookUrl(url) {
  try {
    const u = new URL(url);
    return "https://www.facebook.com" + u.pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
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

const { getChromeExecutablePath } = require("./chrome-path");

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

async function launchBrowser() {
  const executablePath = isServerless
    ? await getServerlessChromePath()
    : getChromeExecutablePath();

  const userDataDir = path.join(__dirname, "puppeteer_profile");
  if (!isServerless && !fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const sharedArgs = [
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
    "--disable-dev-shm-usage",
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
  ];

  const launchOpts = {
    headless: isServerless ? true : "new",
    args: isServerless && chromium ? [...chromium.args, ...sharedArgs] : sharedArgs,
    ignoreDefaultArgs: ["--enable-automation"],
    ignoreHTTPSErrors: true,
    timeout: 60000,
  };

  if (!isServerless) {
    launchOpts.userDataDir = userDataDir;
  }

  if (executablePath) {
    launchOpts.executablePath = executablePath;
  }

  if (isServerless && chromium) {
    launchOpts.defaultViewport = chromium.defaultViewport;
  }

  try {
    const browser = await puppeteer.launch(launchOpts);
    return browser;
  } catch (err) {
    console.error("Failed to launch browser: " + err.message);
    if (isServerless) {
      console.error("  - Install puppeteer-core and @sparticuz/chromium for serverless Chrome");
      console.error("  - Redeploy after adding the new dependencies");
    } else {
      console.error("  - Run: npm run puppeteer-install");
      console.error("  - Or set PUPPETEER_EXECUTABLE_PATH / CHROME_PATH to a valid chrome.exe");
      console.error("  - If you get EBUSY errors, try: taskkill /F /IM chrome.exe /T");
    }
    throw new Error("Failed to launch browser: " + err.message);
  }
}

async function applySession(page, session) {
  await page.setUserAgent(session.userAgent || DESKTOP_UA);

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  if (session.cookies && session.cookies.length > 0) {
    for (const cookie of session.cookies) {
      try {
        await page.setCookie(cookie);
      } catch {}
    }
    console.log("  [session] Injected " + session.cookies.length + " cookies");
  }
}

async function scrapeFacebookWithPuppeteer(fbUrl, page) {
  const info = {
    facebookPageName: null, followers: null, likes: null,
    category: null, facebookAbout: null, facebookPhone: null,
    facebookEmail: null, facebookAddress: null, facebookWebsite: null,
    rating: null, ratingCount: null, isVerified: false,
  };

  try {
    await page.goto(fbUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);

    const html = await page.content();
    const $ = cheerio.load(html);
    const text = $.text();

    const pageYear = findLatestPostYear(html);
    if (pageYear) info.lastPostYear = pageYear;

    info.facebookPageName =
      await page.$eval("h1", (el) => el.innerText.trim()).catch(() => null) ||
      $("title").text().replace(/ [|\-–] Facebook.*/, "").trim() || null;

    info.isVerified =
      html.includes("VerifiedBadge") ||
      html.includes("verified_badge") ||
      await page.$('[aria-label*="erified"]').then((el) => !!el).catch(() => false);

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

    if (!info.followers) {
      const patterns = [
        /([0-9][0-9,\.]*\s*[KkMm]?)\s+followers/gi,
        /([0-9][0-9,\.]*\s*[KkMm]?)\s+abonnés/gi,
        /"follower_count"\s*:\s*([0-9]+)/gi,
        /followerCount["'\s:]+([0-9]+)/gi,
      ];
      for (const p of patterns) {
        const matches = [...(text + html).matchAll(p)];
        if (matches.length > 0) {
          info.followers = parseCount(matches[0][1]);
          break;
        }
      }
    }

    if (!info.likes) {
      const patterns = [
        /([0-9][0-9,\.]*\s*[KkMm]?)\s+(?:people\s+)?likes?\s+this/gi,
        /([0-9][0-9,\.]*\s*[KkMm]?)\s+j['’]aime/gi,
        /"like_count"\s*:\s*([0-9]+)/gi,
      ];
      for (const p of patterns) {
        const matches = [...(text + html).matchAll(p)];
        if (matches.length > 0) {
          info.likes = parseCount(matches[0][1]);
          break;
        }
      }
    }

    if (!info.category) {
      $("a, span, div").filter((_, el) => {
        const t = $(el).text().trim();
        return t.length > 3 && t.length < 80 &&
          /company|enterprise|real estate|construction|immobilier|bâtiment|promoteur|agence/i.test(t);
      }).each((_, el) => {
        if (!info.category) info.category = $(el).text().trim();
      });
    }

    if (!info.facebookAbout) {
      const ogDesc = $('meta[property="og:description"]').attr("content") || "";
      if (ogDesc.length > 10) info.facebookAbout = ogDesc.slice(0, 300);
    }

    if (!info.facebookAbout) {
      try {
        const aboutUrl = fbUrl.replace(/\/$/, "") + "/about";
        await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await sleep(1500);
        const aboutHtml = await page.content();
        const $a = cheerio.load(aboutHtml);

        $a("div, p, span").filter((_, el) => {
          const t = $a(el).children().length === 0 ? $a(el).text().trim() : "";
          return t.length > 30 && t.length < 500;
        }).each((_, el) => {
          if (!info.facebookAbout) info.facebookAbout = $a(el).text().trim().slice(0, 300);
        });

        if (!info.facebookPhone) {
          const phones = $a.text().match(PATTERNS.phone);
          if (phones) info.facebookPhone = phones[0].replace(/[\s\-.]/g, "").trim();
        }

        if (!info.facebookEmail) {
          const emails = aboutHtml.match(PATTERNS.email) || [];
          const clean = emails.filter((e) =>
            !e.includes("sentry") && !e.includes("example") && !e.includes("facebook.com")
          );
          if (clean.length > 0) info.facebookEmail = clean[0];
        }

        if (!info.facebookAddress) {
          const cities = ["Douala", "Yaounde", "Yaoundé", "Bafoussam", "Garoua", "Bamenda", "Cameroon", "Cameroun"];
          $a("div, span, td").each((_, el) => {
            if ($a(el).children().length > 0) return;
            const t = $a(el).text().trim();
            if (!info.facebookAddress && t.length > 5 && t.length < 200 && cities.some((c) => t.includes(c))) {
              info.facebookAddress = t;
            }
          });
        }

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

        const aboutYear = findLatestPostYear(aboutHtml);
        if (aboutYear) {
          info.lastPostYear = Math.max(info.lastPostYear || 0, aboutYear);
        }

        if (!info.rating) {
          const aboutText = $a.text();
          const m = aboutText.match(/([1-5]\.[0-9])\s*(?:out of 5|\/\s*5)/i);
          if (m) info.rating = parseFloat(m[1]);
          const mc = aboutText.match(/([0-9][0-9,]*)\s*(?:ratings?|reviews?|avis)/i);
          if (mc) info.ratingCount = parseCount(mc[1]);
        }
      } catch {}
    }

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

async function scrapeWebsite(siteUrl) {
  const result = { emails: [], phones: [], facebookUrls: [] };
  try {
    const res = await axios.get(siteUrl, {
      headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" },
      timeout: 12000, maxRedirects: 5,
    });
    const html = res.data;
    const $ = cheerio.load(html);

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
        try {
          href = decodeURIComponent(new URL("https:" + href).searchParams.get("uddg") || "");
        } catch {}
      }
      if (href.includes("facebook.com") && isScrapableFacebookUrl(href) && !found) {
        found = normalizeFacebookUrl(href);
      }
    });
    return found;
  } catch (err) {
    console.log('    [ddg] Search failed for "' + companyName + '": ' + err.message);
    return null;
  }
}

async function detectCompany(company, page, delayMs) {
  delayMs = delayMs || 2500;

  const enriched = {
    name: company.name,
    websiteUrl: company.url,
    snippet: company.snippet || "",
    source: company.source || "search",
    emails: [],
    phones: [],
    hasFacebook: false,
    facebookUrl: null,
    facebookPageName: null,
    followers: null,
    category: null,
    facebookPhone: null,
    facebookEmail: null,
    facebookAddress: null,
    facebookWebsite: null,
    scrapedAt: new Date().toISOString(),
  };

  console.log("  Detecting: " + company.name);

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

  if (enriched.hasFacebook && enriched.facebookUrl && isScrapableFacebookUrl(enriched.facebookUrl)) {
    console.log("    Scraping Facebook page...");
    const fbInfo = await scrapeFacebookWithPuppeteer(enriched.facebookUrl, page);
    Object.assign(enriched, fbInfo);

    const found = [];
    if (fbInfo.followers) found.push("followers: " + fbInfo.followers.toLocaleString());
    if (fbInfo.likes) found.push("likes: " + fbInfo.likes.toLocaleString());
    if (fbInfo.category) found.push("cat: " + fbInfo.category);
    if (fbInfo.facebookPageName) found.push("name: " + fbInfo.facebookPageName);
    console.log("    " + (found.length > 0 ? found.join(" | ") : "Limited public data"));
  }

  await sleep(delayMs);
  return enriched;
}

async function detectAll(companies, options) {
  options = options || {};
  const facebookOnly = options.facebookOnly || false;
  const delayMs = options.delayMs || 2500;
  const results = [];

  const session = loadSession();
  if (!session) {
    throw new Error("No session found. Run: node check_session.js");
  }

  console.log("\n  Launching browser...");
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await applySession(page, session);

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
    if (browser) {
      try {
        await new Promise((r) => setTimeout(r, 250));
        await browser.close();
        console.log("  Browser closed.");
      } catch (closeError) {
        console.error("  Error closing browser: " + closeError.message);
        try {
          browser.disconnect();
          console.log("  Browser disconnected after close failure.");
        } catch (disconnectError) {
          console.error("  Error disconnecting browser: " + disconnectError.message);
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
