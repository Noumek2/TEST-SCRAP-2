/**
 * index.js - Main runner
 * Orchestrates search.js -> detect.js -> save.js
 */

require("./env");

const { searchCompanies } = require("./search");
const { detectAll } = require("./detect");
const { saveAll, printSummary, saveToSupabase } = require("./save");
const { markScraped } = require("./scraped");
const { exec } = require("child_process");
const util = require("util");

let activeRunPromise = null;

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
  // Skip opening files on serverless platforms (Render, Vercel, etc.)
  const isServerless = process.env.RENDER === "true" || process.env.VERCEL === "1";
  if (isServerless) {
    console.log("  [info] Skipping file open on serverless platform. Output: " + filePath);
    return;
  }

  const cmd =
    process.platform === "win32" ? 'start "" "' + filePath + '"' :
    process.platform === "darwin" ? 'open "' + filePath + '"' :
    'xdg-open "' + filePath + '"';

  exec(cmd, (err) => {
    if (err) console.log("  (Could not auto-open file: " + err.message + ")");
  });
}

function normalizeRunOptions(options = {}) {
  return {
    facebookOnly: options.facebookOnly === true,
    noOpen: options.noOpen !== false,
    pagesPerQuery: Math.max(1, parseInt(options.pagesPerQuery, 10) || 2),
    enterpriseLimit: Math.max(1, parseInt(options.enterpriseLimit, 10) || 25),
    country: String(options.country || "Cameroon").trim() || "Cameroon",
  };
}

async function runScraper(inputOptions = {}) {
  const options = normalizeRunOptions(inputOptions);
  const { facebookOnly, noOpen, pagesPerQuery, enterpriseLimit, country } = options;

  console.log("==========================================================");
  console.log("   Company Scraper Control Center Run");
  console.log("==========================================================");
  console.log("  Country     : " + country);
  console.log("  Target count: " + enterpriseLimit);
  console.log("  Mode        : " + (facebookOnly ? "Facebook-only" : "All companies"));
  console.log("  Pages/query : " + pagesPerQuery);
  console.log("");

  try {
    logStage("search:start");
    console.log("STEP 1 - Searching for companies...");
    const companies = await searchCompanies({
      country,
      companyLimit: enterpriseLimit,
      pagesPerQuery,
      delayMs: 2000,
    });
    logStage("search:done", companies.length + " companies");

    if (companies.length === 0) {
      console.warn("No companies found. Check your internet connection or try again later.");
      return { companiesFound: 0 };
    }

    logStage("storage-scrap:start");
    await saveToSupabase(companies, "storage-scrap");
    logStage("storage-scrap:done");

    logStage("detect:start");
    console.log("STEP 2 - Detecting Facebook pages and extracting details...");
    const enriched = await detectAll(companies, {
      country,
      facebookOnly: false,
      delayMs: 2500,
    });
    logStage("detect:done", enriched.length + " enriched");

    logStage("scraped:mark");
    markScraped(enriched);

    logStage("save:start");
    console.log("STEP 3 - Saving results...");

    const allBase = `${country.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "companies"}_all_companies`;
    const fbBase = `${country.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "companies"}_facebook_companies`;
    const reportTitle = `${country} Companies`;

    const { csvPath: allCsv, xmlPath: allXml, htmlPath: allHtml } = saveAll(enriched, {
      baseName: allBase,
      facebookOnly: false,
      country,
      title: reportTitle,
    });

    const { csvPath: fbCsv, xmlPath: fbXml, htmlPath: fbHtml } = saveAll(enriched, {
      baseName: fbBase,
      facebookOnly: true,
      country,
      title: `${country} Facebook Companies`,
    });

    logStage("save:done");

    try {
      logStage("storage-fb-scrap:start");
      await saveToSupabase(enriched, "storage-fb-scrap");
      logStage("storage-fb-scrap:done");
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

    return {
      companiesFound: companies.length,
      enrichedCount: enriched.length,
      output: { allHtml, allCsv, allXml, fbHtml, fbCsv, fbXml },
    };
  } catch (err) {
    logErrorWithStack("runScraper", err);
    throw err;
  }
}

function runScraperManaged(options = {}) {
  if (activeRunPromise) {
    return activeRunPromise;
  }

  activeRunPromise = runScraper(options).finally(() => {
    activeRunPromise = null;
  });

  return activeRunPromise;
}

async function streamScraperRun(req, res, options = {}) {
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
    await runScraperManaged(options);
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
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    facebookOnly: args.includes("--facebook-only"),
    noOpen: !args.includes("--open"),
    pagesPerQuery: args.includes("--pages") ? args[args.indexOf("--pages") + 1] : 2,
    enterpriseLimit: args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 25,
    country: args.includes("--country") ? args[args.indexOf("--country") + 1] : "Cameroon",
  };

  runScraperManaged(options).catch((err) => {
    logErrorWithStack("cli", err);
    process.exit(1);
  });
}

module.exports = {
  logErrorWithStack,
  normalizeRunOptions,
  runScraper,
  runScraperManaged,
  streamScraperRun,
  getIsRunInProgress: () => !!activeRunPromise,
};
