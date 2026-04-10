/**
 * index.js - Main runner
 * Orchestrates search.js -> detect.js -> save.js
 */

require("./env");

const fs = require("fs");
const { searchCompanies } = require("./search");
const { detectAll } = require("./detect");
const {
  STORAGE_FB_SCRAP_TABLE,
  STORAGE_SCRAP_TABLE,
  saveAll,
  printSummary,
  saveToSupabase,
} = require("./save");
const { markScraped } = require("./scraped");
const { sendCsv } = require("./send_csv");
const { exec } = require("child_process");
let activeRunPromise = null;
const MAX_LOG_LINES = 500;
const runState = {
  status: "idle",
  startedAt: null,
  completedAt: null,
  error: null,
  logs: [],
};

function logStage(stage, detail = "") {
  const suffix = detail ? " - " + detail : "";
  console.log("[stage] " + stage + suffix);
}

function appendRunLog(message) {
  runState.logs.push(message);
  if (runState.logs.length > MAX_LOG_LINES) {
    runState.logs.splice(0, runState.logs.length - MAX_LOG_LINES);
  }
}

function setRunState(patch) {
  Object.assign(runState, patch);
}

function resetRunLogs() {
  runState.logs = [];
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
    emailTo: String(options.emailTo || process.env.EMAIL_TO || "").trim(),
  };
}

async function runScraper(inputOptions = {}) {
  const options = normalizeRunOptions(inputOptions);
  const { facebookOnly, noOpen, pagesPerQuery, enterpriseLimit, country, emailTo } = options;

  console.log("==========================================================");
  console.log("   Company Scraper Control Center Run");
  console.log("==========================================================");
  console.log("  Country     : " + country);
  console.log("  Target count: " + enterpriseLimit);
  console.log("  Mode        : " + (facebookOnly ? "Facebook-only" : "All companies"));
  console.log("  Pages/query : " + pagesPerQuery);
  console.log("  Email to    : " + (emailTo || "(not set)"));
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
    await saveToSupabase(companies, STORAGE_SCRAP_TABLE);
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

    const { csvPath: allCsv, xmlPath: allXml, htmlPath: allHtml, snapshotPath: allSnapshot } = await saveAll(enriched, {
      baseName: allBase,
      facebookOnly: false,
      country,
      title: reportTitle,
    });

    const { csvPath: fbCsv, xmlPath: fbXml, htmlPath: fbHtml, snapshotPath: fbSnapshot } = await saveAll(enriched, {
      baseName: fbBase,
      facebookOnly: true,
      country,
      title: `${country} Facebook Companies`,
    });

    logStage("save:done");

    try {
      logStage("storage-fb-scrap:start");
      await saveToSupabase(enriched, STORAGE_FB_SCRAP_TABLE);
      logStage("storage-fb-scrap:done");
    } catch (e) {
      logErrorWithStack("supabase", e);
    }

    // --- ENVOI AUTOMATIQUE DU CSV ---
    console.log("\nSTEP 4 - Envoi automatique des données par email...");
    try {
      const leadsCount = enriched.filter(c => c.hasFacebook).length;
      await sendCsv({ 
        csvPath: fbCsv,
        to: emailTo,
        subject: `Rapport Scraper : ${leadsCount} prospects Facebook trouvés` 
      });
      console.log("  ✅ Email envoyé avec succès à " + emailTo + " !");
    } catch (emailErr) {
      console.error("  ❌ Erreur lors de l'envoi automatique : " + emailErr.message);
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
      latestResults: fs.existsSync(fbSnapshot) ? JSON.parse(fs.readFileSync(fbSnapshot, "utf8")) : null,
      output: { allHtml, allCsv, allXml, allSnapshot, fbHtml, fbCsv, fbXml, fbSnapshot },
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

  resetRunLogs();
  setRunState({
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  });

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const capture = (writer) => (...args) => {
    const message = args.map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(" ");

    appendRunLog(message);
    writer(...args);
  };

  console.log = capture(originalLog);
  console.warn = capture(originalWarn);
  console.error = capture(originalError);

  activeRunPromise = runScraper(options)
    .then((result) => {
      setRunState({
        status: "completed",
        completedAt: new Date().toISOString(),
        error: null,
      });
      return result;
    })
    .catch((error) => {
      setRunState({
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error.message,
      });
      throw error;
    })
    .finally(() => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      activeRunPromise = null;
    });

  return activeRunPromise;
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
  getLatestRunState: () => ({
    ...runState,
    logs: [...runState.logs],
  }),
  logErrorWithStack,
  normalizeRunOptions,
  runScraper,
  runScraperManaged,
  getIsRunInProgress: () => !!activeRunPromise,
};
