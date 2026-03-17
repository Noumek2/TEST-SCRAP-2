// supabaseClient.js
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load .env file if present (so you can set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY locally)
// This is optional; you can also set the vars in your shell environment.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  });
}

// These variables will be read from your environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Safety check: Make sure the variables actually exist
if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase Environment Variables!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };