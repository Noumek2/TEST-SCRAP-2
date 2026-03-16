/**
 * scheduler.js
 * Runs the scraper automatically every day at a set time.
 * - Limits to 50 new companies per day
 * - Tracks already-scraped companies so no duplicates across days
 * - Saves a daily report + a master CSV that grows over time
 * - Logs everything to logs/scraper.log
 *
 * Run once and leave it running:
 *   node scheduler.js
 *
 * Or set a custom time and daily limit:
 *   node scheduler.js --time 08:00 --limit 50
 */

const fs   = require("fs");
const path = require("path");

const { searchCompanies } = require("./search");
const { detectAll }       = require("./detect");
const { saveAll, printSummary } = require("./save");

// ── Config from CLI args ───────────────────────────────────────────────────
const args       = process.argv.slice(2);
const timeArg    = args[args.indexOf("--time") + 1]  || "08:00"; // Default: 8 AM
const limitArg   = args[args.indexOf("--limit") + 1] || "50";
const DAILY_LIMIT = parseInt(limitArg, 10) || 50;
const RUN_TIME    = timeArg; // "HH:MM" format

// ── File paths ─────────────────────────────────────────────────────────────
const OUTPUT_DIR    = path.join(__dirname, "output");
const LOG_DIR       = path.join(__dirname, "logs");
const SEEN_FILE     = path.join(__dirname, "seen_companies.json");  // Tracks duplicates
const MASTER_CSV    = path.join(OUTPUT_DIR, "master_all_companies.csv");
const MASTER_FB_CSV = path.join(OUTPUT_DIR, "master_facebook_companies.csv");

// ── Ensure directories exist ───────────────────────────────────────────────
[OUTPUT_DIR, LOG_DIR].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Logger ─────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(LOG_DIR, "scraper.log");

function log(msg) {
  const line = "[" + new Date().toISOString() + "] " + msg;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

// ── Seen companies tracker ─────────────────────────────────────────────────
// Stores a Set of company name keys so we never scrape the same one twice

function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));
    return new Set(data);
  } catch { return new Set(); }
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2), "utf8");
}

function makeKey(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
}

// ── Master CSV append ──────────────────────────────────────────────────────
// Appends new rows to the master CSV without overwriting old data

const { toCsv } = require("./save");

function appendToMasterCsv(companies, filePath, facebookOnly) {
  const toAppend = facebookOnly ? companies.filter((c) => c.hasFacebook) : companies;
  if (toAppend.length === 0) return;

  // If file doesn't exist yet, write with header
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, toCsv(toAppend), "utf8");
    log("Created master CSV: " + path.basename(filePath) + " (" + toAppend.length + " rows)");
    return;
  }

  // File exists — append rows WITHOUT the header line
  const fullCsv   = toCsv(toAppend);
  const rows      = fullCsv.split("\n").slice(1).join("\n"); // Skip header
  fs.appendFileSync(filePath, "\n" + rows, "utf8");
  log("Appended " + toAppend.length + " rows to " + path.basename(filePath));
}

// ── Single daily run ───────────────────────────────────────────────────────
async function runDailyScrape() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  log("=== Daily scrape started (limit: " + DAILY_LIMIT + " companies) ===");

  // Load seen companies
  const seen = loadSeen();
  log("Known companies so far: " + seen.size);

  try {
    // ── STEP 1: Search ──────────────────────────────────────────
    log("Step 1: Searching for companies...");
    const allFound = await searchCompanies({ pagesPerQuery: 2, delayMs: 2000 });
    log("Search returned " + allFound.length + " results");

    // ── Filter out already-seen companies ───────────────────────
    const newCompanies = allFound.filter((c) => !seen.has(makeKey(c.name)));
    log("New (unseen) companies: " + newCompanies.length);

    if (newCompanies.length === 0) {
      log("No new companies found today. Try adding more search queries in search.js");
      return;
    }

    // ── Limit to daily cap ──────────────────────────────────────
    const toProcess = newCompanies.slice(0, DAILY_LIMIT);
    log("Processing " + toProcess.length + " companies today (capped at " + DAILY_LIMIT + ")");

    // ── STEP 2: Detect ──────────────────────────────────────────
    log("Step 2: Detecting Facebook pages and extracting info...");
    const enriched = await detectAll(toProcess, { facebookOnly: false, delayMs: 2500 });

    // ── STEP 3: Save daily report ───────────────────────────────
    log("Step 3: Saving results...");
    const dailyBase = "daily_" + today;

    saveAll(enriched, { baseName: dailyBase, facebookOnly: false });

    const fbCount = enriched.filter((c) => c.hasFacebook).length;
    log("Daily report saved: " + dailyBase + ".csv / .xml");
    log("With Facebook: " + fbCount + " / " + enriched.length);

    // ── STEP 4: Append to master files ──────────────────────────
    appendToMasterCsv(enriched, MASTER_CSV, false);
    appendToMasterCsv(enriched, MASTER_FB_CSV, true);

    // ── STEP 5: Mark companies as seen ──────────────────────────
    enriched.forEach((c) => seen.add(makeKey(c.name)));
    saveSeen(seen);
    log("Seen companies updated: " + seen.size + " total");

    // ── Print summary ───────────────────────────────────────────
    printSummary(enriched);
    log("=== Daily scrape complete ===\n");

  } catch (err) {
    log("ERROR during scrape: " + err.message);
    log(err.stack || "");
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────
// Calculates ms until next run at the configured time, then loops daily

function msUntilNextRun(timeStr) {
  const [hh, mm]  = timeStr.split(":").map(Number);
  const now       = new Date();
  const next      = new Date();
  next.setHours(hh, mm, 0, 0);

  // If that time has already passed today, schedule for tomorrow
  if (next <= now) next.setDate(next.getDate() + 1);

  return next - now;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h + "h " + m + "m " + s + "s";
}

async function startScheduler() {
  log("╔══════════════════════════════════════════════════════════╗");
  log("║         Cameroon Scraper — Daily Scheduler               ║");
  log("╚══════════════════════════════════════════════════════════╝");
  log("Run time     : " + RUN_TIME + " every day");
  log("Daily limit  : " + DAILY_LIMIT + " companies");
  log("Master CSV   : " + MASTER_CSV);
  log("Log file     : " + LOG_FILE);
  log("");

  // Option: run immediately on first start (useful for testing)
  const runNow = args.includes("--now");
  if (runNow) {
    log("--now flag detected: running immediately...");
    await runDailyScrape();
  }

  // Schedule loop
  async function scheduleNext() {
    const delay = msUntilNextRun(RUN_TIME);
    log("Next run scheduled in " + formatDuration(delay) + " (at " + RUN_TIME + ")");

    setTimeout(async () => {
      await runDailyScrape();
      scheduleNext(); // Schedule the next day's run
    }, delay);
  }

  scheduleNext();
  log("Scheduler is running. Keep this terminal open (or run with pm2/nohup).");
  log("Press Ctrl+C to stop.\n");
}

startScheduler();
