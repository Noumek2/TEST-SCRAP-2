/**
 * chrome-path.js
 *
 * Helpers to locate a Chrome/Chromium executable to use with Puppeteer.
 *
 * Usage:
 *   const { getChromeExecutablePath } = require("./chrome-path");
 *   const execPath = getChromeExecutablePath();
 *   if (execPath) { puppeteer.launch({ executablePath: execPath, ... }) }
 */

const fs = require("fs");
const path = require("path");

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function getChromeExecutablePath() {
  // 1) Explicit override via environment variable
  const envPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
  ].filter(Boolean);
  for (const p of envPaths) {
    if (exists(p)) return p;
  }

  // 2) Common Windows install locations
  if (process.platform === "win32") {
    const candidates = [
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Chromium", "Application", "chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Chromium", "Application", "chrome.exe"),
    ].filter(Boolean);

    for (const p of candidates) {
      if (exists(p)) return p;
    }
  }

  // 3) No explicit path found
  return null;
}

module.exports = { getChromeExecutablePath };
