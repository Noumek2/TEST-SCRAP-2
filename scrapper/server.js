<<<<<<< HEAD
const cors = require('cors');
const express = require('express');
const path = require('path');
const scraperHandler = require('./index'); // Imports the logic from index.js
=======
const express = require("express");
const path = require("path");
const scraperHandler = require("./index");
>>>>>>> 4217575 (increase querry22)

const app = express();
const PORT = process.env.PORT || 3001;

// 1. Serve static files (index.html, CSS, etc.) from the current folder
app.use(express.static(__dirname));
app.use(cors());

<<<<<<< HEAD
// 2. Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 3. Route for the home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 4. API endpoint that triggers the scraper (Renamed to avoid conflict with static index.js file)
app.get('/api/run', async (req, res) => {
=======
// 2. Route for the home page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// 3. API endpoint that triggers the scraper (Renamed to avoid conflict with static index.js file)
app.get("/api/run", async (req, res) => {
>>>>>>> 4217575 (increase querry22)
    try {
        // Set a longer timeout for Render (default is 30s, we want 30min for long scrapes)
        req.socket.setTimeout(30 * 60 * 1000); // 30 minutes
        res.setTimeout(30 * 60 * 1000); // 30 minutes
        
        await scraperHandler(req, res);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).send("Server Error: " + error.message);
        }
    }
});

<<<<<<< HEAD
// 5. Error handler for 404
app.use((req, res) => {
    res.status(404).send('Not Found');
});

// 6. Start the server
const server = app.listen(PORT, () => {
    console.log(`\n✅ Web Interface Ready!`);
    console.log(`   Open this link in your browser: http://localhost:${PORT}\n`);
    console.log(`   Health check: http://localhost:${PORT}/health\n`);
});

// Graceful shutdown on Render
process.on('SIGTERM', () => {
    console.log('\n[SIGTERM] Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
=======
// 4. Start the server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n✅ Web Interface Ready!`);
    console.log(`   Listening on 0.0.0.0:${PORT}\n`);
>>>>>>> 4217575 (increase querry22)
});
