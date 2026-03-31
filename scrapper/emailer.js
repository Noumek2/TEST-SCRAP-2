/**
 * emailer.js
 * Sends scraper output via email using nodemailer
 */

const nodemailer = require("nodemailer");

function loadEmailConfig() {
  const config = {
    emailTo: process.env.EMAIL_TO,
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
  };

  if (!config.emailTo || !config.smtp.host || !config.smtp.auth.user || !config.smtp.auth.pass) {
    console.warn("  [email] Missing SMTP or EMAIL_TO environment variables");
    return null;
  }

  return config;
}


async function sendEmail(companies, options = {}) {
  const config = loadEmailConfig();
  if (!config) {
    console.log("  [email] Email not configured - skipping");
    return false;
  }

  if (!companies || companies.length === 0) {
    console.log("  [email] No companies to send - skipping email");
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.auth.user,
        pass: config.smtp.auth.pass,
      },
      // Add timeout and connection settings for better reliability
      connectionTimeout: 60000, // 60 seconds
      greetingTimeout: 30000,   // 30 seconds
      socketTimeout: 60000,     // 60 seconds
    });

    // Generate CSV data
    const { toCsv } = require("./save");
    const csvData = toCsv(companies);
    const csvSize = Buffer.byteLength(csvData, 'utf8');
    console.log(`  [email] CSV size: ${csvSize} bytes (${companies.length} companies)`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const csvFilename = `scraped_companies_${timestamp}.csv`;

    // Build email content
    const totalCompanies = companies.length;
    const facebookCompanies = companies.filter((c) => c.hasFacebook).length;
    const subject = `Scraper Report - ${totalCompanies} companies found (${facebookCompanies} with Facebook)`;
    
    const htmlContent = `
      <h2>Scraper Execution Report</h2>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <hr>
      <h3>Summary</h3>
      <ul>
        <li><strong>Total Companies:</strong> ${totalCompanies}</li>
        <li><strong>Companies with Facebook:</strong> ${facebookCompanies}</li>
        <li><strong>Companies without Facebook:</strong> ${totalCompanies - facebookCompanies}</li>
      </ul>
      <hr>
      <p>The detailed CSV file is attached to this email with all company information.</p>
      <p><small>This is an automated message from your Cameroon Company Scraper.</small></p>
    `;

    // Send email with CSV attachment
    const mailOptions = {
      from: config.smtp.auth.user,
      to: config.emailTo,
      subject: subject,
      html: htmlContent,
      attachments: companies.length > 0 ? [
        {
          filename: csvFilename,
          content: csvData,
          contentType: "text/csv",
        },
      ] : [],
    };

    console.log("\n  Sending email to " + config.emailTo + "...");
    console.log("  [email] Using SMTP:", config.smtp.host + ":" + config.smtp.port, "(secure:", config.smtp.secure + ")");
    
    const info = await transporter.sendMail(mailOptions);
    console.log("  ✅ Email sent successfully! Message ID: " + info.messageId);
    return true;
  } catch (err) {
    console.error("  ❌ Error sending email: " + err.message);
    if (err.code) console.error("     Error code:", err.code);
    if (err.response) console.error("     SMTP response:", err.response);
    if (err.responseCode) console.error("     Response code:", err.responseCode);
    console.error("  Full error:", err);
    return false;
  }
}

module.exports = { sendEmail };
