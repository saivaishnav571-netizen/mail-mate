/**
 * Natural-language search.
 *
 * Phase 1 is keyword relevance (BM25-style) plus a structured query parser.
 * The parser turns phrases such as "internship emails about interviews in
 * November" into category, sender and date filters, then keeps the remaining
 * terms for ranking. No model download is required.
 */

import { CATEGORIES } from "./triage.js";
import { tokenize } from "./text.js";

const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

const CATEGORY_ALIASES = {
  internship: ["internship", "intern", "recruiter", "graduate scheme", "placement"],
  academic: ["academic", "university", "uni", "course", "coursework", "exam", "seminar", "lecture", "thesis"],
  important: ["important", "work", "finance", "legal", "invoice", "contract", "operations", "admin"],
  personal: ["personal", "friend", "family", "dinner", "birthday", "social"],
  spam: ["spam", "junk", "scam", "phishing"]
};

const QUERY_STOPWORDS = new Set(
  `find show search emails email mail messages message scheduled schedule about with that where looking need get all any please list me my the a an of for to in on at by`.split(
    /\s+/
  )
);

const FILTER_WORDS = new Set([
  ...Object.keys(MONTHS),
  "unread",
  "read",
  "awaiting",
  "reply",
  "replies",
  "follow",
  "up",
  "week",
  "month",
  "this",
  "next",
  "last",
  "today",
  "yesterday",
  "tomorrow"
]);

function stem(token) {
  const value = String(token || "").toLowerCase();
  if (value.length <= 4) return value;
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("sses")) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function detectCategory(text) {
  const found = [];
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((alias) => new RegExp(`\\b${alias}\\b`, "i").test(text))) found.push(category);
  }
  return [...new Set(found)];
}

function detectMonth(text) {
  const match = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}))?/i
  );
  if (!match) return null;
  return { month: MONTHS[match[1].toLowerCase()], year: match[2] ? Number(match[2]) : null };
}

function monthRange(month, year) {
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function relativeRange(text, reference) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);

  if (/\btoday\b/.test(text)) {
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end, label: "today" };
  }

  if (/\btomorrow\b/.test(text)) {
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    const end = new Date(next);
    end.setHours(23, 59, 59, 999);
    return { start: next, end, label: "tomorrow" };
  }

  if (/\b(?:this|next)\s+week\b/.test(text)) {
    const next = /next\s+week/.test(text);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(start);
    monday.setDate(start.getDate() + mondayOffset + (next ? 7 : 0));
    const end = new Date(monday);
    end.setDate(monday.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start: monday, end, label: next ? "next week" : "this week" };
  }

  if (/\b(?:this|next)\s+month\b/.test(text)) {
    const next = /next\s+month/.test(text);
    const month = reference.getMonth() + (next ? 1 : 0);
    return { ...monthRange(month, reference.getFullYear()), label: next ? "next month" : "this month" };
  }

  return null;
}

function detectSender(text) {
  const match = text.match(
    /\b(?:from|sender|sent by)\s+([a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,2})/i
  );
  if (!match) return null;
  const value = match[1]
    .replace(/\b(?:in|on|about|with|during|this|next|last)\b.*$/i, "")
    .trim();
  return value || null;
}

export function parseQuery(query, { reference = new Date() } = {}) {
  const raw = String(query || "").trim();
  const text = raw.toLowerCase();
  const categories = detectCategory(text);
  const month = detectMonth(text);
  const relative = relativeRange(text, reference);
  const sender = detectSender(text);

  let dateRange = relative;
  let monthLabel = null;
  if (!dateRange && month) {
    const year = month.year || reference.getFullYear();
    dateRange = monthRange(month.month, year);
    monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
      new Date(year, month.month, 1)
    );
  }

  const phrases = [...raw.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((match) => (match[1] || match[2]).trim()).filter(Boolean);

  const withoutPhrases = raw.replace(/"([^"]+)"|“([^”]+)”/g, " ");
  const tokens = tokenize(withoutPhrases)
    .filter((token) => !QUERY_STOPWORDS.has(token))
    .filter((token) => !FILTER_WORDS.has(token))
    .filter((token) => !Object.values(CATEGORY_ALIASES).flat().some((alias) => alias === token))
    .map(stem);

  const keywords = [...new Set(tokens)];
  const interpreted = [];
  if (categories.length) interpreted.push(`category: ${categories.map((id) => CATEGORIES.find((c) => c.id === id)?.label).join(" or ")}`);
  if (sender) interpreted.push(`sender: ${sender}`);
  if (monthLabel) interpreted.push(`month: ${monthLabel}`);
  if (relative) interpreted.push(`date: ${relative.label}`);
  if (keywords.length) interpreted.push(`keywords: ${keywords.join(", ")}`);
  if (phrases.length) interpreted.push(`phrase: ${phrases.join(", ")}`);
  if (/\bunread\b/.test(text)) interpreted.push("unread only");
  if (/\b(?:awaiting|needs? (?:a )?reply|waiting on me|follow up)\b/.test(text)) interpreted.push("awaiting your reply");

  return {
    raw,
    categories,
    sender,
    month: monthLabel,
    dateRange,
    keywords,
    phrases,
    unread: /\bunread\b/.test(text),
    awaiting: /\b(?:awaiting|needs? (?:a )?reply|waiting on me|follow up)\b/.test(text),
    interpreted
  };
}

function emailTokens(email) {
  return {
    subject: tokenize(email.subject).map(stem),
    body: tokenize(email.body).map(stem),
    sender: tokenize(`${email.from?.name || ""} ${email.from?.email || ""}`).map(stem)
  };
}

function countTerm(tokens, term) {
  let count = 0;
  for (const token of tokens) if (token === term) count += 1;
  return count;
}

function inRange(date, range) {
  if (!range) return true;
  return date.getTime() >= range.start.getTime() && date.getTime() <= range.end.getTime();
}

export function searchEmails(emails, query, { reference = new Date() } = {}) {
  const parsed = parseQuery(query, { reference });
  if (!parsed.raw) {
    return { parsed, results: emails.map((email) => ({ email, score: 0, reasons: [] })) };
  }

  const filtered = emails.filter((email) => {
    if (parsed.categories.length && !parsed.categories.includes(email.analysis?.category)) return false;
    if (parsed.sender) {
      const sender = `${email.from?.name || ""} ${email.from?.email || ""}`.toLowerCase();
      if (!parsed.sender.toLowerCase().split(/\s+/).every((part) => sender.includes(part))) return false;
    }
    if (!inRange(email.receivedAt, parsed.dateRange)) return false;
    if (parsed.unread && email.read) return false;
    if (parsed.awaiting && !email.followUp?.awaiting) return false;
    return true;
  });

  const hasTerms = parsed.keywords.length > 0 || parsed.phrases.length > 0;
  if (!hasTerms) {
    return {
      parsed,
      results: filtered.map((email) => ({
        email,
        score: 0,
        reasons: parsed.interpreted.length ? parsed.interpreted : ["all messages"]
      }))
    };
  }

  const docs = filtered.map((email) => ({ email, tokens: emailTokens(email) }));
  const documentFrequency = new Map();
  for (const { tokens } of docs) {
    const seen = new Set([...tokens.subject, ...tokens.body, ...tokens.sender]);
    for (const term of seen) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }

  const total = docs.length || 1;
  const idf = (term) => Math.log((1 + total) / (1 + (documentFrequency.get(term) || 0))) + 1;

  const scored = docs
    .map(({ email, tokens }) => {
      const matched = [];
      let score = 0;

      for (const term of parsed.keywords) {
        const subjectHits = countTerm(tokens.subject, term);
        const bodyHits = countTerm(tokens.body, term);
        const senderHits = countTerm(tokens.sender, term);
        const hits = subjectHits * 3 + bodyHits + senderHits * 2;
        if (hits) {
          score += hits * idf(term);
          matched.push(term);
        }
      }

      const haystack = `${email.subject} ${email.body} ${email.from?.name || ""}`.toLowerCase();
      for (const phrase of parsed.phrases) {
        if (haystack.includes(phrase.toLowerCase())) {
          score += 6;
          matched.push(`“${phrase}”`);
        }
      }

      const reasons = [];
      if (parsed.categories.length) reasons.push(`category: ${parsed.categories.join(" or ")}`);
      if (parsed.sender) reasons.push(`sender: ${parsed.sender}`);
      if (parsed.month) reasons.push(`month: ${parsed.month}`);
      if (parsed.dateRange && !parsed.month) reasons.push(`date: ${parsed.dateRange.label || "range"}`);
      if (matched.length) reasons.push(`matched: ${[...new Set(matched)].join(", ")}`);

      return { email, score, reasons, matched };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.email.receivedAt.getTime() - a.email.receivedAt.getTime());

  const max = scored[0]?.score || 1;
  return {
    parsed,
    results: scored.map((item) => ({ ...item, score: item.score / max }))
  };
}

export function searchChips(parsed) {
  const chips = [];
  if (parsed.categories.length) chips.push({ label: "Category", value: parsed.categories.join(" or ") });
  if (parsed.sender) chips.push({ label: "Sender", value: parsed.sender });
  if (parsed.month) chips.push({ label: "Month", value: parsed.month });
  if (parsed.dateRange && !parsed.month) chips.push({ label: "Date", value: parsed.dateRange.label || "range" });
  if (parsed.keywords.length) chips.push({ label: "Keywords", value: parsed.keywords.join(", ") });
  if (parsed.phrases.length) chips.push({ label: "Phrase", value: parsed.phrases.join(", ") });
  if (parsed.unread) chips.push({ label: "State", value: "unread" });
  if (parsed.awaiting) chips.push({ label: "State", value: "awaiting reply" });
  return chips;
}
