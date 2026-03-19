const express = require('express');
const path = require('path');
const scraperHandler = require('./index'); // Imports the logic from index.js

const app = express();
const PORT = process.env.PORT || 3001; // Use environment variable PORT or default to 3001

// 1. Serve static files (index.html, CSS, etc.) from the current folder
app.use(express.static(__dirname));

// 2. Route for the home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. API endpoint that triggers the scraper (Renamed to avoid conflict with static index.js file)
app.get('/api/run', async (req, res) => {
    try {
        await scraperHandler(req, res);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).send("Server Error: " + error.message);
        }
    }
});

// 4. Start the server
app.listen(PORT, () => {
    console.log(`\n✅ Web Interface Ready!`);
    console.log(`   Open this link in your browser: http://localhost:${PORT}\n`);
});
