import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { triageEmail } from "../src/lib/triage.js";
import {
  MODEL,
  MODEL_METRICS,
  MODEL_INFO,
  classifyText,
  tokenize,
  analyzeSentiment,
  summarizeEmail,
  scorePriority,
  analyzeEmailAI,
  enrichInbox,
  buildSearchIndex,
  semanticSearch,
  findSimilar,
  rewriteReply,
  buildInboxBrief
} from "../src/lib/ai.js";
import { TRAINING_SAMPLES } from "../src/lib/ai-training.js";

const reference = new Date("2026-11-15T09:00:00Z");
const inbox = JSON.parse(readFileSync(new URL("../public/test-inbox.json", import.meta.url), "utf8"));
const analyzed = enrichInbox(
  inbox.map((email) => triageEmail(email, reference, { name: "Alex" })),
  reference
);

test("trains the classifier from the labelled examples", () => {
  assert.equal(TRAINING_SAMPLES.length, 125);
  assert.equal(MODEL.samples, TRAINING_SAMPLES.length);
  assert.equal(MODEL_INFO.classes, 5);
  assert.ok(MODEL.vocabulary.size > 100);
  assert.equal(MODEL_INFO.name, "TF-IDF + Logistic Regression");
});

test("reports honest cross-validation metrics", () => {
  assert.equal(MODEL_METRICS.total, TRAINING_SAMPLES.length);
  assert.ok(MODEL_METRICS.accuracy > 0.75, `accuracy ${MODEL_METRICS.accuracy}`);
  assert.ok(MODEL_METRICS.macroF1 > 0.7, `macro F1 ${MODEL_METRICS.macroF1}`);
  assert.ok(MODEL_METRICS.accuracy <= 1 && MODEL_METRICS.macroF1 <= 1);

  const support = Object.values(MODEL_METRICS.perClass).reduce((total, item) => total + item.support, 0);
  assert.equal(support, TRAINING_SAMPLES.length);
});

test("predicts unseen sentences across all five categories", () => {
  const cases = {
    important: "The invoice is overdue and payment must be sent by Friday.",
    academic: "Submit the coursework assignment through the course portal before the deadline.",
    internship: "We would love to offer you the internship position after your interview.",
    personal: "Are you free for dinner on Saturday? Let me know.",
    spam: "Congratulations, you won a free gift card, click here now!!!"
  };

  for (const [expected, text] of Object.entries(cases)) {
    const result = classifyText(text);
    assert.equal(result.predicted, expected, text);
    assert.equal(result.ranked[0].id, expected);
    assert.ok(result.confidence > 0.4, `${expected} confidence ${result.confidence}`);
  }
});

test("tokenizer lowercases, strips punctuation and drops stopwords", () => {
  const tokens = tokenize("Please upload the BUDGET, before Friday!");
  assert.deepEqual(tokens, ["please", "upload", "budget", "friday"]);
  assert.ok(!tokens.includes("the"));
  assert.ok(!tokens.includes("before"));
  assert.deepEqual(tokenize(""), []);
});

test("scores sentiment and urgency from real wording", () => {
  const positive = analyzeSentiment("Thanks so much, this is great and I appreciate it!");
  assert.equal(positive.label, "Positive");
  assert.ok(positive.polarity > 0);
  assert.ok(positive.positive.includes("thanks"));

  const negative = analyzeSentiment("Unfortunately the payment is overdue and there is a problem.");
  assert.equal(negative.label, "Negative");
  assert.ok(negative.polarity < 0);
  assert.ok(negative.negative.includes("overdue"));

  const urgent = analyzeSentiment("URGENT final notice: action required today before the deadline!!");
  assert.equal(urgent.label, "Urgent");
  assert.equal(urgent.urgency, 100);
  assert.ok(urgent.urgent.includes("urgent"));
});

test("summarises a body and handles empty input", () => {
  const summary = summarizeEmail({
    body: "The budget is due Friday. Please upload the revised figures to the finance drive before then. Also confirm the headcount. Thanks."
  });
  assert.match(summary, /budget is due Friday/i);
  assert.ok(summary.split(".").length <= 4);
  assert.equal(summarizeEmail({ body: "" }), "No body text to summarise.");
});

test("prioritises deadlines, buckets and urgency", () => {
  const finance = analyzed.find((email) => email.id === "finance-budget-01");
  assert.ok(finance.ai.priority.score >= 40);
  assert.ok(["Medium", "High", "Critical"].includes(finance.ai.priority.band));
  assert.ok(finance.ai.priority.factors.some((factor) => factor.label === "Deadline"));

  const spam = analyzed.find((email) => email.analysis.category === "spam");
  assert.equal(spam.ai.priority.score, 4);
  assert.equal(spam.ai.priority.band, "Filtered");

  const sent = analyzeSentiment("URGENT: action required today!");
  const urgentScore = scorePriority(
    {
      read: false,
      analysis: { category: "important", actions: ["Reply"], confidence: 90 },
      deadline: { date: new Date(reference.getTime() + 3 * 60 * 60 * 1000) }
    },
    { predicted: "important", confidence: 0.9 },
    sent,
    reference
  );
  assert.ok(urgentScore.score >= 60, `urgent score ${urgentScore.score}`);
  assert.ok(urgentScore.factors.some((factor) => factor.detail === "Due within 24 hours"));
});

test("enriches every message with model, sentiment, summary and priority", () => {
  for (const email of analyzed) {
    assert.ok(email.ai, email.id);
    assert.ok(email.ai.model.ranked.length === 5, email.id);
    assert.equal(typeof email.ai.model.agreement, "boolean");
    assert.ok(email.ai.model.ensembleConfidence >= 0 && email.ai.model.ensembleConfidence <= 100);
    assert.ok(email.ai.sentiment.urgency >= 0 && email.ai.sentiment.urgency <= 100);
    assert.ok(email.ai.summary.length > 0, email.id);
    assert.ok(email.ai.priority.band, email.id);
    assert.ok(Array.isArray(email.ai.similar), email.id);
    assert.equal(email.analysis.ai.predicted, email.ai.model.predicted);
  }

  const important = analyzed.filter((email) => email.analysis.category === "important");
  assert.ok(important.every((email) => email.ai.model.agreement), "model should agree on the clear operations mail");
});

test("semantic search ranks the right message first", () => {
  const index = buildSearchIndex(analyzed);

  const budget = semanticSearch(index, "budget forecast finance");
  assert.equal(budget[0].email.id, "finance-budget-01");
  assert.ok(budget[0].score > budget[1].score);

  const dinner = semanticSearch(index, "dinner saturday");
  assert.equal(dinner[0].email.id, "personal-dinner-21");

  assert.deepEqual(semanticSearch(index, ""), []);
  assert.deepEqual(semanticSearch(index, "zzzzz"), []);
});

test("recommends similar mail for each message", () => {
  const index = buildSearchIndex(analyzed);
  const finance = analyzed.find((email) => email.id === "finance-budget-01");
  const similar = findSimilar(index, finance, 3);

  assert.ok(similar.length > 0);
  assert.ok(similar.every((item) => item.email.id !== finance.id));
  assert.ok(similar.every((item, position) => position === 0 || item.score <= similar[position - 1].score));
});

test("rewrites replies in three tones and skips spam", () => {
  const finance = analyzed.find((email) => email.id === "finance-budget-01");

  const warm = rewriteReply(finance, "warm");
  const concise = rewriteReply(finance, "concise");
  const formal = rewriteReply(finance, "formal");

  assert.match(warm, /^Hi Priya,/);
  assert.match(warm, /Best,\nAlex$/);
  assert.match(concise, /Noted\./);
  assert.match(concise, /Thanks,\nAlex$/);
  assert.match(formal, /^Dear Priya,/);
  assert.match(formal, /Kind regards,\nAlex$/);
  assert.ok(warm.length > concise.length);

  const spam = analyzed.find((email) => email.analysis.category === "spam");
  assert.equal(rewriteReply(spam), null);
});

test("builds a daily brief from the enriched inbox", () => {
  const brief = buildInboxBrief(analyzed, reference);

  assert.ok(brief.focus.length > 0 && brief.focus.length <= 5);
  assert.ok(brief.plan.length >= 3);
  assert.match(brief.lede, /messages need a person/);
  assert.equal(brief.stats[0].label, "Need attention");
  assert.equal(brief.stats[0].value, analyzed.filter((email) => email.analysis.category !== "spam" && !email.replied).length);
  assert.ok(brief.spam >= 5);
  assert.ok(brief.focus[0].ai.priority.score >= brief.focus[brief.focus.length - 1].ai.priority.score);
});

test("analyzeEmailAI works on a single message", () => {
  const single = analyzeEmailAI(
    {
      id: "single",
      from: { name: "Dr Ada Mensah", email: "ada@harbour.ac.example" },
      subject: "Assignment 2",
      body: "Submit the literature review through the course portal by Monday.",
      read: false,
      analysis: { category: "academic", confidence: 80, actions: ["Submit the literature review"] }
    },
    reference
  );

  assert.equal(single.model.predicted, "academic");
  assert.ok(single.model.agreement);
  assert.ok(single.model.categoryProbability > 50);
  assert.match(single.summary, /literature review/i);
  assert.ok(single.priority.score > 0);
});
