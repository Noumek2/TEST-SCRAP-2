/**
 * check_session.js
 * Opens a real Chrome browser, you log in to Facebook manually,
 * then it saves your session for the scraper to use.
 *
 * Run: node check_session.js
 * Requires: npm install puppeteer
 */

const puppeteer = require("puppeteer");
const fs        = require("fs");
const path      = require("path");
const { getChromeExecutablePath } = require("./chrome-path");

const SESSION_FILE = path.join(__dirname, "fb_session.json");

async function checkSession() {
  console.log("\n=== Facebook Session Setup ===\n");

  const executablePath = getChromeExecutablePath();
  const launchOpts = {
    headless: false,          // Opens a real visible Chrome window
    defaultViewport: null,    // Full size window
    args: [
      "--start-maximized",
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",  // Hides bot detection
    ],
    ignoreDefaultArgs: ["--enable-automation"],          // Remove automation banner
  };

  if (executablePath) {
    launchOpts.executablePath = executablePath;
  }

  let browser;
  try {
    browser = await puppeteer.launch(launchOpts);
  } catch (err) {
    console.error("Failed to launch browser: " + err.message);
    console.error("  - Run: npm run puppeteer-install");
    console.error("  - Or set PUPPETEER_EXECUTABLE_PATH / CHROME_PATH to a valid chrome.exe");
    process.exit(1);
  }

  const page = await browser.newPage();

  // Mask automation signals
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  console.log("A Chrome window is opening...");
  console.log("Please LOG IN to Facebook in that window.");
  console.log("Once you are logged in and can see your feed, come back here and press ENTER.\n");

  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for user to log in manually
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdout.write("Press ENTER after you have logged in to Facebook... ");
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });

  // Verify the session
  console.log("\nVerifying session...");
  const currentUrl = page.url();
  const html       = await page.content();

  const isLoggedIn =
    !currentUrl.includes("/login") &&
    !html.includes('id="loginbutton"') &&
    (html.includes('"isLoggedIn":true') || html.includes('"IS_LOGGED_IN":true') || html.includes('"viewer"'));

  if (isLoggedIn) {
    // Save cookies and localStorage for reuse
    const cookies = await page.cookies();
    const session = {
      cookies,
      savedAt: new Date().toISOString(),
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    };

    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
    console.log("\nSUCCESS - Session saved to fb_session.json!");
    console.log("You can now run: node index.js\n");
  } else {
    console.log("\nWARNING - Could not confirm login. Make sure you are logged in and try again.\n");
  }

  await browser.close();
}

checkSession().catch((err) => {
  console.error("Error: " + err.message);
  process.exit(1);
});