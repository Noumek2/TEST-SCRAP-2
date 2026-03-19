

/**
 * server.js
 * Express web server with UI for triggering the scraper
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const { searchCompanies } = require("./search");
const { detectAll } = require("./detect");
const { saveAll, saveToSupabase, printSummary } = require("./save");
const { markScraped } = require("./scraped");

const app = express();
const PORT = process.env.PORT || 3000;

let scraperRunning = false;
let scraperStatus = "idle";
let scraperProgress = "";

// Middleware
app.use(express.json());
app.use(express.static("public"));

// Serve the UI page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API: Get scraper status
app.get("/api/status", (req, res) => {
  res.json({
    running: scraperRunning,
    status: scraperStatus,
    progress: scraperProgress,
  });
});

// API: Start scraper
app.post("/api/start", async (req, res) => {
  if (scraperRunning) {
    return res.status(400).json({ error: "Scraper already running" });
  }

  scraperRunning = true;
  scraperStatus = "searching";
  scraperProgress = "Starting search phase...";
  res.json({ message: "Scraper started" });

  // Run scraper in background
  runScraper().catch((err) => {
    console.error("Scraper error:", err);
    scraperStatus = "error";
    scraperProgress = "Error: " + err.message;
  });
});

async function runScraper() {
  try {
    const pagesPerQuery = 2;

    // STEP 1: Search
    scraperStatus = "searching";
    scraperProgress = "Searching for companies...";
    console.log("STEP 1: Searching...");
    const companies = await searchCompanies({ pagesPerQuery, delayMs: 2000 });

    if (!companies || companies.length === 0) {
      scraperStatus = "error";
      scraperProgress = "No companies found";
      scraperRunning = false;
      return;
    }

    scraperProgress = `Found ${companies.length} companies. Now detecting Facebook pages...`;
    console.log("STEP 2: Detecting...");

    // STEP 2: Detect
    scraperStatus = "detecting";
    const enriched = await detectAll(companies, {
      facebookOnly: false,
    });

    scraperProgress = `Detected ${enriched.length} companies. Saving files and database...`;

    // STEP 3: Save
    scraperStatus = "saving";
    const { csvPath: allCsv, xmlPath: allXml, htmlPath: allHtml } = saveAll(enriched, {
      baseName: "all_companies",
      facebookOnly: false,
    });

    const { csvPath: fbCsv, xmlPath: fbXml, htmlPath: fbHtml } = saveAll(enriched, {
      baseName: "facebook_companies",
      facebookOnly: true,
    });

    // STEP 4: Save to database
    scraperStatus = "uploading";
    scraperProgress = "Uploading to database...";

    await saveToSupabase(enriched, "storage-scrap");
    await saveToSupabase(enriched, "storage-fb-scrap");

    // STEP 5: Mark as scraped
    await markScraped(enriched);

    // Print summary
    printSummary(enriched);

    scraperStatus = "complete";
    const facebookCount = enriched.filter((c) => c.hasFacebook).length;
    scraperProgress = `✅ Complete! Found ${enriched.length} companies (${facebookCount} with Facebook). Email sent.`;

    console.log("✅ Scraper completed successfully!");
  } catch (err) {
    console.error("Scraper error:", err);
    scraperStatus = "error";
    scraperProgress = "Error: " + (err.message || err);
  } finally {
    scraperRunning = false;
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   Scraper Web UI                       ║`);
  console.log(`║   Open: http://localhost:${PORT}${" ".repeat(String(PORT).length === 4 ? 7 : 8)}║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});
