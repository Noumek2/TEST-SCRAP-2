const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = path.join(__dirname, ".control-center-settings.json");

const DEFAULT_SETTINGS = {
  country: "Cameroon",
  enterpriseLimit: 25,
  pagesPerQuery: 2,
  autoRunHourly: false,
  emailTo: process.env.EMAIL_TO || "juniorsmil24@gmail.com",
};

function sanitizeSettings(input = {}) {
  const enterpriseLimit = Math.max(1, Math.min(500, parseInt(input.enterpriseLimit, 10) || DEFAULT_SETTINGS.enterpriseLimit));
  const pagesPerQuery = Math.max(1, Math.min(10, parseInt(input.pagesPerQuery, 10) || DEFAULT_SETTINGS.pagesPerQuery));
  const country = String(input.country || DEFAULT_SETTINGS.country).trim() || DEFAULT_SETTINGS.country;
  const emailTo = String(input.emailTo || DEFAULT_SETTINGS.emailTo).trim() || DEFAULT_SETTINGS.emailTo;

  return {
    country,
    enterpriseLimit,
    pagesPerQuery,
    autoRunHourly: input.autoRunHourly === true || input.autoRunHourly === "true",
    emailTo,
  };
}

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS };
    }

    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return sanitizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
  } catch (error) {
    console.warn("[settings] Failed to load settings:", error.message);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(input = {}) {
  const nextSettings = sanitizeSettings(input);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(nextSettings, null, 2) + "\n", "utf8");
  return nextSettings;
}

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_FILE,
  loadSettings,
  saveSettings,
  sanitizeSettings,
};
