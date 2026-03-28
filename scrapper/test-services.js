/**
 * test-services.js
 * Script de test pour vérifier Supabase et l'Emailer sans lancer le scraper.
 */

const { supabase } = require("./supabaseClient");
const { sendEmail } = require("./emailer");

async function runTests() {
  console.log("--- DÉBUT DES TESTS DE CONFIGURATION ---");

  // 1. Test de Supabase
  console.log("\n[1/2] Test de connexion à Supabase...");
  if (!supabase) {
    console.error("  ❌ Le client Supabase n'est pas initialisé. Vérifiez vos variables SUPABASE_URL et KEY.");
  } else {
    try {
      // On tente de lire une seule ligne de la table pour vérifier l'accès
      const { data, error } = await supabase
        .from(process.env.SUPABASE_TABLE || "storage-fb-scrap")
        .select("*")
        .limit(1);

      if (error) {
        console.error("  ❌ Erreur Supabase :", error.message);
      } else {
        console.log("  ✅ Connexion Supabase réussie !");
      }
    } catch (err) {
      console.error("  ❌ Erreur lors du test Supabase :", err.message);
    }
  }

  // 2. Test de l'Email
  console.log("\n[2/2] Test d'envoi d'email (Gmail)...");
  const dummyCompanies = [
    {
      name: "TEST CONNECTION",
      websiteUrl: "https://google.com",
      hasFacebook: true,
      facebookUrl: "https://facebook.com/test",
      emails: ["test@exemple.com"],
      phones: ["+237 000 000 000"],
      source: "Manual Test"
    }
  ];

  const emailSuccess = await sendEmail(dummyCompanies);
  
  console.log("\n--- FIN DES TESTS ---");
}

runTests();