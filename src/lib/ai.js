import { CATEGORIES, CATEGORY_BY_ID } from "./triage.js";
import { TRAINING_SAMPLES } from "./ai-training.js";

const CATEGORY_IDS = CATEGORIES.map((category) => category.id);
const DAY_MS = 24 * 60 * 60 * 1000;

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves`.split(
    /\s+/
  )
);

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

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

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
/*  Multinomial Naive Bayes                                           */
/* ------------------------------------------------------------------ */

export function trainNaiveBayes(samples) {
  const classDocs = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0]));
  const tokenCounts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, Object.create(null)]));
  const tokenTotals = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0]));
  const vocabulary = new Set();

  for (const sample of samples) {
    const tokens = tokenize(sample.text);
    classDocs[sample.category] += 1;
    for (const token of tokens) {
      tokenCounts[sample.category][token] = (tokenCounts[sample.category][token] || 0) + 1;
      tokenTotals[sample.category] += 1;
      vocabulary.add(token);
    }
  }

  const totalDocs = samples.length;
  const vocabSize = Math.max(1, vocabulary.size);

  function predict(text) {
    const tokens = tokenize(text);
    const known = tokens.filter((token) => vocabulary.has(token));
    const logScores = {};

    for (const id of CATEGORY_IDS) {
      let score = Math.log((classDocs[id] + 1) / (totalDocs + CATEGORY_IDS.length));
      for (const token of known) {
        const count = tokenCounts[id][token] || 0;
        score += Math.log((count + 1) / (tokenTotals[id] + vocabSize));
      }
      logScores[id] = score;
    }

    const probabilities = softmax(logScores);
    const ranked = CATEGORY_IDS.map((id) => ({
      id,
      label: CATEGORY_BY_ID[id].label,
      probability: probabilities[id]
    })).sort((a, b) => b.probability - a.probability);

    const predicted = ranked[0].id;
    const topTerms = rankTerms(known, predicted, tokenCounts, tokenTotals, vocabSize);

    return {
      predicted,
      predictedLabel: CATEGORY_BY_ID[predicted].label,
      probabilities,
      ranked,
      topTerms,
      knownTokens: known.length,
      confidence: ranked[0].probability
    };
  }

  return { predict, vocabulary, vocabSize, classDocs, samples: totalDocs };
}

function rankTerms(tokens, predicted, tokenCounts, tokenTotals, vocabSize) {
  const unique = [...new Set(tokens)];
  const scores = new Map();

  for (const token of unique) {
    const predictedLog = Math.log((tokenCounts[predicted][token] || 0) + 1);
    const predictedDenominator = Math.log(tokenTotals[predicted] + vocabSize);
    const own = predictedLog - predictedDenominator;

    let bestOther = -Infinity;
    for (const id of CATEGORY_IDS) {
      if (id === predicted) continue;
      const other = Math.log((tokenCounts[id][token] || 0) + 1) - Math.log(tokenTotals[id] + vocabSize);
      if (other > bestOther) bestOther = other;
    }

    scores.set(token, own - bestOther);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([term, weight]) => ({ term, weight: Number(weight.toFixed(2)) }));
}

function softmax(scores) {
  const values = Object.values(scores);
  const max = Math.max(...values);
  const exps = Object.fromEntries(Object.entries(scores).map(([id, value]) => [id, Math.exp(value - max)]));
  const sum = Object.values(exps).reduce((total, value) => total + value, 0) || 1;
  return Object.fromEntries(Object.entries(exps).map(([id, value]) => [id, value / sum]));
}

export const MODEL = trainNaiveBayes(TRAINING_SAMPLES);
export const MODEL_METRICS = crossValidate(TRAINING_SAMPLES);
export const MODEL_INFO = {
  name: "Multinomial Naive Bayes",
  samples: TRAINING_SAMPLES.length,
  vocabSize: MODEL.vocabSize,
  classes: CATEGORY_IDS.length,
  metrics: MODEL_METRICS
};

export function crossValidate(samples, folds = 5) {
  const predictions = [];

  for (let fold = 0; fold < folds; fold += 1) {
    const training = samples.filter((_, index) => index % folds !== fold);
    const testing = samples.filter((_, index) => index % folds === fold);
    const model = trainNaiveBayes(training);
    for (const sample of testing) {
      predictions.push({
        expected: sample.category,
        predicted: model.predict(sample.text).predicted
      });
    }
  }

  return metricsFromPredictions(predictions);
}

function metricsFromPredictions(predictions) {
  const perClass = {};

  for (const label of CATEGORY_IDS) {
    const truePositive = predictions.filter((item) => item.expected === label && item.predicted === label).length;
    const falsePositive = predictions.filter((item) => item.expected !== label && item.predicted === label).length;
    const falseNegative = predictions.filter((item) => item.expected === label && item.predicted !== label).length;
    const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0;
    const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[label] = {
      precision,
      recall,
      f1,
      support: truePositive + falseNegative
    };
  }

  const correct = predictions.filter((item) => item.expected === item.predicted).length;
  const macroF1 = CATEGORY_IDS.reduce((total, label) => total + perClass[label].f1, 0) / CATEGORY_IDS.length;

  return {
    accuracy: predictions.length ? correct / predictions.length : 0,
    macroF1,
    perClass,
    total: predictions.length
  };
}

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
  const text = `${email.from?.name || ""} ${email.from?.email || ""} ${email.subject || ""} ${email.body || ""}`;
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
