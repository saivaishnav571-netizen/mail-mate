/**
 * Client for the local FastAPI feedback service.
 *
 * The demo stays usable when the service is not running: callers catch
 * FeedbackApiError and show an explicit "service offline" message rather than
 * pretending feedback was stored.
 *
 * Static hosting (for example the Vercel preview) has no backend at all. The
 * helpers below let the UI detect that up front instead of firing requests
 * that can only return 404.
 */

const DEFAULT_API_BASE = "/api";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function readEnvBase() {
  try {
    const value = import.meta.env?.VITE_API_BASE_URL;
    return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

const ENV_API_BASE = readEnvBase();

export function apiBaseUrl() {
  return ENV_API_BASE || DEFAULT_API_BASE;
}

/**
 * Classify where this page is running.
 *
 * - "local": served from localhost, where the Vite proxy reaches the API.
 * - "remote": `VITE_API_BASE_URL` names a deployed API origin.
 * - "frontend-only": static hosting with no API behind it (e.g. Vercel).
 */
export function backendMode(
  location = typeof window !== "undefined" ? window.location : null,
  envBase = ENV_API_BASE
) {
  if (envBase) return "remote";
  if (!location) return "local";
  if (location.protocol === "file:") return "frontend-only";
  const host = String(location.hostname || "").toLowerCase();
  return LOCAL_HOSTNAMES.has(host) ? "local" : "frontend-only";
}

export function isBackendConfigured(location, envBase) {
  return backendMode(location, envBase) !== "frontend-only";
}

export class FeedbackApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "FeedbackApiError";
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = "GET", body, adminToken, headers = {} } = {}) {
  const init = {
    method,
    headers: { Accept: "application/json", ...headers }
  };
  if (method === "GET") {
    // Analytics must never come from a stale HTTP cache when the service is
    // down; otherwise the dashboard could show data that is no longer live.
    init.cache = "no-store";
  }
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (adminToken) init.headers["X-Admin-Token"] = adminToken;

  let response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, init);
  } catch (error) {
    throw new FeedbackApiError(
      "The feedback service is offline. Start the FastAPI backend on port 8000.",
      0,
      error
    );
  }

  if (!response.ok) {
    let detail = null;
    try {
      detail = await response.json();
    } catch {
      // response was not JSON
    }
    const message =
      typeof detail?.detail === "string"
        ? detail.detail
        : Array.isArray(detail?.detail)
          ? detail.detail.map((item) => item.msg).join("; ")
          : `Request failed with HTTP ${response.status}`;
    throw new FeedbackApiError(message, response.status, detail);
  }
  return response;
}

export async function fetchHealth() {
  return (await request("/health")).json();
}

export async function fetchCurrentModel() {
  return (await request("/model/current")).json();
}

export async function fetchModelVersions() {
  return (await request("/model/versions")).json();
}

export async function fetchAnalytics() {
  return (await request("/analytics")).json();
}

export async function fetchIntelligence() {
  return (await request("/intelligence")).json();
}

export async function reportEmailAnalytics({ dataset, messages }) {
  return (
    await request("/emails/analyze", {
      method: "POST",
      body: { dataset, messages }
    })
  ).json();
}

export async function fetchFeedback({ limit = 100, approvedOnly = false } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (approvedOnly) params.set("approved_only", "true");
  return (await request(`/feedback?${params.toString()}`)).json();
}

export async function submitFeedback(payload) {
  return (await request("/feedback", { method: "POST", body: payload })).json();
}

export async function approveFeedback(feedbackId, adminToken) {
  return (
    await request(`/feedback/${feedbackId}/approve`, { method: "POST", adminToken })
  ).json();
}

export async function retrainModel(adminToken) {
  return (await request("/model/retrain", { method: "POST", adminToken })).json();
}

export async function activateModel(version, adminToken) {
  return (
    await request(`/model/${encodeURIComponent(version)}/activate`, {
      method: "POST",
      adminToken
    })
  ).json();
}

export async function exportFeedbackCsv({ approvedOnly = true } = {}) {
  const params = new URLSearchParams({ approved_only: String(approvedOnly) });
  const response = await request(`/feedback/export?${params.toString()}`, {
    headers: { Accept: "text/csv" }
  });
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  return {
    blob: await response.blob(),
    filename: match?.[1] || "mailmate-feedback.csv"
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
