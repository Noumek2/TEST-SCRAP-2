// supabaseClient.js
require("./env");

const { createClient } = require("@supabase/supabase-js");

// These variables will be read from your environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

// Safety check: Make sure the variables actually exist
if (!supabaseUrl || !supabaseKey) {
  // Do nothing; the main script will check for a null client
  // and treat Supabase as an optional, disabled feature.
} else {
  const isPublishableKey = typeof supabaseKey === "string" && supabaseKey.toLowerCase().includes("publishable");
  if (isPublishableKey) {
    console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY appears to be a publishable key. Use the service role key from Supabase dashboard (Settings → API).");
  } else {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
}

module.exports = { supabase };
