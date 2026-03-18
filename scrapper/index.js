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
const { saveAll, printSummary } = require("./save");
const { markScraped }        = require("./scraped");
const { sendCsv }            = require("./send_csv");
const { exec }               = require("child_process");
const path                   = require("path");
const config                 = require("./config.json");

const args         = process.argv.slice(2);
const facebookOnly = args.includes("--facebook-only");
const noOpen       = args.includes("--no-open");
const pagesIndex   = args.indexOf("--pages");
const pagesPerQuery = pagesIndex !== -1 ? parseInt(args[pagesIndex + 1]) || 2 : 2;

let lastEnrichedResults = [];

function safeSavePartial(reason) {
  if (!lastEnrichedResults || lastEnrichedResults.length === 0) return;
  try {
    const suffix = reason ? "_" + reason.replace(/\s+/g, "_").toLowerCase() : "";
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const baseName = "partial_results" + suffix + "_" + ts;

    console.log(`\n⚠️  Saving partial results (${lastEnrichedResults.length} companies)${reason ? " (" + reason + ")" : ""} ...`);
    const { csvPath, htmlPath, xmlPath } = saveAll(lastEnrichedResults, { baseName });
    console.log("  Partial output saved:");
    console.log("    " + htmlPath);
    console.log("    " + csvPath);
    console.log("    " + xmlPath);
  } catch (err) {
    console.error("Failed to save partial results: " + (err.message || err));
  }
}

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

// Ensure we save what we have if the process is interrupted
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT");
  safeSavePartial("interrupted");
  process.exit(1);
});
process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM");
  safeSavePartial("terminated");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("\nUncaught exception:", err);
  safeSavePartial("uncaught_exception");
  process.exit(1);
});

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Cameroon Construction & Real Estate Company Scraper    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("  Mode        : " + (facebookOnly ? "Facebook-only" : "All companies"));
  console.log("  Pages/query : " + pagesPerQuery);
  console.log("  Note        : Existing CSV output will be overwritten on each run.");
  console.log("");

  try {
    // STEP 1 — Search
    console.log("STEP 1 — Searching for companies...");
    const companies = await searchCompanies({ pagesPerQuery, delayMs: 2000 });
    lastEnrichedResults = companies;

    if (companies.length === 0) {
      console.warn("No companies found. Check your internet connection or try again later.");
      process.exit(1);
    }

    // STEP 2 — Detect Facebook + extract contact info
    console.log("STEP 2 — Detecting Facebook pages & extracting details...");
    const enriched = await detectAll(companies, { facebookOnly: false, delayMs: 2500 });
    lastEnrichedResults = enriched;

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

    // Send email with the latest CSV (optional; requires config.emailTo + config.smtp)
    if (config && config.emailTo) {
      console.log("\nSending CSV by email to " + config.emailTo + "...");
      try {
        await sendCsv({ csvPath: allCsv, to: config.emailTo });
        console.log("Email sent successfully.");
      } catch (err) {
        console.error("Failed to send email:", err.message || err);
      }
    }

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
    safeSavePartial("fatal_error");
    process.exit(1);
  }
}

main();