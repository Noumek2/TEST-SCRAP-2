/**
 * index.js — Main runner
 * Orchestrates search.js -> detect.js -> save.js -> report.js
 *
 * Usage:
 *   node index.js                    # Full run
 *   node index.js --facebook-only    # Only save companies with Facebook
 *   node index.js --no-open          # Don't auto-open the HTML report
 */

const { searchCompanies }    = require("./search");
const { detectAll }          = require("./detect");
const { saveAll, printSummary, saveToSupabase } = require("./save");
const { markScraped }        = require("./scraped");
const { exec }               = require("child_process");
const path                   = require("path");

const args         = process.argv.slice(2);
const facebookOnly = args.includes("--facebook-only");
const noOpen       = args.includes("--no-open");
const pagesIndex   = args.indexOf("--pages");
const pagesPerQuery = pagesIndex !== -1 ? parseInt(args[pagesIndex + 1]) || 2 : 2;

// Opens a file in the default browser / app depending on OS
function openFile(filePath) {
  const cmd =
    process.platform === "win32"  ? 'start "" "' + filePath + '"' :
    process.platform === "darwin" ? 'open "' + filePath + '"' :
                                    'xdg-open "' + filePath + '"';
  exec(cmd, (err) => {
    if (err) console.log("  (Could not auto-open file: " + err.message + ")");
  });
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Cameroon Construction & Real Estate Company Scraper    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("  Mode        : " + (facebookOnly ? "Facebook-only" : "All companies"));
  console.log("  Pages/query : " + pagesPerQuery);
  console.log("");

  try {
    // STEP 1 — Search
    console.log("STEP 1 — Searching for companies...");
    const companies = await searchCompanies({ pagesPerQuery, delayMs: 2000 });

    if (companies.length === 0) {
      console.warn("No companies found. Check your internet connection or try again later.");
      process.exit(1);
    }

    // STEP 2 — Detect Facebook + extract contact info
    console.log("STEP 2 — Detecting Facebook pages & extracting details...");
    const enriched = await detectAll(companies, { facebookOnly: false, delayMs: 2500 });

    // Track processed companies so we don't re-scrape them on next run
    markScraped(enriched);

    // STEP 3 — Save CSV + XML + HTML
    console.log("STEP 3 — Saving results...");

    const { csvPath: allCsv, xmlPath: allXml, htmlPath: allHtml } = saveAll(enriched, {
      baseName: "all_companies",
      facebookOnly: false,
    });

    const { csvPath: fbCsv, xmlPath: fbXml, htmlPath: fbHtml } = saveAll(enriched, {
      baseName: "facebook_companies",
      facebookOnly: true,
    });

    // Save to Supabase (if configured) - both tables
    await saveToSupabase(enriched, "storage-scrap");        // All companies
    await saveToSupabase(enriched, "storage-fb-scrap");     // Facebook companies only

    // Print summary table to console
    printSummary(enriched);

    console.log("Done! Output files:");
    console.log("  All companies  -> " + allHtml);
    console.log("  All companies  -> " + allCsv);
    console.log("  All companies  -> " + allXml);
    console.log("  Facebook only  -> " + fbHtml);
    console.log("  Facebook only  -> " + fbCsv);
    console.log("  Facebook only  -> " + fbXml);

    // Auto-open the HTML report in browser
    if (!noOpen) {
      console.log("\nOpening HTML report in your browser...");
      openFile(allHtml);
    }

  } catch (err) {
    console.error("\nFatal error: " + err.message);
    process.exit(1);
  }
}

main();