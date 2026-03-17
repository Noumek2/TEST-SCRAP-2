/**
 * scraped.js
 * Tracks which companies have already been processed to skip them in future runs.
 *
 * - `dome/scraped_facebook.json` holds companies with a Facebook page.
 * - `dome/scraped_no_facebook.json` holds companies without a Facebook page.
 */

const fs = require("fs");
const path = require("path");

const DOME_DIR = path.join(__dirname, "dome");
const SCRAPED_FILE = path.join(DOME_DIR, "scraped.json");
const SCRAPED_FB_FILE = path.join(DOME_DIR, "scraped_facebook.json");
const SCRAPED_NOFB_FILE = path.join(DOME_DIR, "scraped_no_facebook.json");

function ensureDomeDir() {
  if (!fs.existsSync(DOME_DIR)) fs.mkdirSync(DOME_DIR, { recursive: true });
}

function makeScrapedKey(company) {
  // Normalize on name + URL (if available) to avoid re-processing the same company
  const name = (company.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  const url = (company.url || company.websiteUrl || "").toLowerCase().trim();
  return (name ? name : "") + "|" + (url ? url : "");
}

function loadJson(filePath) {
  ensureDomeDir();
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveJson(filePath, data) {
  ensureDomeDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function loadScrapedKeys() {
  const fb = loadJson(SCRAPED_FB_FILE).map(makeScrapedKey);
  const nofb = loadJson(SCRAPED_NOFB_FILE).map(makeScrapedKey);
  return new Set([...fb, ...nofb]);
}

function saveCombinedScraped(fbList, noFbList) {
  const combined = [];
  const seen = new Set();

  const pushUnique = (entry, hasFacebook) => {
    const key = makeScrapedKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    combined.push({ name: entry.name, url: entry.url, hasFacebook });
  };

  fbList.forEach((e) => pushUnique(e, true));
  noFbList.forEach((e) => pushUnique(e, false));

  saveJson(SCRAPED_FILE, combined);
}

function filterNew(companies) {
  const seen = loadScrapedKeys();
  return companies.filter((c) => !seen.has(makeScrapedKey(c)));
}

function markScraped(companies) {
  const fbList = loadJson(SCRAPED_FB_FILE);
  const noFbList = loadJson(SCRAPED_NOFB_FILE);

  const fbKeys = new Set(fbList.map(makeScrapedKey));
  const noFbKeys = new Set(noFbList.map(makeScrapedKey));

  companies.forEach((c) => {
    const entry = { name: c.name || "", url: c.url || c.websiteUrl || "" };
    const key = makeScrapedKey(entry);

    if (c.hasFacebook) {
      if (!fbKeys.has(key)) {
        fbList.push(entry);
        fbKeys.add(key);
      }
    } else {
      if (!noFbKeys.has(key)) {
        noFbList.push(entry);
        noFbKeys.add(key);
      }
    }
  });

  saveJson(SCRAPED_FB_FILE, fbList);
  saveJson(SCRAPED_NOFB_FILE, noFbList);
  saveCombinedScraped(fbList, noFbList);
}

module.exports = { filterNew, markScraped, makeScrapedKey };
