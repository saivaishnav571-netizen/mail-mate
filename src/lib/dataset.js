import { normalizeEmail } from "./triage.js";

const MAX_EMAILS = 300;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function fetchTestInbox() {
  const response = await fetch(`${import.meta.env.BASE_URL}test-inbox.json`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`The test inbox could not be loaded (${response.status}).`);
  }
  const data = await response.json();
  const rows = Array.isArray(data) ? data : data.emails || data.messages || data.inbox;
  if (!Array.isArray(rows)) {
    throw new Error("The test inbox has an unexpected shape.");
  }

  return {
    emails: rows.map((row, index) => normalizeEmail(row, index)),
    errors: [],
    label: "Test inbox"
  };
}

export function parseDataset(text, filename = "dataset") {
  if (!text || !text.trim()) {
    throw new DatasetError("The file is empty.");
  }
  if (new Blob([text]).size > MAX_FILE_BYTES) {
    throw new DatasetError("The file is larger than 2 MB. Split it into smaller files.");
  }

  const extension = filename.split(".").pop()?.toLowerCase();
  const isJson = extension === "json" || /^\s*[\[{]/.test(text);
  const isCsv = extension === "csv";

  if (!isJson && !isCsv) {
    throw new DatasetError("Use a .json or .csv file.");
  }

  let rows;
  try {
    rows = isJson ? parseJsonRows(text) : parseCsvRows(text);
  } catch (error) {
    if (error instanceof DatasetError) throw error;
    throw new DatasetError(isJson ? "That JSON could not be parsed." : "That CSV could not be parsed.");
  }

  if (!Array.isArray(rows) || !rows.length) {
    throw new DatasetError("No messages were found in the file.");
  }
  if (rows.length > MAX_EMAILS) {
    throw new DatasetError(`The demo handles up to ${MAX_EMAILS} messages at a time.`);
  }

  const emails = [];
  const errors = [];

  rows.forEach((row, index) => {
    const from = row.from || row.sender || {};
    const hasSender =
      (typeof from === "string" && from.trim()) ||
      (typeof from === "object" && (from.name || from.email || row.fromName || row.fromEmail));
    const subject = String(row.subject || row.title || "").trim();
    const body = String(row.body || row.text || row.message || row.snippet || "").trim();

    if (!hasSender) errors.push({ row: index + 1, message: "Missing a sender." });
    if (!subject) errors.push({ row: index + 1, message: "Missing a subject." });
    if (!body) errors.push({ row: index + 1, message: "Missing a message body." });

    if (hasSender && subject && body) {
      emails.push(normalizeEmail({ ...row, id: row.id || `import-${index + 1}` }, index));
    }
  });

  if (!emails.length) {
    throw new DatasetError("No usable messages were found. Every message needs a sender, subject and body.");
  }

  return {
    emails,
    errors,
    label: filename.replace(/\.[^.]+$/, "")
  };
}

export class DatasetError extends Error {
  constructor(message) {
    super(message);
    this.name = "DatasetError";
  }
}

function parseJsonRows(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DatasetError("That JSON has a syntax error.");
  }

  const rows = Array.isArray(data) ? data : data.emails || data.messages || data.inbox;
  if (!Array.isArray(rows)) {
    throw new DatasetError("Expected a list of messages, or an object with an “emails” list.");
  }
  return rows.filter((row) => row && typeof row === "object");
}

function parseCsvRows(text) {
  const table = parseCsv(text);
  if (table.length < 2) {
    throw new DatasetError("The CSV needs a header row and at least one message.");
  }

  const headers = table[0].map((header) => normalizeHeader(header));
  const rows = [];

  for (const cells of table.slice(1)) {
    if (!cells.some((cell) => cell.trim())) continue;
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] || "").trim();
    });
    const fromName = row.fromname || row.sendername || "";
    const fromEmail = row.fromemail || row.senderemail || "";
    const fromRaw = row.from || row.sender || "";
    const mapped = {
      id: row.id || row.messageid || undefined,
      from: fromEmail
        ? { name: fromName || fromRaw || fromEmail, email: fromEmail }
        : fromRaw,
      subject: row.subject || row.title || "",
      body: row.body || row.text || row.message || row.snippet || "",
      receivedAt: row.receivedat || row.date || row.sentat || row.received || ""
    };
    rows.push(mapped);
  }

  return rows;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
