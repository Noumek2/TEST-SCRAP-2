/**
 * save.js
 * Saves enriched company data to:
 *  - XML file (full structured data)
 *  - CSV file (flat spreadsheet-friendly format)
 */

const fs = require("fs");
const { saveReport } = require("./report");
const path = require("path");

// ── CSV helpers ────────────────────────────────────────────────────────────

// CSV columns in order
const CSV_COLUMNS = [
  { key: "name",             label: "Company Name" },
  { key: "websiteUrl",       label: "Website URL" },
  { key: "hasFacebook",      label: "Has Facebook" },
  { key: "facebookUrl",      label: "Facebook URL" },
  { key: "facebookPageName", label: "Facebook Page Name" },
  { key: "followers",        label: "Followers" },
  { key: "facebookPhone",    label: "Phone (Facebook)" },
  { key: "facebookEmail",    label: "Email (Facebook)" },
  { key: "facebookAddress",  label: "Address (Facebook)" },
  { key: "emails",           label: "Emails (Website)" },
  { key: "phones",           label: "Phones (Website)" },
  { key: "source",           label: "Found Via" },
  { key: "snippet",          label: "Description Snippet" },
  { key: "scrapedAt",        label: "Scraped At" },
];

/**
 * Escapes a single CSV cell value.
 * Wraps in quotes if it contains commas, quotes, or newlines.
 */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // Collapse newlines and tabs inside a cell
  str = str.replace(/[\r\n\t]+/g, " ").trim();
  // Escape double quotes
  str = str.replace(/"/g, '""');
  // Wrap in quotes if needed
  if (str.includes(",") || str.includes('"') || str.includes(";")) {
    str = '"' + str + '"';
  }
  return str;
}

/**
 * Converts company array to CSV string.
 * @param {Array} companies
 * @returns {string}
 */
function toCsv(companies) {
  const header = CSV_COLUMNS.map((c) => csvCell(c.label)).join(",");

  const rows = companies.map((c) => {
    return CSV_COLUMNS.map(({ key }) => {
      const val = c[key];
      if (Array.isArray(val)) {
        // Join arrays (emails, phones) with semicolons
        return csvCell(val.join("; "));
      }
      if (typeof val === "boolean") {
        return csvCell(val ? "Yes" : "No");
      }
      return csvCell(val);
    }).join(",");
  });

  return [header, ...rows].join("\n");
}

function toCsvFiltered(companies, options = {}) {
  const minFollowers = options.minFollowers || 100;
  const minPostYear  = options.minPostYear  || 2026;

  const filtered = companies.filter((c) => {
    const followers = typeof c.followers === "number" ? c.followers : parseInt(c.followers, 10);
    const year = c.lastPostYear || null;
    return followers > minFollowers && year && year >= minPostYear;
  });

  return toCsv(filtered);
}

// ── XML helpers ────────────────────────────────────────────────────────────

function escapeXml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toXml(companies, meta) {
  const { generatedAt, totalFound } = meta || {};

  const nodes = companies.map((c, i) => {
    const emailNodes = c.emails && c.emails.length
      ? c.emails.map((e) => "      <email>" + escapeXml(e) + "</email>").join("\n")
      : "      <email/>";
    const phoneNodes = c.phones && c.phones.length
      ? c.phones.map((p) => "      <phone>" + escapeXml(p) + "</phone>").join("\n")
      : "      <phone/>";

    return `
  <company index="${i + 1}">
    <name>${escapeXml(c.name)}</name>
    <websiteUrl>${escapeXml(c.websiteUrl)}</websiteUrl>
    <snippet>${escapeXml(c.snippet)}</snippet>
    <contacts>
${emailNodes}
${phoneNodes}
    </contacts>
    <facebook>
      <hasFacebook>${c.hasFacebook ? "true" : "false"}</hasFacebook>
      <facebookUrl>${escapeXml(c.facebookUrl)}</facebookUrl>
      <facebookPageName>${escapeXml(c.facebookPageName)}</facebookPageName>
      <isVerified>${c.isVerified ? "true" : "false"}</isVerified>
      <followers>${c.followers !== null && c.followers !== undefined ? c.followers : ""}</followers>
      <phone>${escapeXml(c.facebookPhone)}</phone>
      <email>${escapeXml(c.facebookEmail)}</email>
      <address>${escapeXml(c.facebookAddress)}</address>
      <website>${escapeXml(c.facebookWebsite)}</website>
    </facebook>
    <meta>
      <source>${escapeXml(c.source)}</source>
      <scrapedAt>${escapeXml(c.scrapedAt)}</scrapedAt>
    </meta>
  </company>`;
  }).join("\n");

  const withFb = companies.filter((c) => c.hasFacebook).length;

  return `<?xml version="1.0" encoding="UTF-8"?>
<cameroonCompanies>

  <!-- Generated: ${escapeXml(generatedAt || new Date().toISOString())} -->
  <!-- Total found: ${totalFound || companies.length} | With Facebook: ${withFb} -->

  <summary>
    <generatedAt>${escapeXml(generatedAt || new Date().toISOString())}</generatedAt>
    <totalCompanies>${companies.length}</totalCompanies>
    <companiesWithFacebook>${withFb}</companiesWithFacebook>
    <companiesWithoutFacebook>${companies.length - withFb}</companiesWithoutFacebook>
    <country>Cameroon</country>
    <sectors>
      <sector>Construction</sector>
      <sector>Real Estate</sector>
      <sector>Apartment Selling</sector>
    </sectors>
  </summary>
${nodes}

</cameroonCompanies>`;
}

// ── Save functions ─────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Saves companies to both CSV and XML.
 * @param {Array} companies
 * @param {Object} options
 * @param {string} options.outputDir
 * @param {string} options.baseName - base filename without extension
 * @param {boolean} options.facebookOnly
 * @returns {{ csvPath, xmlPath }}
 */
function saveAll(companies, options = {}) {
  const {
    outputDir = path.join(__dirname, "output"),
    baseName,
    facebookOnly = false,
  } = options;

  const toSave = facebookOnly ? companies.filter((c) => c.hasFacebook) : companies;
  ensureDir(outputDir);

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = baseName || ("cameroon_companies_" + ts);

  // ── Save CSV ──
  const csvPath = path.join(outputDir, base + ".csv");
  const csvString = toCsvFiltered(toSave, { minFollowers: 100, minPostYear: 2026 });
  fs.writeFileSync(csvPath, csvString, "utf8");
  const csvRowCount = csvString.split("\n").length - 1; // subtract header
  console.log("\nCSV saved: " + csvPath + " (" + csvRowCount + " rows, filtered 2026+ & >100 followers)");

  // ── Save XML ──
  const xmlPath = path.join(outputDir, base + ".xml");
  const xml = toXml(toSave, { generatedAt: new Date().toISOString(), totalFound: companies.length });
  fs.writeFileSync(xmlPath, xml, "utf8");
  console.log("XML saved: " + xmlPath + " (" + toSave.length + " records)");

  // ── Save HTML report ──
  const { saveReport } = require("./report");
  const htmlPath = saveReport(toSave, { outputDir, baseName: base });

  return { csvPath, xmlPath, htmlPath };
}

/**
 * Prints a summary table to the console.
 */
function printSummary(companies) {
  const line = "=".repeat(90);
  const dash = "-".repeat(90);
  console.log("\n" + line);
  console.log("  SCRAPE RESULTS SUMMARY");
  console.log(line);
  console.log(
    "  " +
    "#".padEnd(4) +
    "Company".padEnd(35) +
    "Facebook".padEnd(8) +
    "Followers".padEnd(12) +
    "Contacts"
  );
  console.log(dash);

  companies.forEach((c, i) => {
    const name     = (c.name || "Unknown").slice(0, 33).padEnd(35);
    const fb       = (c.hasFacebook ? "Yes" : "No").padEnd(8);
    const followers = (c.followers != null ? c.followers.toLocaleString() : "-").padEnd(12);
    const contacts = [
      c.emails.length > 0 ? c.emails.length + " email(s)" : "",
      c.phones.length > 0 ? c.phones.length + " phone(s)" : "",
    ].filter(Boolean).join(", ") || "none";

    console.log("  " + String(i + 1).padEnd(4) + name + fb + followers + contacts);
  });

  console.log(line);
  const withFb = companies.filter((c) => c.hasFacebook).length;
  const totalFollowers = companies.reduce((s, c) => s + (c.followers || 0), 0);
  const filtered = companies.filter((c) => (c.followers || 0) > 100 && (c.lastPostYear || 0) >= 2026).length;
  console.log(
    "  Total: " + companies.length +
      " | With Facebook: " + withFb +
      " | Total followers tracked: " + totalFollowers.toLocaleString() +
      " | Meets 2026+ posts & >100 followers: " + filtered
  );
  console.log(line + "\n");
}

module.exports = { saveAll, printSummary, toCsv, toXml };