/**
 * test_search.js
 * Diagnoses why search returns 0 results.
 * Run: node test_search.js
 */

const axios     = require("axios");
const cheerio   = require("cheerio");
const puppeteer = require("puppeteer");
const fs        = require("fs");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testDuckDuckGo() {
  console.log("\n=== TEST 1: DuckDuckGo ===");
  try {
    const res = await axios.get(
      "https://html.duckduckgo.com/html/?q=construction+company+Cameroon",
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 15000,
      }
    );

    console.log("HTTP Status:", res.status);
    console.log("Response size:", res.data.length, "bytes");

    const $ = cheerio.load(res.data);
    const results = [];

    $(".result").each((_, el) => {
      const title = $(el).find(".result__title a").text().trim();
      let   href  = $(el).find(".result__title a").attr("href") || "";
      if (href.includes("uddg=")) {
        try { href = decodeURIComponent(new URL("https:" + href).searchParams.get("uddg") || ""); } catch {}
      }
      if (title) results.push({ title, href });
    });

    console.log("Results found with .result selector:", results.length);

    // Try alternative selectors if 0
    if (results.length === 0) {
      console.log("\nTrying alternative selectors...");
      const allLinks = [];
      $("a[href]").each((_, el) => {
        const t = $(el).text().trim();
        const h = $(el).attr("href") || "";
        if (t.length > 10 && h.startsWith("http") && !h.includes("duckduckgo")) {
          allLinks.push(t.slice(0, 60));
        }
      });
      console.log("Links found with generic a[href]:", allLinks.length);
      if (allLinks.length > 0) console.log("First 3:", allLinks.slice(0, 3));

      // Save HTML for inspection
      fs.writeFileSync("ddg_response.html", res.data, "utf8");
      console.log("Saved raw HTML to ddg_response.html — open it to inspect");
    } else {
      console.log("First 3 results:");
      results.slice(0, 3).forEach((r, i) => console.log("  " + (i+1) + ". " + r.title));
    }
  } catch (err) {
    console.log("ERROR:", err.message);
    if (err.response) console.log("Status:", err.response.status);
  }
}

async function testGoogle() {
  console.log("\n=== TEST 2: Google via Puppeteer ===");
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");

    await page.goto("https://www.google.com/search?q=construction+company+Cameroon&num=10", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await sleep(2000);

    const html = await page.content();
    console.log("Page size:", html.length, "bytes");

    // Check if we hit a CAPTCHA
    if (html.includes("unusual traffic") || html.includes("captcha") || html.includes("CAPTCHA")) {
      console.log("CAPTCHA detected! Google is blocking us.");
      fs.writeFileSync("google_response.html", html, "utf8");
      console.log("Saved to google_response.html");
    } else {
      const $ = cheerio.load(html);
      const h3s = $("h3");
      console.log("h3 tags found:", h3s.length);

      const links = [];
      $("h3").each((_, el) => {
        const title = $(el).text().trim();
        const href  = $(el).closest("a").attr("href") || $(el).parent("a").attr("href") || "";
        if (title && href && href.startsWith("http")) links.push(title.slice(0, 60));
      });
      console.log("Valid result links:", links.length);
      if (links.length > 0) {
        console.log("First 3:");
        links.slice(0, 3).forEach((l, i) => console.log("  " + (i+1) + ". " + l));
      } else {
        fs.writeFileSync("google_response.html", html, "utf8");
        console.log("Saved to google_response.html for inspection");
      }
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    if (browser) await browser.close();
  }
}

async function testBing() {
  console.log("\n=== TEST 3: Bing (bonus check) ===");
  try {
    const res = await axios.get(
      "https://www.bing.com/search?q=construction+company+Cameroon&count=10",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 15000,
      }
    );

    console.log("HTTP Status:", res.status);
    const $ = cheerio.load(res.data);
    const results = [];

    $("li.b_algo").each((_, el) => {
      const title = $(el).find("h2 a").first().text().trim();
      const href  = $(el).find("h2 a").first().attr("href") || "";
      if (title && href.startsWith("http")) results.push(title.slice(0, 60));
    });

    console.log("Bing results found:", results.length);
    if (results.length > 0) {
      console.log("First 3:");
      results.slice(0, 3).forEach((r, i) => console.log("  " + (i+1) + ". " + r));
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  }
}

async function run() {
  console.log("Running search diagnostics...\n");
  await testDuckDuckGo();
  await testGoogle();
  await testBing();
  console.log("\n=== Done ===");
  console.log("Share the output above so we can fix the exact issue.");
}

run();