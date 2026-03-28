require("./env");

const { runScraper } = require("./index");
const { getPendingJob, updateJob, appendJobLog, hasJobQueue } = require("./jobQueue");

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS, 10) || 5000;

function serializeArg(arg) {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

async function executeJob(job) {
  console.log("[worker] Starting job " + job.id);

  await updateJob(job.id, {
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null,
    error: null,
    logs: ["Worker picked up job."],
  });

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const capture = (writer) => async (...args) => {
    const message = args.map(serializeArg).join(" ");
    writer(...args);
    try {
      await appendJobLog(job.id, message);
    } catch (error) {
      writer("[worker] Failed to append log:", error.message);
    }
  };

  console.log = capture(originalLog);
  console.warn = capture(originalWarn);
  console.error = capture(originalError);

  try {
    const result = await runScraper({
      ...(job.payload || {}),
      noOpen: true,
    });

    await updateJob(job.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      result: result || null,
      error: null,
    });
    originalLog("[worker] Completed job " + job.id);
  } catch (error) {
    await appendJobLog(job.id, "[worker] Fatal error: " + error.message);
    await updateJob(job.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: error.message,
    });
    originalError("[worker] Job failed " + job.id + ": " + error.message);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

async function loop() {
  if (!hasJobQueue()) {
    throw new Error("Supabase is required for worker mode");
  }

  console.log("[worker] Polling for scrape jobs every " + POLL_INTERVAL_MS + "ms");

  while (true) {
    try {
      const job = await getPendingJob();
      if (job) {
        await executeJob(job);
      }
    } catch (error) {
      console.error("[worker] Poll loop error: " + error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

loop().catch((error) => {
  console.error("[worker] Fatal startup error: " + error.message);
  process.exit(1);
});
