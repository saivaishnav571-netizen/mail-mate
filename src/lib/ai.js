import { CATEGORIES, CATEGORY_BY_ID, buildReply, createReminder } from "./triage.js";
import { TRAINING_SAMPLES } from "./ai-training.js";
import { ML_MODEL, ML_METRICS, ML_MODEL_INFO, trainLogisticRegression, crossValidate } from "./ml.js";
import { attachThreads, formatThreadDate } from "./threads.js";
import { tokenize } from "./text.js";

const CATEGORY_IDS = CATEGORIES.map((category) => category.id);
const DAY_MS = 24 * 60 * 60 * 1000;
const MODEL_CONFIDENCE_FLOOR = 0.45;

const POSITIVE_TERMS = new Set(
  `thank thanks thankful appreciate appreciated great good lovely happy glad wonderful excited welcome pleased enjoy hope free treat favourite favorite congratulations congrats nice perfect brilliant excellent fun`.split(
    /\s+/
  )
);

const NEGATIVE_TERMS = new Set(
  `unfortunately overdue problem problems issue issues cannot late missing urgent failed failure error errors complaint sorry delay delayed penalty expired rejected wrong concern concerns risk risks unavailable blocked declined dispute`.split(
    /\s+/
  )
);

const URGENT_TERMS = new Set(
  `urgent urgently asap immediately deadline overdue final notice today tonight tomorrow required action expires expiring last chance within hours cutoff`.split(
    /\s+/
  )
);

const DEADLINE_CUE = /\b(by|before|due|deadline|until|within|no later than|send|submit|sign|pay|confirm|check|collect|book|reply|respond|return|upload|complete|renew)\b/i;

/* ------------------------------------------------------------------ */
/*  Text features                                                     */
/* ------------------------------------------------------------------ */

export { tokenize };

function vectorize(tokens, idf) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const total = tokens.length || 1;
  const vector = new Map();
  let length = 0;

  for (const [token, count] of counts) {
    const value = (count / total) * idf(token);
    vector.set(token, value);
    length += value * value;
  }

  const norm = Math.sqrt(length) || 1;
  for (const [token, value] of vector) {
    vector.set(token, value / norm);
  }
  return vector;
}

function dot(a, b) {
  if (!a.size || !b.size) return 0;
  let total = 0;
  for (const [token, value] of a) {
    total += value * (b.get(token) || 0);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/*  Trained classifier                                                */
/* ------------------------------------------------------------------ */

export const MODEL = ML_MODEL;
export const MODEL_METRICS = ML_METRICS;
export const MODEL_INFO = ML_MODEL_INFO;

export { trainLogisticRegression, crossValidate };

export function classifyText(text) {
  const prediction = MODEL.predict(text);
  return {
    ...prediction,
    labels: prediction.ranked.map((item) => ({
      id: item.id,
      label: item.label,
      probability: item.probability
    }))
  };
}

/* ------------------------------------------------------------------ */
/*  Sentiment, summary and priority                                   */
/* ------------------------------------------------------------------ */

export function analyzeSentiment(text) {
  const raw = String(text || "");
  const clean = raw.toLowerCase();
  const tokens = tokenize(clean);

  const positive = tokens.filter((token) => POSITIVE_TERMS.has(token));
  const negative = tokens.filter((token) => NEGATIVE_TERMS.has(token));
  const urgent = tokens.filter((token) => URGENT_TERMS.has(token));
  const exclamations = (clean.match(/!/g) || []).length;
  const caps = (raw.match(/\b[A-Z]{3,}\b/g) || []).length;
  const deadlineCue = DEADLINE_CUE.test(clean) ? 8 : 0;

  const urgency = Math.min(100, Math.round(urgent.length * 17 + exclamations * 6 + caps * 4 + deadlineCue));
  const polarity = Math.max(-1, Math.min(1, (positive.length - negative.length) / (positive.length + negative.length + 2)));

  let label = "Neutral";
  if (urgency >= 65) label = "Urgent";
  else if (polarity <= -0.18) label = "Negative";
  else if (polarity >= 0.18) label = "Positive";

  return {
    polarity: Number(polarity.toFixed(2)),
    label,
    urgency,
    positive: [...new Set(positive)].slice(0, 4),
    negative: [...new Set(negative)].slice(0, 4),
    urgent: [...new Set(urgent)].slice(0, 4)
  };
}

export function summarizeEmail(email) {
  const body = String(email?.body || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return "No body text to summarise.";

  const sentences = (body.match(/[^.!?]+[.!?]?/g) || [body])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 2);

  if (sentences.length <= 2) return sentences.join(" ");

  const frequency = new Map();
  for (const token of tokenize(body)) {
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  const maxFrequency = Math.max(...frequency.values(), 1);

  const scored = sentences.map((sentence, index) => {
    const tokens = tokenize(sentence);
    const keyword = tokens.reduce((total, token) => total + (frequency.get(token) || 0) / maxFrequency, 0) / Math.sqrt(tokens.length || 1);
    const position = index === 0 ? 2.4 : index === sentences.length - 1 ? 0.4 : 0;
    const cue = DEADLINE_CUE.test(sentence) ? 1.1 : 0;
    const length = tokens.length >= 6 && tokens.length <= 34 ? 0.4 : 0;
    return { sentence, index, score: keyword + position + cue + length };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence)
    .join(" ");
}

export function scorePriority(email, prediction, sentiment, reference = new Date()) {
  const category = email.analysis?.category || "important";
  const factors = [];

  if (category === "spam") {
    return {
      score: 4,
      band: "Filtered",
      bandClass: "filtered",
      factors: [{ label: "Spam model", points: -18, detail: "Kept out of the reply queue" }]
    };
  }

  let score = 0;

  if (email.deadline?.date) {
    const hours = (email.deadline.date.getTime() - reference.getTime()) / (60 * 60 * 1000);
    let points = 7;
    let detail = "Due later";
    if (hours < 0) {
      points = 32;
      detail = "Deadline has passed";
    } else if (hours <= 24) {
      points = 28;
      detail = "Due within 24 hours";
    } else if (hours <= 48) {
      points = 22;
      detail = "Due within 48 hours";
    } else if (hours <= 168) {
      points = 14;
      detail = "Due this week";
    }
    score += points;
    factors.push({ label: "Deadline", points, detail });
  }

  const categoryPoints = { important: 18, internship: 14, academic: 12, personal: 6 }[category] || 0;
  score += categoryPoints;
  factors.push({ label: "Bucket", points: categoryPoints, detail: `${CATEGORY_BY_ID[category].label} mail` });

  const actions = email.analysis?.actions?.length || 0;
  const actionPoints = Math.min(3, actions) * 6;
  if (actionPoints) {
    score += actionPoints;
    factors.push({ label: "Actions", points: actionPoints, detail: `${actions} next action${actions === 1 ? "" : "s"}` });
  }

  const urgencyPoints = Math.round((sentiment.urgency / 100) * 18);
  if (urgencyPoints) {
    score += urgencyPoints;
    factors.push({ label: "Tone", points: urgencyPoints, detail: `Urgency ${sentiment.urgency}/100` });
  }

  if (!email.read) {
    score += 4;
    factors.push({ label: "Unread", points: 4, detail: "Not opened yet" });
  }

  if (prediction && prediction.predicted === category && prediction.confidence >= 0.5) {
    score += 4;
    factors.push({ label: "Model", points: 4, detail: "Classifier agrees with the bucket" });
  }

  if (email.replied) {
    score -= 25;
    factors.push({ label: "Replied", points: -25, detail: "Already handled" });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = score >= 80 ? "Critical" : score >= 60 ? "High" : score >= 40 ? "Medium" : "Low";
  const bandClass = band.toLowerCase();

  factors.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return {
    score,
    band,
    bandClass,
    factors: factors.slice(0, 4)
  };
}

/* ------------------------------------------------------------------ */
/*  Per-email enrichment                                              */
/* ------------------------------------------------------------------ */

export function analyzeEmailAI(email, reference = new Date()) {
  // Email subjects often contain the strongest intent signal (e.g.
  // "Interview scheduled", "Assignment due", "Payment required"). Give the
  // subject modest extra weight without allowing sender identity to dominate.
  const subject = String(email.subject || "").trim();
  const sender = `${email.from?.name || ""} ${email.from?.email || ""}`;
  const text = `${sender} ${subject} ${subject} ${email.body || ""}`;
  const prediction = MODEL.predict(text);
  const sentiment = analyzeSentiment(email.body);
  const summary = summarizeEmail(email);
  const priority = scorePriority(email, prediction, sentiment, reference);
  const category = email.analysis?.category || "important";
  const agreement = prediction.predicted === category;
  const categoryProbability = Math.round((prediction.probabilities[category] || 0) * 100);
  const ensembleConfidence = Math.round(
    0.55 * (email.analysis?.confidence || 50) + 0.45 * (prediction.probabilities[category] || 0) * 100
  );

  return {
    model: {
      ...prediction,
      agreement,
      categoryProbability,
      ensembleConfidence
    },
    sentiment,
    summary,
    priority
  };
}

/* ------------------------------------------------------------------ */
/*  Thread intelligence                                               */
/* ------------------------------------------------------------------ */

/**
 * Build a thread summary from the actual messages. The classifier and
 * sentiment model run over the real transcript; the prose is composed from
 * the extractive summaries of the first and last message, so the text is
 * generative over the conversation rather than a hard-coded paragraph.
 */
export function summarizeThreadAI(thread) {
  const transcript = thread.messages
    .map((email) => `${email.subject || ""}. ${email.body || ""}`)
    .join("\n");
  const prediction = MODEL.predict(transcript);
  const sentiment = analyzeSentiment(transcript);
  const names = thread.participants.map((person) => person.name || person.email);
  const first = thread.messages[0];
  const last = thread.messages[thread.messages.length - 1];

  const parts = [
    `${thread.count} message${thread.count === 1 ? "" : "s"} between ${names.join(" and ")}.`,
    `The on-device classifier reads the thread as ${prediction.predictedLabel} (${Math.round(
      prediction.confidence * 100
    )}% confidence) with a ${sentiment.label.toLowerCase()} tone.`,
    `Opening: ${summarizeEmail(first)}`
  ];

  if (last !== first) parts.push(`Latest: ${summarizeEmail(last)}`);
  if (thread.interview?.date) {
    parts.push(`Interview confirmed for ${formatThreadDate(thread.interview.date)}.`);
  }
  if (thread.prep?.length) parts.push(`Preparation: ${thread.prep.join("; ")}.`);

  return {
    text: parts.join(" "),
    engine: `${MODEL_INFO.name} · ${MODEL_INFO.samples} training samples · on-device`
  };
}

export function enrichInbox(emails, reference = new Date()) {
  for (const email of emails) {
    const ai = analyzeEmailAI(email, reference);
    email.ai = ai;
    if (email.analysis) {
      email.analysis.ai = ai.model;
      email.analysis.priority = ai.priority;
      email.analysis.sentiment = ai.sentiment;
      email.analysis.summary = ai.summary;
    }
  }

  const index = buildSearchIndex(emails);
  for (const email of emails) {
    email.ai.similar = findSimilar(index, email, 3);
  }

  attachThreads(emails, { reference, summarize: summarizeThreadAI });

  return emails;
}

/* ------------------------------------------------------------------ */
/*  Semantic search                                                   */
/* ------------------------------------------------------------------ */

export function buildSearchIndex(emails) {
  const documents = emails.map((email) =>
    tokenize(`${email.from?.name || ""} ${email.from?.email || ""} ${email.subject || ""} ${email.body || ""}`)
  );

  const documentFrequency = new Map();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  const idf = (token) => Math.log((1 + documents.length) / (1 + (documentFrequency.get(token) || 0))) + 1;
  const vectors = documents.map((tokens) => vectorize(tokens, idf));
  const vectorById = new Map(emails.map((email, index) => [email.id, vectors[index]]));

  return { emails, vectors, vectorById, idf, documentFrequency };
}

export function semanticSearch(index, query) {
  if (!index) return [];
  const queryVector = vectorize(tokenize(query), index.idf);
  if (!queryVector.size) return [];

  return index.emails
    .map((email, position) => ({
      email,
      score: dot(queryVector, index.vectors[position])
    }))
    .filter((item) => item.score > 0.01)
    .sort((a, b) => b.score - a.score);
}

export function findSimilar(index, email, limit = 3) {
  if (!index) return [];
  const base = index.vectorById.get(email.id);
  if (!base || !base.size) return [];

  return index.emails
    .filter((other) => other.id !== email.id)
    .map((other) => ({
      email: other,
      score: dot(base, index.vectorById.get(other.id) || new Map())
    }))
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/*  Drafts and daily brief                                            */
/* ------------------------------------------------------------------ */

export function rewriteReply(email, tone = "warm") {
  if (email.analysis?.category === "spam") return null;

  const name = firstName(email.from?.name);
  const action = email.analysis?.actions?.[0] ? lowerFirst(email.analysis.actions[0]) : null;
  const deadline = email.deadline?.label || null;
  const signature = "Alex";
  const actionLine = action
    ? `I’ll ${action}${deadline ? ` by ${deadline}` : ""}.`
    : deadline
      ? `I’ll get back to you by ${deadline}.`
      : "I’ll take a look and get back to you.";

  if (tone === "concise") {
    return `Hi ${name},

Noted. ${actionLine}

Thanks,
${signature}`;
  }

  if (tone === "formal") {
    return `Dear ${name},

Thank you for your message. ${actionLine}

Please let me know if you require anything further.

Kind regards,
${signature}`;
  }

  return `Hi ${name},

Thanks so much for the note. ${actionLine} I really appreciate you flagging it.

Best,
${signature}`;
}

export function buildInboxBrief(emails, reference = new Date()) {
  const open = emails.filter((email) => email.analysis?.category !== "spam" && !email.replied);
  const focus = open
    .filter((email) => email.ai?.priority)
    .sort((a, b) => b.ai.priority.score - a.ai.priority.score)
    .slice(0, 5);

  const highPriority = open.filter((email) => email.ai?.priority?.score >= 60).length;
  const dueSoon = open.filter((email) => {
    if (!email.deadline?.date) return false;
    const delta = email.deadline.date.getTime() - reference.getTime();
    return delta >= -DAY_MS && delta <= 2 * DAY_MS;
  }).length;
  const drafts = open.filter((email) => email.reply).length;
  const spam = emails.filter((email) => email.analysis?.category === "spam").length;
  const urgentTone = open.filter(
    (email) => email.ai?.sentiment?.label === "Urgent" || email.ai?.sentiment?.urgency >= 60
  ).length;

  const top = focus[0];
  const lede = top
    ? `${open.length} messages need a person. ${highPriority} are high priority and ${dueSoon} have a deadline inside 48 hours. Start with “${top.subject}” from ${top.from.name}.`
    : `Nothing needs you right now. ${drafts} draft${drafts === 1 ? "" : "s"} are waiting for approval, and ${spam} spam message${spam === 1 ? "" : "s"} are filtered out.`;

  const plan = [];
  if (top) {
    plan.push(`Open “${top.subject}” first — ${top.ai.priority.factors[0]?.detail || "it ranks highest"}.`);
  }
  if (dueSoon) {
    plan.push(`Clear ${dueSoon} deadline${dueSoon === 1 ? "" : "s"} inside 48 hours before starting new work.`);
  }
  plan.push(`Review ${drafts} draft${drafts === 1 ? "" : "s"}; every send still needs your checkbox.`);
  if (urgentTone) {
    plan.push(`Check the tone on ${urgentTone} urgent message${urgentTone === 1 ? "" : "s"} before you reply.`);
  }
  plan.push(`${spam} spam message${spam === 1 ? "" : "s"} kept out of the reply queue.`);

  return {
    lede,
    stats: [
      { label: "Need attention", value: open.length },
      { label: "High priority", value: highPriority },
      { label: "Due in 48h", value: dueSoon },
      { label: "Drafts ready", value: drafts }
    ],
    focus,
    plan,
    spam,
    urgentTone
  };
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                     */
/* ------------------------------------------------------------------ */

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
