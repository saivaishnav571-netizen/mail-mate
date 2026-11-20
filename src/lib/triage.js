import { cleanEmailText, extractEntities } from "./text.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const CATEGORIES = [
  { id: "important", label: "Important", short: "Important", color: "#c4491f" },
  { id: "academic", label: "Academic", short: "Academic", color: "#236a65" },
  { id: "internship", label: "Internship", short: "Internship", color: "#986817" },
  { id: "personal", label: "Personal", short: "Personal", color: "#4e7044" },
  { id: "spam", label: "Spam", short: "Spam", color: "#767168" }
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((category) => [category.id, category]));

const RULES = {
  spam: {
    "you have won": 6,
    "gift card": 5,
    "wire transfer": 5,
    "invoice attached": 5,
    "redelivery fee": 5,
    "parcel is held": 5,
    "risk-free": 5,
    crypto: 4,
    bitcoin: 4,
    "act now": 4,
    prize: 4,
    lottery: 4,
    "verify your": 3.5,
    "verify payment": 3.5,
    "click here": 3,
    "limited time": 3,
    "grow your audience": 3,
    guaranteed: 3,
    "10x": 2.5,
    confidential: 2.5,
    selected: 2,
    unsubscribe: 2,
    exclusive: 1.5,
    webinar: 1.5,
    "no-reply": 0.5
  },
  internship: {
    internship: 6,
    intern: 4,
    "offer letter": 5,
    recruiter: 4,
    "graduate scheme": 4,
    interview: 3.5,
    "talent team": 3,
    "people ops": 2.5,
    application: 2,
    "portfolio link": 2.5,
    portfolio: 1.5,
    availability: 2,
    hiring: 2,
    role: 0.75
  },
  academic: {
    assignment: 5,
    seminar: 4.5,
    exam: 4.5,
    "group project": 4,
    "course reader": 4,
    professor: 4,
    "literature review": 3.5,
    lecture: 3,
    course: 3,
    module: 3,
    university: 3,
    thesis: 3,
    timetable: 3,
    rubric: 3,
    submission: 2.5,
    submit: 1.5,
    campus: 2,
    tutorial: 2,
    student: 1.5,
    library: 1.5,
    draft: 1
  },
  personal: {
    dinner: 5,
    birthday: 5,
    "flat viewing": 5,
    hike: 3.5,
    photos: 3,
    mum: 3,
    dad: 3,
    friend: 3,
    family: 3,
    "are you free": 3,
    "catch up": 2.5,
    "talk soon": 2,
    weekend: 2,
    "let me know": 1.5,
    "shared album": 1.5,
    table: 0.75
  },
  important: {
    budget: 4,
    contract: 4,
    invoice: 4,
    legal: 4,
    facilities: 4,
    "building pass": 5,
    passport: 4,
    visa: 4,
    forecast: 3.5,
    finance: 3.5,
    maintenance: 3.5,
    overdue: 3.5,
    offsite: 3,
    manager: 3,
    payment: 3,
    "board pack": 4,
    "action required": 3,
    appointment: 2.5,
    "people ops": 1.5,
    access: 2,
    deadline: 2,
    headcount: 2,
    signature: 2,
    sign: 1.5,
    urgent: 1.5,
    team: 1,
    session: 0.5
  }
};

const TERM_MATCHERS = Object.fromEntries(
  Object.entries(RULES).map(([category, rules]) => [
    category,
    Object.entries(rules).map(([term, weight]) => ({
      term,
      weight,
      matcher: new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}(?=$|[^a-z0-9])`, "i")
    }))
  ])
);

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

const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const MONTH_PATTERN = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_PATTERN = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday)";
const DEADLINE_CUE = /\b(by|before|due|deadline|until|within|no later than|send|submit|sign|pay|choose|confirm|check|collect|book|reply|respond|return|upload|complete)\b/i;

/**
 * Turn loosely-shaped email data into one shape the rest of the demo can use.
 * Missing optional fields stay empty rather than being silently invented.
 */
function parseAddress(value) {
  if (!value) return { name: "", email: "" };
  if (typeof value === "string") {
    const email = value.match(/<([^>]+)>/)?.[1] || value;
    const name = value.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim();
    return { name: name || email, email: email.trim() };
  }
  return {
    name: String(value.name || value.email || "").trim(),
    email: String(value.email || "").trim()
  };
}

function normalizeRecipients(raw) {
  const value = raw.to || raw.recipient || raw.recipients || [];
  const list = Array.isArray(value) ? value : String(value).includes(",") ? String(value).split(",") : [value];
  return list
    .map(parseAddress)
    .filter((person) => person.email)
    .map((person) => ({ name: person.name || person.email, email: person.email }));
}

function normalizeAttachments(raw) {
  if (!Array.isArray(raw.attachments)) return [];
  return raw.attachments
    .map((attachment) => {
      if (typeof attachment === "string") return { name: attachment, type: "", size: 0, text: "" };
      return {
        name: String(attachment.name || attachment.filename || "attachment"),
        type: String(attachment.type || attachment.mime || ""),
        size: Number(attachment.size) || 0,
        text: String(attachment.text || "")
      };
    })
    .filter((attachment) => attachment.name);
}

export function normalizeEmail(raw, index = 0) {
  const from = raw.from || raw.sender || {};
  const fromName =
    typeof from === "string"
      ? from.replace(/<[^>]+>/g, "").trim() || "Unknown sender"
      : String(from.name || raw.fromName || "").trim() || "Unknown sender";
  const fromEmail =
    typeof from === "string"
      ? (from.match(/<([^>]+)>/)?.[1] || from).trim()
      : String(from.email || raw.fromEmail || "").trim();

  const body = cleanEmailText(String(raw.body || raw.text || raw.message || ""));

  return {
    id: String(raw.id || `mail-${index + 1}`),
    from: {
      name: fromName,
      email: fromEmail
    },
    to: normalizeRecipients(raw),
    subject: String(raw.subject || raw.title || "Untitled message").trim(),
    body,
    receivedAt: toValidDate(raw.receivedAt || raw.date || raw.sentAt, index),
    read: Boolean(raw.read),
    direction: raw.direction === "outgoing" ? "outgoing" : "incoming",
    threadId: String(raw.thread_id || raw.threadId || "").trim() || null,
    attachments: normalizeAttachments(raw),
    entities: extractEntities(`${raw.subject || ""}\n${body}`),
    source: raw.source || "dataset"
  };
}

export function classifyEmail(email) {
  const haystack = `${email.from.name} ${email.from.email} ${email.subject} ${email.body}`.toLowerCase();
  const scores = Object.fromEntries(CATEGORIES.map(({ id }) => [id, 0]));
  const matches = Object.fromEntries(CATEGORIES.map(({ id }) => [id, []]));

  for (const [category, terms] of Object.entries(TERM_MATCHERS)) {
    for (const { term, weight, matcher } of terms) {
      if (matcher.test(haystack)) {
        scores[category] += weight;
        matches[category].push(term);
      }
    }
  }

  const domain = email.from.email.toLowerCase();
  if (/\.ac\.[a-z.]+$|\.edu$|university/.test(domain)) {
    scores.academic += 4;
    matches.academic.unshift("sender is a university");
  }
  if (/careers?|talent|recruit|hiring/.test(domain)) {
    scores.internship += 2.5;
    matches.internship.unshift("sender works in recruitment");
  }

  // Spam is deliberately conservative: generic marketing words such as
  // "exclusive", "selected", "webinar", "unsubscribe", or "invoice" alone
  // are not enough to send legitimate mail to Spam.
  const strongSpamSignals = new Set([
    "you have won", "gift card", "wire transfer", "redelivery fee",
    "parcel is held", "risk-free", "crypto", "bitcoin", "act now",
    "prize", "lottery", "verify payment", "guaranteed", "10x"
  ]);
  const strongSpamCount = matches.spam.filter((term) => strongSpamSignals.has(term)).length;
  const legitimateContext = scores.academic > 0 || scores.internship > 0 ||
    scores.personal > 0 || matches.important.length > 0;
  const spamIsSupported = scores.spam >= 7 &&
    (strongSpamCount >= 2 || strongSpamCount >= 1) &&
    scores.spam >= Math.max(scores.academic, scores.internship, scores.personal, scores.important) + 1.5;

  if (scores.spam > 0 && !spamIsSupported) {
    // Keep weak spam cues visible to the explanation but lower the category
    // score so one generic term cannot dominate the prediction.
    scores.spam *= legitimateContext ? 0.35 : 0.6;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [winner, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;
  const category = topScore > 0 ? winner : "important";
  const margin = topScore - secondScore;
  const evidenceCount = (matches[category] || []).length;
  const confidence =
    topScore > 0
      ? Math.round(Math.min(0.92, Math.max(0.4,
          0.48 + 0.28 * (margin / (topScore + 1)) + 0.04 * Math.min(4, evidenceCount)
        )) * 100)
      : 36;

  const reasons = (matches[category] || []).slice(0, 4).map(readableMatch);
  if (!reasons.length) reasons.push("No strong keyword signals; placed in Important for a human check.");
  if (category === "spam" && !spamIsSupported) {
    reasons.unshift("Spam signals are weak; this message may need review.");
  }

  return {
    category,
    categoryLabel: CATEGORY_BY_ID[category].label,
    confidence,
    scores,
    reasons,
    source: "rules"
  };
}

export function extractDeadline(text, reference = new Date()) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;

  const today = startOfDay(reference);
  const candidates = [];
  const covered = [];

  for (const match of clean.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day, 17, 0, 0, 0);
    if (date.getMonth() !== month || date.getDate() !== day) continue;
    const time = readTime(clean, match.index + match[0].length + 1);
    const context = contextAround(clean, match.index);
    const candidate = makeDeadlineCandidate(date, time, match.index, match[0], context);
    candidate.score += 1;
    candidates.push(candidate);
    covered.push([match.index, match.index + match[0].length]);
  }

  const fullDateRegex = new RegExp(`\\b(?:${WEEKDAY_PATTERN}\\s+)?(\\d{1,2})\\s+${MONTH_PATTERN}(?:\\s+(\\d{4}))?`, "gi");
  const monthFirstRegex = new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, "gi");

  for (const match of clean.matchAll(fullDateRegex)) {
    const weekday = match[1] && WEEKDAYS[match[1].toLowerCase()] !== undefined ? match[1] : null;
    const day = Number(weekday ? match[2] : match[1]);
    const monthToken = (weekday ? match[3] : match[2]).toLowerCase();
    const yearToken = weekday ? match[4] : match[3];
    const month = MONTHS[monthToken];
    if (month === undefined || !Number.isFinite(day)) continue;
    const date = buildDate(day, month, yearToken, today);
    if (!date) continue;
    const time = readTime(clean, match.index + match[0].length + 1);
    const context = contextAround(clean, match.index);
    candidates.push(makeDeadlineCandidate(date, time, match.index, match[0], context));
    covered.push([match.index, match.index + match[0].length]);
  }

  for (const match of clean.matchAll(monthFirstRegex)) {
    if (isCovered(match.index, covered)) continue;
    const monthToken = match[1].toLowerCase();
    const day = Number(match[2]);
    const yearToken = match[3];
    const month = MONTHS[monthToken];
    if (month === undefined || !Number.isFinite(day)) continue;
    const date = buildDate(day, month, yearToken, today);
    if (!date) continue;
    const time = readTime(clean, match.index + match[0].length + 1);
    const context = contextAround(clean, match.index);
    candidates.push(makeDeadlineCandidate(date, time, match.index, match[0], context));
    covered.push([match.index, match.index + match[0].length]);
  }

  for (const match of clean.matchAll(new RegExp(`\\b${WEEKDAY_PATTERN}\\b`, "gi"))) {
    if (isCovered(match.index, covered)) continue;
    const targetDay = WEEKDAYS[match[1].toLowerCase()];
    let ahead = (targetDay - today.getDay() + 7) % 7;
    if (ahead === 0 && reference.getHours() >= 17) ahead = 7;
    const date = new Date(today);
    date.setDate(date.getDate() + ahead);
    const time = readTime(clean, match.index + match[0].length + 1);
    const context = contextAround(clean, match.index);
    candidates.push(makeDeadlineCandidate(date, time, match.index, match[0], context));
  }

  const relativePatterns = [
    { regex: /\btonight\b/i, hours: 22, minutes: 0, days: 0, source: "tonight" },
    { regex: /\btomorrow\b/i, hours: 17, minutes: 0, days: 1, source: "tomorrow" },
    { regex: /\btoday\b/i, hours: 17, minutes: 0, days: 0, source: "today" },
    { regex: /\bwithin\s+(\d{1,3})\s+hours?\b/i, relativeHours: true },
    { regex: /\bwithin\s+(\d{1,3})\s+days?\b/i, relativeDays: true },
    { regex: /\bnext week\b/i, nextWeek: true, source: "next week" }
  ];

  for (const pattern of relativePatterns) {
    const match = clean.match(pattern.regex);
    if (!match || match.index === undefined) continue;
    let date;
    if (pattern.relativeHours) {
      date = new Date(reference.getTime() + Number(match[1]) * 60 * 60 * 1000);
    } else if (pattern.relativeDays) {
      date = new Date(reference.getTime() + Number(match[1]) * DAY_MS);
    } else if (pattern.nextWeek) {
      date = startOfDay(reference);
      const ahead = (8 - date.getDay()) % 7 || 7;
      date.setDate(date.getDate() + ahead);
      date.setHours(9, 0, 0, 0);
    } else {
      date = startOfDay(reference);
      date.setDate(date.getDate() + pattern.days);
      const time = readTime(clean, match.index + match[0].length + 1);
      date.setHours(time.hour, time.minute, 0, 0);
    }
    const context = contextAround(clean, match.index);
    candidates.push(makeDeadlineCandidate(date, readTime(clean, match.index + match[0].length + 1), match.index, match[0], context));
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  const best = candidates[0];
  return {
    date: best.date,
    iso: best.date.toISOString(),
    label: formatDeadline(best.date, reference),
    source: best.source,
    hasTime: best.hasTime
  };
}

export function extractActions(text) {
  const clean = String(text || "")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  const actions = [];
  const seen = new Set();

  for (const sentence of sentences) {
    const variants = [];
    const explicit = sentence.match(
      /\b(?:please|kindly|can you|could you|would you|need to|needs to|have to|has to|you can|make sure to|make sure|remember to|don't forget to|do not forget to|be sure to)\s+(.+)/i
    );
    if (explicit) variants.push(explicit[1]);

    const imperative = sentence.match(
      /^\s*(submit|send|review|confirm|upload|sign|pay|book|reply|register|check|read|prepare|bring|choose|collect|save|log out|update|complete|attend|renew|download|fill|return|email|call|share|add|remove|verify)\b[^.!?]*/i
    );
    if (imperative) variants.push(imperative[0]);

    const conditional = sentence.match(
      /,\s*(reply|send|email|confirm|update|check|submit|book|call|bring|read|sign|pay|upload|register|return|share)\b[^.!?]*/i
    );
    if (conditional) variants.push(conditional[0].replace(/^,\s*/, ""));

    const softened = sentence.match(
      /\b(?:but|then|and)\s+(submit|send|review|confirm|upload|sign|pay|book|reply|register|check|read|prepare|bring|choose|collect|save|update|complete|attend|renew|download|fill|return|email|call|share)\b[^.!?]*/i
    );
    if (softened) variants.push(softened[0].replace(/^(?:but|then|and)\s+/i, ""));

    for (const variant of variants) {
      const action = cleanAction(variant);
      const key = action.toLowerCase();
      if (action.length >= 3 && !seen.has(key)) {
        seen.add(key);
        actions.push(action);
      }
      if (actions.length >= 4) return actions;
    }
  }

  return actions;
}

export function buildReply(email, analysis, profile = {}) {
  if (analysis.category === "spam") return null;

  const name = firstName(email.from.name);
  const action = analysis.actions[0] ? lowerFirst(analysis.actions[0]) : null;
  const deadline = analysis.deadline?.label || null;
  const signature = profile.name || "Alex";
  const actionLine = action
    ? `I’ll ${action}${deadline ? ` by ${deadline}` : ""}.`
    : deadline
      ? `I’ll come back to you by ${deadline}.`
      : "I’ll take a look and come back to you.";
  const closing = deadline
    ? "If anything changes, I’ll let you know."
    : "Thanks for the note.";

  if (analysis.category === "academic") {
    return `Hi ${name},

Thanks for the details. ${actionLine}

I’ll check the portal for any updates as well.

Best,
${signature}`;
  }

  if (analysis.category === "internship") {
    return `Hi ${name},

Thank you for the update. ${actionLine} Please let me know if you need anything else from me.

Best,
${signature}`;
  }

  if (analysis.category === "personal") {
    return `Hi ${name},

Thanks for the note. ${actionLine} ${closing}

Talk soon,
${signature}`;
  }

  return `Hi ${name},

Thanks for the note. ${actionLine} I’ll confirm once it’s done.

${closing}

Best,
${signature}`;
}

export function createReminder(email, analysis, reference = new Date()) {
  if (analysis.category === "spam") return null;
  if (!analysis.deadline && !analysis.actions.length) return null;

  const deadline = analysis.deadline?.date || null;
  let dueAt;

  if (deadline) {
    const hoursUntil = (deadline.getTime() - reference.getTime()) / (60 * 60 * 1000);
    dueAt = new Date(deadline.getTime() - (hoursUntil < 48 ? 2 : 24) * 60 * 60 * 1000);
  } else {
    dueAt = startOfDay(reference);
    dueAt.setDate(dueAt.getDate() + 1);
    dueAt.setHours(9, 0, 0, 0);
  }

  if (dueAt.getTime() < reference.getTime()) {
    dueAt = new Date(reference.getTime() + 30 * 60 * 1000);
  }

  return {
    id: `rem-${email.id}`,
    emailId: email.id,
    subject: email.subject,
    label: analysis.actions[0] || `Check ${email.subject.toLowerCase()}`,
    dueAt: dueAt.toISOString(),
    createdAt: reference.toISOString(),
    done: false,
    auto: true
  };
}

export function triageEmail(rawEmail, reference = new Date(), profile = {}) {
  const email = rawEmail.id && rawEmail.triage ? rawEmail : normalizeEmail(rawEmail);
  const analysis = classifyEmail(email);
  const deadline = extractDeadline(`${email.subject}. ${email.body}`, reference);
  const actions = extractActions(email.body);
  const reply = buildReply(email, { ...analysis, deadline, actions }, profile);
  const reminder = createReminder(email, { ...analysis, deadline, actions }, reference);

  return {
    ...email,
    analysis: { ...analysis, deadline, actions },
    deadline,
    actions,
    reply,
    reminder
  };
}

export function countByCategory(emails) {
  const counts = Object.fromEntries(CATEGORIES.map(({ id }) => [id, 0]));
  for (const email of emails) {
    const category = email.analysis?.category || email.category;
    if (counts[category] !== undefined) counts[category] += 1;
  }
  return counts;
}

export function formatDeadline(date, reference = new Date()) {
  if (!date) return "";
  const referenceDay = startOfDay(reference);
  const targetDay = startOfDay(date);
  const diff = Math.round((targetDay - referenceDay) / DAY_MS);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
    .format(date)
    .toLowerCase()
    .replace(" ", " ");

  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== reference.getFullYear() ? { year: "numeric" } : {})
  }).format(date);
  return `${day}, ${time}`;
}

export function formatReceived(date, reference = new Date()) {
  if (!date) return "";
  const diff = reference.getTime() - date.getTime();
  if (diff >= 0 && diff < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.floor(diff / 60000));
    return `${minutes} min ago`;
  }
  const sameDay = startOfDay(date).getTime() === startOfDay(reference).getTime();
  if (sameDay) {
    return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  }
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

export function formatReminderWhen(date, reference = new Date()) {
  if (!date) return "";
  return formatDeadline(date, reference);
}

function makeDeadlineCandidate(date, time, index, source, context) {
  const hasTime = time.explicit;
  const result = new Date(date);
  result.setHours(time.hour, time.minute, 0, 0);
  let score = 0;
  if (DEADLINE_CUE.test(context)) score += 3;
  if (hasTime) score += 1;
  if (/\b(no later than|deadline)\b/i.test(context)) score += 1;
  return { date: result, index, source, score, hasTime };
}

function readTime(text, fromIndex) {
  const slice = text.slice(fromIndex, fromIndex + 55);
  const match = slice.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || slice.match(/\b(?:at\s+)(\d{1,2}):(\d{2})\b/i);
  if (!match) return { hour: 17, minute: 0, explicit: false };

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = (match[3] || "").toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return { hour: 17, minute: 0, explicit: false };
  return { hour, minute, explicit: true };
}

function buildDate(day, month, yearToken, reference) {
  if (day < 1 || day > 31) return null;
  let year = yearToken ? Number(yearToken) : reference.getFullYear();
  let date = new Date(year, month, day, 17, 0, 0, 0);
  if (!yearToken && date.getTime() < reference.getTime() - DAY_MS) {
    year += 1;
    date = new Date(year, month, day, 17, 0, 0, 0);
  }
  if (date.getMonth() !== month) return null;
  return date;
}

function contextAround(text, index) {
  return text.slice(Math.max(0, index - 70), index);
}

function isCovered(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index <= end);
}

function cleanAction(value) {
  let action = String(value)
    .replace(/^[\s,:;-]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();
  action = action.replace(/\s+(?:before|by)\s+then\b.*$/i, "").trim();
  action = action.replace(/\s+(?:so|and)\s+(?:I|we)\s+(?:can|will)\b.*$/i, "").trim();
  action = action.replace(/^(?:that|to)\s+/i, "");
  if (!action) return "";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function firstName(name) {
  const cleaned = String(name || "there")
    .replace(/^(dr|prof|professor|mr|mrs|ms|mx)\.?\s+/i, "")
    .trim();
  if (!cleaned) return "there";
  if (/^[A-Z][a-z]+(?:\s+Ops|\s+Team)$/.test(cleaned)) return cleaned;
  return cleaned.split(/\s+/)[0];
}

function lowerFirst(value) {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function readableMatch(match) {
  if (match.includes("sender ")) return match;
  return `Mentions “${match}”`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toValidDate(value, index) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date();
    fallback.setMinutes(fallback.getMinutes() - index);
    return fallback;
  }
  return date;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

