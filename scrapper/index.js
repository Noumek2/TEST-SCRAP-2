/**
 * index.js - Main runner
 * Orchestrates search.js -> detect.js -> save.js -> report.js
 *
 * Usage:
 *   node index.js                    # Full run
 *   node index.js --facebook-only    # Only save companies with Facebook
 *   node index.js --no-open          # Don't auto-open the HTML report
 */

const { searchCompanies } = require("./search");
const { detectAll } = require("./detect");
const { saveAll, printSummary } = require("./save");
const { markScraped } = require("./scraped");
const { exec } = require("child_process");
const util = require("util");

function logStage(stage, detail = "") {
  const suffix = detail ? " - " + detail : "";
  console.log("[stage] " + stage + suffix);
}

function logErrorWithStack(context, err) {
  const message = err && err.message ? err.message : String(err);
  console.error("[error] " + context + ": " + message);
  if (err && err.stack) {
    console.error("[stack]");
    console.error(err.stack);
  }
}

function openFile(filePath) {
  const cmd =
    process.platform === "win32" ? 'start "" "' + filePath + '"' :
    process.platform === "darwin" ? 'open "' + filePath + '"' :
    'xdg-open "' + filePath + '"';

  exec(cmd, (err) => {
    if (err) console.log("  (Could not auto-open file: " + err.message + ")");
  });
}

async function runScraper(options = {}) {
  const { facebookOnly = false, noOpen = false, pagesPerQuery = 2 } = options;

  console.log("==========================================================");
  console.log("   Cameroon Construction & Real Estate Company Scraper");
  console.log("==========================================================");
  console.log("  Mode        : " + (facebookOnly ? "Facebook-only" : "All companies"));
  console.log("  Pages/query : " + pagesPerQuery);
  console.log("");

  try {
    logStage("search:start");
    console.log("STEP 1 - Searching for companies...");
    const companies = await searchCompanies({ pagesPerQuery, delayMs: 2000 });
    logStage("search:done", companies.length + " companies");

    if (companies.length === 0) {
      console.warn("No companies found. Check your internet connection or try again later.");
      return;
    }

    logStage("detect:start");
    console.log("STEP 2 - Detecting Facebook pages and extracting details...");
    const enriched = await detectAll(companies, { facebookOnly: false, delayMs: 2500 });
    logStage("detect:done", enriched.length + " enriched");

    logStage("scraped:mark");
    markScraped(enriched);

    logStage("save:start");
    console.log("STEP 3 - Saving results...");

    const { csvPath: allCsv, xmlPath: allXml, htmlPath: allHtml } = saveAll(enriched, {
      baseName: "all_companies",
      facebookOnly: false,
    });

    const { csvPath: fbCsv, xmlPath: fbXml, htmlPath: fbHtml } = saveAll(enriched, {
      baseName: "facebook_companies",
      facebookOnly: true,
    });

    logStage("save:done");

    try {
      const { supabase } = require("./supabaseClient");

      if (supabase) {
        logStage("supabase:start");
        console.log("\nSTEP 4 - Saving results to Supabase...");

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
          console.error("  Supabase insert failed: " + error.message);
          if (error.details) console.error("  Details: " + error.details);
          if (error.hint) console.error("  Hint: " + error.hint);
        } else {
          console.log("  Supabase insert succeeded!");
        }

        logStage("supabase:done");
      } else {
        console.log("\nSTEP 4 - Skipping Supabase save (not configured).");
        console.log("  (To enable, create a .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
      }
    } catch (e) {
      logErrorWithStack("supabase", e);
    }

    printSummary(enriched);

    console.log("Done! Output files:");
    console.log("  All companies  -> " + allHtml);
    console.log("  All companies  -> " + allCsv);
    console.log("  All companies  -> " + allXml);
    console.log("  Facebook only  -> " + fbHtml);
    console.log("  Facebook only  -> " + fbCsv);
    console.log("  Facebook only  -> " + fbXml);

    if (!noOpen) {
      console.log("\nOpening HTML report in your browser...");
      openFile(allHtml);
    }
  } catch (err) {
    logErrorWithStack("runScraper", err);
    throw err;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    facebookOnly: args.includes("--facebook-only"),
    noOpen: args.includes("--no-open"),
    pagesPerQuery: args.includes("--pages") ? parseInt(args[args.indexOf("--pages") + 1], 10) || 2 : 2,
  };

  runScraper(options).catch((err) => {
    logErrorWithStack("cli", err);
    process.exit(1);
  });
} else {
  module.exports = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const options = {
      facebookOnly: url.searchParams.get("facebookOnly") === "true",
      pagesPerQuery: parseInt(url.searchParams.get("pages"), 10) || 2,
      noOpen: true,
    };

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const writeToStream = (...args) => {
      const msg = util.format(...args);
      res.write(msg + "\n");
    };

    console.log = writeToStream;
    console.warn = writeToStream;
    console.error = writeToStream;

    try {
      logStage("request:start", req.url || "/");
      await runScraper(options);
      res.end("\n--- End of Log ---");
    } catch (err) {
      res.write("\nFatal Error: " + err.message + "\n");
      if (err && err.stack) {
        res.write("[stack]\n" + err.stack + "\n");
      }
      res.end();
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  };
}
