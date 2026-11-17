/**
 * Local audit trail.
 *
 * Records what happened to a message: opens, bucket corrections, draft edits,
 * tone changes, approvals and feedback. The log stays in this browser.
 */

export const AUDIT_KEY = "mailmate.audit.v1";
export const AUDIT_LIMIT = 500;

let memory = [];

function storage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function read() {
  const store = storage();
  if (!store) return memory;
  try {
    const raw = store.getItem(AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries) {
  const capped = entries.slice(-AUDIT_LIMIT);
  const store = storage();
  if (!store) {
    memory = capped;
    return capped;
  }
  try {
    store.setItem(AUDIT_KEY, JSON.stringify(capped));
  } catch {
    memory = capped;
  }
  return capped;
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadAudit() {
  return read();
}

export function recordAudit({ type, email = null, text, meta = {} }) {
  if (!type || !text) return null;
  const entry = {
    id: makeId(),
    type,
    emailId: email?.id || meta.emailId || null,
    subject: email?.subject || meta.subject || null,
    text: String(text),
    source: meta.source || null,
    meta,
    timestamp: new Date().toISOString()
  };
  const entries = read();
  entries.push(entry);
  write(entries);
  return entry;
}

export function clearAudit() {
  memory = [];
  try {
    storage()?.removeItem(AUDIT_KEY);
  } catch {
    // The in-memory copy is already cleared.
  }
}

export function exportAuditJSON(entries = read()) {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: entries.length,
      events: entries
    },
    null,
    2
  );
}
