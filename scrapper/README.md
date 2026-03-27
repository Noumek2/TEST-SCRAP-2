# Cameroon Construction & Real Estate Company Scraper

Scrapes Google for construction and apartment-selling companies in Cameroon,
detects their Facebook pages, extracts contact info, and saves everything to XML.

## File Structure

```
cameroon-scraper/
├── search.js     # Searches Google for companies in Cameroon
├── detect.js     # Detects Facebook pages & extracts emails/phones
├── save.js       # Saves results to XML files
├── index.js      # Main runner — ties everything together
├── package.json
└── output/
    ├── all_companies.xml        # All companies found
    └── facebook_companies.xml   # Only companies with Facebook
```

## Setup

```bash
npm install
```

### Si Puppeteer ne trouve pas Chromium

Certaines configurations Windows empêchent `npx` de lancer l'installation de Chromium (erreur PowerShell et politique d'exécution).

- Pour forcer Puppeteer à télécharger Chromium :

```bash
npm run puppeteer-install
```

- Si tu veux utiliser un Chrome/Chromium déjà installé, définis une variable d'environnement :

```bash
# Exemple Windows PowerShell
$env:PUPPETEER_EXECUTABLE_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
node index.js
```

Les variables suivantes sont aussi prises en compte : `CHROME_PATH`, `CHROMIUM_PATH`.

## Usage

```bash
# Basic run (all companies, 2 Google pages per query)
node index.js

# Save only companies that HAVE a Facebook page
node index.js --facebook-only

# Scrape 3 pages per query (more results, slower)
node index.js --pages 3
```

Or use the npm shortcuts:
```bash
npm start                 # Basic run
npm run start:facebook-only
npm run start:deep        # 3 pages per query
```

## Google Drive Delivery

You can upload the generated CSV/XML/HTML/JSON result files to Google Drive instead of emailing them.

Set these environment variables:

```bash
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
GOOGLE_SERVICE_ACCOUNT_FILE=google-service-account.json
```

Or provide the service account directly as JSON:

```bash
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Notes:

- Share the target Google Drive folder with the service account email
- When Google Drive delivery is configured, the scraper skips the email send step
- The generated result files are still saved locally and can still be stored in Supabase

## Output XML Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<cameroonCompanies>

  <summary>
    <totalCompanies>42</totalCompanies>
    <companiesWithFacebook>28</companiesWithFacebook>
    ...
  </summary>

  <company index="1">
    <n>Example Construction SARL</n>
    <websiteUrl>https://example-construction.cm</websiteUrl>
    <snippet>Google result snippet...</snippet>
    <contacts>
      <email>contact@example-construction.cm</email>
      <phone>+237612345678</phone>
    </contacts>
    <facebook>
      <hasFacebook>true</hasFacebook>
      <facebookUrl>https://www.facebook.com/ExampleConstruction</facebookUrl>
    </facebook>
    <meta>
      <source>google_search</source>
      <scrapedAt>2026-03-16T10:00:00.000Z</scrapedAt>
    </meta>
  </company>

</cameroonCompanies>
```

## How It Works

1. **search.js** — Runs 8 Google queries (English + French) targeting Cameroon
   construction and real estate companies. Scrapes company name, URL, and snippet.

2. **detect.js** — For each company:
   - Visits their website and extracts emails, phone numbers, and any Facebook links
   - If no Facebook found on the site, does a targeted Google search:
     `"Company Name" site:facebook.com`

3. **save.js** — Converts all data to XML and writes two files:
   - `all_companies.xml` — every company found
   - `facebook_companies.xml` — only companies with a detected Facebook page

## Notes

- Delays of 2–2.5 seconds between requests to avoid being blocked by Google
- Google may occasionally return a CAPTCHA — if results are empty, wait 30 minutes and retry
- Phone numbers are extracted using Cameroon formats (+237, 6xx, 2xx, 3xx series)
