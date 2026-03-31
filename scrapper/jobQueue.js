require("./env");

const { supabase } = require("./supabaseClient");

const JOBS_TABLE = process.env.SCRAPE_JOBS_TABLE || "scrape_jobs";
const isQueueEnabled = process.env.SCRAPE_USE_QUEUE === "true";

function hasJobQueue() {
  return !!supabase && isQueueEnabled;
}

function mapJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status || "idle",
    payload: row.payload || {},
    logs: Array.isArray(row.logs) ? row.logs : [],
    result: row.result || null,
    error: row.error || null,
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function enqueueJob(payload) {
  if (!supabase) throw new Error("Supabase is not configured for job queue");

  const insertPayload = {
    status: "pending",
    payload,
    logs: ["Job queued."],
    error: null,
    result: null,
  };

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throw error;
  return mapJobRow(data);
}

async function getLatestJob() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return mapJobRow(data);
}

async function getLatestCompletedJob() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .select("*")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return mapJobRow(data);
}

async function getPendingJob() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return mapJobRow(data);
}

async function updateJob(id, patch) {
  if (!supabase) throw new Error("Supabase is not configured for job queue");

  const payload = {
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return mapJobRow(data);
}

async function appendJobLog(id, message) {
  if (!supabase) return null;

  const current = await getJobById(id);
  if (!current) return null;

  const nextLogs = [...current.logs, message].slice(-500);
  return updateJob(id, { logs: nextLogs });
}

async function getJobById(id) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return mapJobRow(data);
}

module.exports = {
  JOBS_TABLE,
  appendJobLog,
  enqueueJob,
  getJobById,
  getLatestCompletedJob,
  getLatestJob,
  getPendingJob,
  hasJobQueue,
  isQueueEnabled,
  updateJob,
};
