/**
 * send_csv.js
 *
 * Send a CSV file as email attachment.
 *
 * Usage:
 *   node send_csv.js /path/to/output.csv recipient@example.com
 *
 * If you want to use configuration, add the following to config.json:
 * {
 *   "emailTo": "recipient@example.com",
 *   "smtp": {
 *     "host": "smtp.example.com",
 *     "port": 587,
 *     "secure": false,
 *     "auth": {
 *       "user": "smtp-user",
 *       "pass": "smtp-pass"
 *     }
 *   }
 * }
 */

const fs = require("fs");
const path = require("path");

let nodemailer;
try {
  nodemailer = require("nodemailer");
} catch (err) {
  console.error("Missing dependency: nodemailer. Run 'npm install nodemailer' to enable email sending.");
  process.exit(1);
}

const configPath = path.join(__dirname, "config.json");
let config = {};
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (err) {
    console.warn("Could not parse config.json: " + err.message);
  }
}

function getSmtpConfig() {
  if (config.smtp) return config.smtp;
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    };
  }
  return null;
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function sendCsv({ csvPath, to, subject, text }) {
  if (!fs.existsSync(csvPath)) {
    throw new Error("CSV file not found: " + csvPath);
  }

  to = to || config.emailTo || process.env.EMAIL_TO;
  if (!to) {
    throw new Error("No recipient email provided. Set config.emailTo or provide it as an argument.");
  }
  if (!isValidEmailAddress(to)) {
    throw new Error("Invalid recipient email address: " + to);
  }

  const smtpConfig = getSmtpConfig();
  if (!smtpConfig) {
    throw new Error("No SMTP configuration found. Set config.smtp or SMTP_* environment variables.");
  }

  const transporter = nodemailer.createTransport(smtpConfig);
  const info = await transporter.sendMail({
    from: smtpConfig.auth && smtpConfig.auth.user ? smtpConfig.auth.user : "scraper@example.com",
    to,
    subject: subject || `Scraper results (${path.basename(csvPath)})`,
    text: text || "Please find the latest scraper CSV attached.",
    attachments: [
      {
        filename: path.basename(csvPath),
        path: csvPath,
      },
    ],
  });

  return info;
}

if (require.main === module) {
  const [,, csvPathArg, toArg] = process.argv;
  const csvPath = csvPathArg || path.join(__dirname, "output", "all_companies.csv");
  const to = toArg || config.emailTo;

  sendCsv({ csvPath, to })
    .then((info) => {
      console.log("Email sent:", info.messageId);
    })
    .catch((err) => {
      console.error("Failed to send email:", err.message || err);
      process.exit(1);
    });
}

module.exports = { sendCsv };
