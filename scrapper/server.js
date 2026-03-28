require("./env");

const express = require("express");
const fs = require("fs");
const path = require("path");
const { loadSettings, saveSettings, sanitizeSettings } = require("./settings");
const { getOutputDir } = require("./save");
const { normalizeRunOptions, runScraperManaged, logErrorWithStack, getIsRunInProgress, getLatestRunState } = require("./index");
const { enqueueJob, getLatestCompletedJob, getLatestJob, hasJobQueue } = require("./jobQueue");

const app = express();

const PORT = process.env.PORT || 10000;

let schedulerTimer = null;
let schedulerState = {
  enabled: false,
  intervalMinutes: 60,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastError: null,
};

app.use(express.json());
app.use(express.static(__dirname));

function getControlSettings() {
  return loadSettings();
}

function refreshScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }

  const settings = getControlSettings();
  schedulerState.enabled = settings.autoRunHourly;

  if (!settings.autoRunHourly) {
    return;
  }

  schedulerTimer = setInterval(async () => {
    if (!hasJobQueue() && getIsRunInProgress()) {
      console.log("[scheduler] Skipping hourly run because another run is already in progress.");
      return;
    }

    const latestSettings = getControlSettings();
    schedulerState.lastStartedAt = new Date().toISOString();
    schedulerState.lastError = null;

    try {
      const options = {
        ...latestSettings,
        noOpen: true,
      };

      if (hasJobQueue()) {
        const job = await enqueueJob(options);
        console.log("[scheduler] Queued hourly scraper job " + job.id + ".");
      } else {
        console.log("[scheduler] Starting hourly scraper run.");
        await runScraperManaged(options);
      }

      schedulerState.lastCompletedAt = new Date().toISOString();
      console.log("[scheduler] Hourly scraper run completed.");
    } catch (error) {
      schedulerState.lastError = error.message;
      logErrorWithStack("scheduler", error);
    }
  }, schedulerState.intervalMinutes * 60 * 1000);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/settings", (req, res) => {
  res.json({
    settings: getControlSettings(),
    scheduler: {
      ...schedulerState,
      runningNow: hasJobQueue() ? false : getIsRunInProgress(),
    },
  });
});

app.get("/api/results", async (req, res) => {
  if (hasJobQueue()) {
    try {
      const job = await getLatestCompletedJob();
      const latestResults = job && job.result ? job.result.latestResults : null;

      if (!latestResults) {
        res.status(404).json({ ok: false, message: "No scrape results available yet." });
        return;
      }

      res.json({ ok: true, results: latestResults });
      return;
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to load latest results." });
      return;
    }
  }

  const resultsPath = path.join(getOutputDir(), "latest_results.json");

  if (!fs.existsSync(resultsPath)) {
    res.status(404).json({ ok: false, message: "No scrape results available yet." });
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    res.json({ ok: true, results: data });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Failed to load latest results." });
  }
});

app.get("/api/run-status", async (req, res) => {
  if (hasJobQueue()) {
    try {
      const job = await getLatestJob();
      res.json({
        ok: true,
        run: job || { status: "idle", logs: [] },
      });
      return;
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to load run status." });
      return;
    }
  }

  res.json({
    ok: true,
    run: getLatestRunState(),
  });
});

app.post("/api/settings", (req, res) => {
  const nextSettings = saveSettings(req.body || {});
  refreshScheduler();
  res.json({
    ok: true,
    settings: nextSettings,
    scheduler: {
      ...schedulerState,
      runningNow: hasJobQueue() ? false : getIsRunInProgress(),
    },
  });
});

app.all("/api/run", async (req, res) => {
  try {
    if (!hasJobQueue() && getIsRunInProgress()) {
      res.status(409).json({
        ok: false,
        message: "A scraper run is already in progress.",
        run: getLatestRunState(),
      });
      return;
    }

    const savedSettings = getControlSettings();
    const payload = req.method === "GET" ? req.query : (req.body || {});
    const options = normalizeRunOptions({
      ...savedSettings,
      ...sanitizeSettings({ ...savedSettings, ...payload }),
      facebookOnly: payload.facebookOnly === true || payload.facebookOnly === "true",
      noOpen: true,
    });

    if (hasJobQueue()) {
      const latestJob = await getLatestJob();
      if (latestJob && (latestJob.status === "pending" || latestJob.status === "running")) {
        res.status(409).json({
          ok: false,
          message: "A scraper job is already pending or running.",
          run: latestJob,
        });
        return;
      }

      const job = await enqueueJob(options);
      res.status(202).json({
        ok: true,
        message: "Scraper job queued.",
        run: job,
      });
      return;
    }

    runScraperManaged(options).catch((error) => {
      logErrorWithStack("api-run", error);
    });

    res.status(202).json({
      ok: true,
      message: "Scraper run started.",
      run: getLatestRunState(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Server Error: " + error.message });
  }
});

refreshScheduler();

app.listen(PORT, "0.0.0.0", () => {
  console.log("\nControl center ready.");
  console.log(`Listening on 0.0.0.0:${PORT}\n`);
});
