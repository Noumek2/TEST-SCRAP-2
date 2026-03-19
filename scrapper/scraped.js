/**
 * scraped.js
 * Tracks which companies have already been processed.
 *
 * Local runs keep using dome/*.json files.
 * Vercel runs use Supabase tables instead of the read-only filesystem.
 */

const fs = require("fs");
const path = require("path");
const { supabase } = require("./supabaseClient");

const isVercel = process.env.VERCEL === "1";
const DOME_DIR = path.join(__dirname, "dome");
const SCRAPED_FILE = path.join(DOME_DIR, "scraped.json");
const SCRAPED_FB_FILE = path.join(DOME_DIR, "scraped_facebook.json");
const SCRAPED_NOFB_FILE = path.join(DOME_DIR, "scraped_no_facebook.json");

function ensureDomeDir() {
  if (!fs.existsSync(DOME_DIR)) fs.mkdirSync(DOME_DIR, { recursive: true });
}

function makeScrapedKey(company) {
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

async function loadSupabaseCompanies(tableName) {
  if (!supabase) return [];

  const columnName = process.env.SUPABASE_COLUMN || "json_files";
  const { data, error } = await supabase
    .from(tableName)
    .select(columnName)
    .limit(200);

  if (error) {
    console.warn(`[scraped] Could not load ${tableName}: ${error.message}`);
    return [];
  }

  return (data || []).flatMap((row) => {
    const payload = row[columnName];
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.companies)) return payload.companies;
    return [];
  });
}

async function loadScrapedKeysFromSupabase() {
  const [rawCompanies, detectedCompanies] = await Promise.all([
    loadSupabaseCompanies("storage-scrap"),
    loadSupabaseCompanies("storage-fb-scrap"),
  ]);

  return new Set([...rawCompanies, ...detectedCompanies].map(makeScrapedKey));
}

function loadScrapedKeysLocal() {
  const fb = loadJson(SCRAPED_FB_FILE).map(makeScrapedKey);
  const nofb = loadJson(SCRAPED_NOFB_FILE).map(makeScrapedKey);
  return new Set([...fb, ...nofb]);
}

async function filterNew(companies) {
  if (isVercel) {
    const seen = await loadScrapedKeysFromSupabase();
    return companies.filter((c) => !seen.has(makeScrapedKey(c)));
  }

  const seen = loadScrapedKeysLocal();
  return companies.filter((c) => !seen.has(makeScrapedKey(c)));
}

function markScrapedLocal(companies) {
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

function markScraped(companies) {
  if (isVercel) {
    console.log("[scraped] Skipping local file tracking on Vercel; Supabase is the source of truth.");
    return;
  }
  markScrapedLocal(companies);
}

module.exports = { filterNew, markScraped, makeScrapedKey };
