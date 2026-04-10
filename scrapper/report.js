/**
 * report.js
 * Generates a beautiful interactive HTML dashboard from scraped company data.
 * - Sortable columns
 * - Search / filter bar
 * - Filter by Facebook presence
 * - Stats cards at the top
 * - Clickable Facebook and website links
 *
 * Called automatically by save.js, or run manually:
 *   node report.js                        (reads output/all_companies.csv -> generates report)
 *   node report.js --file output/daily_2026-03-16.csv
 */

const fs   = require("fs");
const path = require("path");

/**
 * Generates the full HTML dashboard string from an array of company objects.
 * @param {Array} companies
 * @param {string} title
 * @returns {string} HTML
 */
function generateHtml(companies, title) {
  const generatedAt  = new Date().toLocaleString();
  const totalCount   = companies.length;
  const websiteCount = companies.filter((c) => c.hasWebsite).length;
  const fbCount      = companies.filter((c) => c.hasFacebook).length;
  const verifiedCount = companies.filter((c) => c.isVerified).length;
  const withFollowers = companies.filter((c) => c.followers > 0).length;
  const totalFollowers = companies.reduce((s, c) => s + (c.followers || 0), 0);
  const topFollowers  = [...companies].sort((a, b) => (b.followers || 0) - (a.followers || 0)).slice(0, 3);

  // Embed company data as JSON for the table
  const jsonData = JSON.stringify(companies.map((c) => ({
    name:             c.name             || "",
    hasWebsite:       c.hasWebsite       || false,
    websiteUrl:       c.websiteUrl       || "",
    hasFacebook:      c.hasFacebook      || false,
    facebookUrl:      c.facebookUrl      || "",
    facebookPageName: c.facebookPageName || "",
    followers:        c.followers        != null ? c.followers : "",
    facebookPhone:    c.facebookPhone    || "",
    facebookEmail:    c.facebookEmail    || "",
    facebookAddress:  c.facebookAddress  || "",
    facebookWebsite:  c.facebookWebsite  || "",
    emails:           Array.isArray(c.emails) ? c.emails.join(", ") : (c.emails || ""),
    phones:           Array.isArray(c.phones) ? c.phones.join(", ") : (c.phones || ""),
    source:           c.source           || "",
    scrapedAt:        c.scrapedAt        || "",
  })));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
    }

    /* ── Header ─────────────────────────────────────────── */
    .header {
      background: linear-gradient(135deg, #1a1f35 0%, #16213e 50%, #0f3460 100%);
      padding: 32px 40px 28px;
      border-bottom: 1px solid #2d3748;
    }
    .header-top { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .header h1 { font-size: 1.7rem; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
    .header h1 span { color: #4299e1; }
    .header-meta { font-size: 0.78rem; color: #718096; margin-top: 6px; }

    /* ── Stats cards ─────────────────────────────────────── */
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 16px;
      padding: 28px 40px;
      background: #0f1117;
    }
    .stat-card {
      background: #1a202c;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 18px 20px;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s, border-color 0.2s;
    }
    .stat-card:hover { transform: translateY(-2px); border-color: #4299e1; }
    .stat-card::before {
      content: "";
      position: absolute; top: 0; left: 0; right: 0; height: 3px;
      background: var(--accent, #4299e1);
      border-radius: 12px 12px 0 0;
    }
    .stat-card.green  { --accent: #48bb78; }
    .stat-card.purple { --accent: #9f7aea; }
    .stat-card.yellow { --accent: #ecc94b; }
    .stat-card.pink   { --accent: #f687b3; }
    .stat-label { font-size: 0.72rem; color: #718096; text-transform: uppercase; letter-spacing: 0.8px; }
    .stat-value { font-size: 2rem; font-weight: 800; color: #fff; margin-top: 6px; line-height: 1; }
    .stat-sub   { font-size: 0.75rem; color: #a0aec0; margin-top: 4px; }

    /* ── Controls ────────────────────────────────────────── */
    .controls {
      padding: 0 40px 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .search-box {
      flex: 1; min-width: 240px;
      background: #1a202c;
      border: 1px solid #2d3748;
      border-radius: 8px;
      padding: 10px 16px 10px 40px;
      color: #e2e8f0;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23718096' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: 12px center;
    }
    .search-box:focus { border-color: #4299e1; }
    .search-box::placeholder { color: #4a5568; }

    .filter-btn {
      background: #1a202c;
      border: 1px solid #2d3748;
      border-radius: 8px;
      padding: 10px 18px;
      color: #a0aec0;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .filter-btn:hover, .filter-btn.active {
      background: #2b4c7e;
      border-color: #4299e1;
      color: #fff;
    }

    .count-label {
      font-size: 0.8rem;
      color: #718096;
      margin-left: auto;
      white-space: nowrap;
    }

    /* ── Table wrapper ───────────────────────────────────── */
    .table-wrap {
      padding: 0 40px 40px;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.84rem;
    }
    thead th {
      background: #1a202c;
      color: #a0aec0;
      font-weight: 600;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 12px 14px;
      text-align: left;
      border-bottom: 2px solid #2d3748;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    thead th:hover { color: #e2e8f0; background: #2d3748; }
    thead th .sort-icon { margin-left: 4px; opacity: 0.4; }
    thead th.sorted-asc .sort-icon::after  { content: " ▲"; opacity: 1; }
    thead th.sorted-desc .sort-icon::after { content: " ▼"; opacity: 1; }

    tbody tr {
      border-bottom: 1px solid #1e2533;
      transition: background 0.15s;
    }
    tbody tr:hover { background: #1a2035; }
    tbody tr.no-fb  { opacity: 0.6; }

    td {
      padding: 12px 14px;
      vertical-align: top;
      max-width: 220px;
    }
    td.nowrap { white-space: nowrap; }

    /* Company name cell */
    .company-name { font-weight: 600; color: #e2e8f0; }
    .company-source { font-size: 0.7rem; color: #4a5568; margin-top: 2px; }

    /* Facebook badge */
    .fb-badge {
      display: inline-flex; align-items: center; gap: 5px;
      background: #1877f2;
      color: #fff;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 20px;
      text-decoration: none;
      white-space: nowrap;
    }
    .fb-badge:hover { background: #1464d8; }
    .no-fb-badge {
      font-size: 0.72rem; color: #4a5568;
    }
    .verified-icon { color: #4299e1; font-size: 0.75rem; margin-left: 4px; }

    /* Follower count */
    .followers-value { font-weight: 700; color: #48bb78; }
    .likes-value     { font-weight: 700; color: #9f7aea; }

    /* Rating stars */
    .rating-stars { color: #ecc94b; font-size: 0.8rem; }
    .rating-num   { color: #a0aec0; font-size: 0.75rem; }

    /* Links */
    a.link-ext {
      color: #4299e1;
      text-decoration: none;
      font-size: 0.8rem;
      word-break: break-all;
    }
    a.link-ext:hover { text-decoration: underline; }

    /* Contact chips */
    .chip {
      display: inline-block;
      background: #2d3748;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 0.72rem;
      color: #a0aec0;
      margin: 2px 2px 0 0;
      word-break: break-all;
    }

    /* About text */
    .about-text {
      font-size: 0.78rem;
      color: #718096;
      max-width: 200px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: help;
    }

    /* Empty state */
    .empty {
      text-align: center;
      padding: 60px 20px;
      color: #4a5568;
    }
    .empty .emoji { font-size: 3rem; display: block; margin-bottom: 12px; }

    /* Top companies bar */
    .top-bar {
      margin: 0 40px 20px;
      background: #1a202c;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 16px 20px;
    }
    .top-bar h3 { font-size: 0.8rem; color: #718096; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 12px; }
    .top-list { display: flex; gap: 12px; flex-wrap: wrap; }
    .top-item {
      background: #2d3748;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 0.82rem;
    }
    .top-item strong { color: #48bb78; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #0f1117; }
    ::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 3px; }

    @media (max-width: 768px) {
      .header, .stats, .controls, .table-wrap, .top-bar { padding-left: 16px; padding-right: 16px; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .header h1 { font-size: 1.3rem; }
    }
  </style>
</head>
<body>

<!-- ── Header ─────────────────────────────────────────────────────────── -->
<div class="header">
  <div class="header-top">
    <div>
      <h1><span>Company</span> Results Dashboard</h1>
      <div class="header-meta">
        ${escHtml(title)} &nbsp;·&nbsp; Generated ${escHtml(generatedAt)}
      </div>
    </div>
  </div>
</div>

<!-- ── Stats cards ─────────────────────────────────────────────────────── -->
<div class="stats">
  <div class="stat-card">
    <div class="stat-label">Total Companies</div>
    <div class="stat-value">${totalCount}</div>
    <div class="stat-sub">found &amp; processed</div>
  </div>
  <div class="stat-card green">
    <div class="stat-label">Has Website</div>
    <div class="stat-value">${websiteCount}</div>
    <div class="stat-sub">${totalCount > 0 ? Math.round(websiteCount / totalCount * 100) : 0}% with a site</div>
  </div>
  <div class="stat-card purple">
    <div class="stat-label">On Facebook</div>
    <div class="stat-value">${fbCount}</div>
    <div class="stat-sub">${totalCount > 0 ? Math.round(fbCount / totalCount * 100) : 0}% of total</div>
  </div>
  <div class="stat-card yellow">
    <div class="stat-label">Total Followers</div>
    <div class="stat-value">${totalFollowers >= 1000 ? (totalFollowers / 1000).toFixed(1) + "K" : totalFollowers}</div>
    <div class="stat-sub">across ${withFollowers} tracked pages</div>
  </div>
  <div class="stat-card pink">
    <div class="stat-label">Verified Pages</div>
    <div class="stat-value">${verifiedCount}</div>
    <div class="stat-sub">with verification badge</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">No Facebook</div>
    <div class="stat-value">${totalCount - fbCount}</div>
    <div class="stat-sub">companies without a page</div>
  </div>
</div>

<!-- ── Top companies ───────────────────────────────────────────────────── -->
${topFollowers.filter((c) => c.followers).length > 0 ? `
<div class="top-bar">
  <h3>🏆 Top companies by followers</h3>
  <div class="top-list">
    ${topFollowers.filter((c) => c.followers).map((c, i) => `
    <div class="top-item">
      ${["🥇","🥈","🥉"][i]} ${escHtml(c.facebookPageName || c.name)}
      &nbsp;<strong>${c.followers.toLocaleString()}</strong> followers
    </div>`).join("")}
  </div>
</div>` : ""}

<!-- ── Controls ────────────────────────────────────────────────────────── -->
<div class="controls">
  <input class="search-box" id="searchInput" type="text" placeholder="Search by name, category, phone, email, address..."/>
  <button class="filter-btn active" onclick="setFilter('all',this)">All (${totalCount})</button>
  <button class="filter-btn" onclick="setFilter('facebook',this)">Facebook only (${fbCount})</button>
  <button class="filter-btn" onclick="setFilter('nofacebook',this)">No Facebook (${totalCount - fbCount})</button>
  <span class="count-label" id="countLabel">${totalCount} companies shown</span>
</div>

<!-- ── Table ────────────────────────────────────────────────────────────── -->
<div class="table-wrap">
  <table id="mainTable">
    <thead>
      <tr>
        <th onclick="sortTable(0)" data-col="0">#<span class="sort-icon"></span></th>
        <th onclick="sortTable(1)" data-col="1">Company<span class="sort-icon"></span></th>
        <th onclick="sortTable(2)" data-col="2">Facebook<span class="sort-icon"></span></th>
        <th onclick="sortTable(3)" data-col="3">Followers<span class="sort-icon"></span></th>
        <th onclick="sortTable(4)" data-col="4">Likes<span class="sort-icon"></span></th>
        <th onclick="sortTable(5)" data-col="5">Rating<span class="sort-icon"></span></th>
        <th onclick="sortTable(6)" data-col="6">Category<span class="sort-icon"></span></th>
        <th data-col="7">Contact Info</th>
        <th data-col="8">About</th>
        <th data-col="9">Website</th>
        <th onclick="sortTable(10)" data-col="10">Scraped<span class="sort-icon"></span></th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>
  <div class="empty" id="emptyState" style="display:none">
    <span class="emoji">🔍</span>
    No companies match your search.
  </div>
</div>

<script>
// ── Data ────────────────────────────────────────────────────────────────
const DATA = ${jsonData};

let currentFilter = "all";
let currentSort   = { col: -1, dir: 1 };
let searchTerm    = "";

// ── Render ──────────────────────────────────────────────────────────────
function renderTable() {
  let rows = DATA.slice();

  // Filter
  if (currentFilter === "facebook")   rows = rows.filter((r) => r.hasFacebook);
  if (currentFilter === "nofacebook") rows = rows.filter((r) => !r.hasFacebook);

  // Search
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    rows = rows.filter((r) =>
      Object.values(r).some((v) => String(v).toLowerCase().includes(q))
    );
  }

  // Sort
  if (currentSort.col >= 0) {
    rows.sort((a, b) => {
      const va = getSortVal(a, currentSort.col);
      const vb = getSortVal(b, currentSort.col);
      if (va === vb) return 0;
      if (va === "" || va === null) return 1;
      if (vb === "" || vb === null) return -1;
      return (va > vb ? 1 : -1) * currentSort.dir;
    });
  }

  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";

  rows.forEach((c, i) => {
    const tr = document.createElement("tr");
    if (!c.hasFacebook) tr.classList.add("no-fb");

    // Followers/likes formatted
    const followersHtml = c.followers !== ""
      ? '<span class="followers-value">' + Number(c.followers).toLocaleString() + '</span>'
      : '<span style="color:#4a5568">—</span>';

    const likesHtml = c.likes !== ""
      ? '<span class="likes-value">' + Number(c.likes).toLocaleString() + '</span>'
      : '<span style="color:#4a5568">—</span>';

    // Rating stars
    let ratingHtml = '<span style="color:#4a5568">—</span>';
    if (c.rating !== "") {
      const stars = Math.round(c.rating);
      ratingHtml = '<span class="rating-stars">' + "★".repeat(stars) + "☆".repeat(5 - stars) + '</span>'
        + '<br><span class="rating-num">' + c.rating + '/5'
        + (c.ratingCount ? " (" + Number(c.ratingCount).toLocaleString() + ")" : "") + '</span>';
    }

    // Contacts
    const contacts = [];
    if (c.facebookPhone) contacts.push('<span class="chip">📞 ' + esc(c.facebookPhone) + '</span>');
    if (c.facebookEmail) contacts.push('<span class="chip">✉️ ' + esc(c.facebookEmail) + '</span>');
    if (c.phones)        c.phones.split(",").forEach((p) => { if (p.trim()) contacts.push('<span class="chip">' + esc(p.trim()) + '</span>'); });
    if (c.emails)        c.emails.split(",").forEach((e) => { if (e.trim()) contacts.push('<span class="chip">' + esc(e.trim()) + '</span>'); });
    if (c.facebookAddress) contacts.push('<span class="chip">📍 ' + esc(c.facebookAddress.slice(0,60)) + '</span>');

    // Facebook cell
    const fbHtml = c.hasFacebook
      ? '<a class="fb-badge" href="' + esc(c.facebookUrl) + '" target="_blank">f ' + esc((c.facebookPageName || "Facebook").slice(0, 22)) + '</a>'
        + (c.isVerified ? '<span class="verified-icon" title="Verified">✔</span>' : '')
      : '<span class="no-fb-badge">No page</span>';

    // Scraped date (short)
    const dateShort = c.scrapedAt ? c.scrapedAt.slice(0, 10) : "";

    tr.innerHTML =
      '<td class="nowrap" style="color:#4a5568;font-size:0.75rem">' + (i + 1) + '</td>' +
      '<td><div class="company-name">' + esc(c.name) + '</div>'
        + (c.source ? '<div class="company-source">via ' + esc(c.source) + '</div>' : '') + '</td>' +
      '<td class="nowrap">' + fbHtml + '</td>' +
      '<td class="nowrap">' + followersHtml + '</td>' +
      '<td class="nowrap">' + likesHtml + '</td>' +
      '<td>' + ratingHtml + '</td>' +
      '<td style="font-size:0.78rem;color:#a0aec0">' + esc(c.category) + '</td>' +
      '<td>' + (contacts.length > 0 ? contacts.join("") : '<span style="color:#4a5568">—</span>') + '</td>' +
      '<td><div class="about-text" title="' + esc(c.facebookAbout) + '">' + esc((c.facebookAbout || "").slice(0, 80)) + (c.facebookAbout && c.facebookAbout.length > 80 ? "..." : "") + '</div></td>' +
      '<td>' + (c.hasWebsite && (c.websiteUrl || c.facebookWebsite)
          ? '<a class="link-ext" href="' + esc(c.facebookWebsite || c.websiteUrl) + '" target="_blank">'
            + esc((c.facebookWebsite || c.websiteUrl).replace(/https?:\/\/(www\.)?/, "").slice(0, 30)) + '</a>'
          : '<span style="color:#4a5568">—</span>') + '</td>' +
      '<td class="nowrap" style="font-size:0.75rem;color:#4a5568">' + dateShort + '</td>';

    tbody.appendChild(tr);
  });

  document.getElementById("countLabel").textContent = rows.length + " companies shown";
  document.getElementById("emptyState").style.display = rows.length === 0 ? "block" : "none";
  document.getElementById("mainTable").style.display  = rows.length === 0 ? "none"  : "table";
}

function getSortVal(row, col) {
  switch (col) {
    case 0:  return 0;
    case 1:  return (row.name || "").toLowerCase();
    case 2:  return row.hasFacebook ? 0 : 1;
    case 3:  return row.followers !== "" ? Number(row.followers) : -1;
    case 4:  return row.likes     !== "" ? Number(row.likes)     : -1;
    case 5:  return row.rating    !== "" ? Number(row.rating)    : -1;
    case 6:  return (row.category || "").toLowerCase();
    case 10: return row.scrapedAt || "";
    default: return "";
  }
}

// ── Sort ────────────────────────────────────────────────────────────────
function sortTable(col) {
  document.querySelectorAll("thead th").forEach((th) => th.classList.remove("sorted-asc", "sorted-desc"));
  if (currentSort.col === col) {
    currentSort.dir *= -1;
  } else {
    currentSort = { col, dir: -1 }; // default descending for numbers
  }
  const th = document.querySelector("thead th[data-col='" + col + "']");
  th.classList.add(currentSort.dir === 1 ? "sorted-asc" : "sorted-desc");
  renderTable();
}

// ── Filter buttons ───────────────────────────────────────────────────────
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderTable();
}

// ── Search ───────────────────────────────────────────────────────────────
document.getElementById("searchInput").addEventListener("input", (e) => {
  searchTerm = e.target.value.trim();
  renderTable();
});

// ── HTML escape helper ───────────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Init ─────────────────────────────────────────────────────────────────
renderTable();
</script>
</body>
</html>`;
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Generates and saves the HTML report.
 * @param {Array} companies
 * @param {Object} options
 * @param {string} options.outputDir
 * @param {string} options.baseName
 * @returns {string} path to HTML file
 */
function saveReport(companies, options) {
  options = options || {};
  const outputDir = options.outputDir || path.join(__dirname, "output");
  const baseName  = options.baseName  || ("companies_" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  const title     = options.title     || "Company Results";

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const htmlPath = path.join(outputDir, baseName + ".html");
  const html     = generateHtml(companies, title);
  fs.writeFileSync(htmlPath, html, "utf8");
  console.log("HTML report saved: " + htmlPath);
  return htmlPath;
}

module.exports = { saveReport, generateHtml };
