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
const { exec }               = require("child_process");
const path                   = require("path");
const util                   = require("util");

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

async function runScraper(options = {}) {
  const { facebookOnly = false, noOpen = false, pagesPerQuery = 2 } = options;

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

    if (companies.length === 2) {
      console.warn("No companies found. Check your internet connection or try again later.");
      return; // Stop execution
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

    // STEP 4 — Optional: upload results to Supabase
    try {
      // Ensure environment variables are loaded if not already
      const { supabase } = require("./supabaseClient");

      if (supabase) {
        console.log("\nSTEP 4 — Saving results to Supabase...");

        const tableName = process.env.SUPABASE_TABLE || "storage-scrap";
        const columnName = process.env.SUPABASE_COLUMN || "json_files";

        const payload = {
          scrapedAt: new Date().toISOString(),
          total: enriched.length,
          withFacebook: enriched.filter((c) => c.hasFacebook).length,
          companies: enriched,
        };

        const { error } = await supabase
          .from(tableName)
          .insert([{ [columnName]: payload }]);

        if (error) {
          console.error("  ❌ Supabase insert failed:", error.message);
          if (error.details) console.error("     Details:", error.details);
          if (error.hint) console.error("     Hint:", error.hint);
        } else {
          console.log("  ✅ Supabase insert succeeded!");
        }
      } else {
        console.log("\nSTEP 4 — Skipping Supabase save (not configured).");
        console.log("  (To enable, create a .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
      }
    } catch (e) {
      console.error("\n❌ An error occurred during the Supabase operation:", e.message);
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
    throw err; // Re-throw to be handled by caller
  }
}

// --- Execution Logic ---

if (require.main === module) {
  // Run as CLI script
  const args = process.argv.slice(2);
  const options = {
    facebookOnly: args.includes("--facebook-only"),
    noOpen: args.includes("--no-open"),
    pagesPerQuery: args.includes("--pages") ? parseInt(args[args.indexOf("--pages") + 1]) || 2 : 2
  };

  runScraper(options).catch((err) => {
    console.error("\nFatal error: " + err.message);
    process.exit(1);
  });
} else {
  // Run as Web/Serverless handler (e.g. Vercel)
  module.exports = async (req, res) => {
    // Parse query params if provided (e.g. ?pages=3&facebookOnly=true)
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const options = {
      facebookOnly: url.searchParams.get('facebookOnly') === 'true',
      pagesPerQuery: parseInt(url.searchParams.get('pages')) || 2,
      noOpen: true // Disable auto-open on server
    };

    // Set headers for streaming text response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Intercept console.log to write to response stream
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const writeToStream = (...args) => {
      const msg = util.format(...args);
      res.write(msg + '\n');
    };

    console.log = writeToStream;
    console.warn = writeToStream;
    console.error = writeToStream;

    try {
      await runScraper(options);
      res.end('\n--- End of Log ---');
    } catch (err) {
      res.write(`\nFatal Error: ${err.message}\n`);
      res.end();
    } finally {
      // Restore console
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  };
}