/**
 * index.js — Main runner
 *
 * Usage:
 *   node index.js             run the scraper
 *   node index.js --limit 30  only process 30 companies
 */

const { searchCompanies } = require("./search");
const { detectAll }       = require("./detect");
const { saveResults }     = require("./save");
const { exec }            = require("child_process");
const path                = require("path");

const args  = process.argv.slice(2);
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : null;

function openFile(filePath) {
  const cmd =
    process.platform === "win32"  ? 'start "" "' + filePath + '"' :
    process.platform === "darwin" ? 'open "' + filePath + '"'      :
                                    'xdg-open "' + filePath + '"';
  exec(cmd);
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   Cameroon Company Scraper                        ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  // Step 1 — Search
  let companies = await searchCompanies();

  if (companies.length === 0) {
    console.log("No companies found. Check your internet connection and try again.");
    process.exit(1);
  }

  // Apply limit if set
  if (limit) {
    companies = companies.slice(0, limit);
    console.log("Limiting to " + limit + " companies.\n");
  }

  // Step 2 — Detect Facebook and extract info
  const results = await detectAll(companies);

  // Step 3 — Save CSV + HTML
  console.log("--- STEP 3: Saving results ---\n");
  const { csvFile, htmlFile } = saveResults(results);

  console.log("\nAll done!");
  console.log("Opening your results in the browser...\n");
  openFile(htmlFile);
}

main().catch((err) => {
  console.error("Error: " + err.message);
  process.exit(1);
});