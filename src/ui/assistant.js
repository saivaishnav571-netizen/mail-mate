import { analyzeEmailAI, buildSearchIndex, semanticSearch } from "../lib/ai.js";

const URGENCY_PATTERNS = [
  /\b(urgent|urgently|asap|immediately|action required|final notice|overdue|deadline|expires?|last chance)\b/i,
  /\b(today|tonight|tomorrow|within \d+ hours?|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i
];
const SUSPICIOUS_PATTERNS = [
  { pattern: /\b(password|verify your (?:account|identity)|login credentials|reset your password)\b/i, weight: 25, label: "Credential request" },
  { pattern: /\b(wire transfer|gift card|crypto|bitcoin|payment urgently|pay now|redelivery fee)\b/i, weight: 24, label: "Payment or money request" },
  { pattern: /\b(act now|limited time|you have won|guaranteed|risk[- ]free|prize|lottery)\b/i, weight: 18, label: "Pressure or prize language" },
  { pattern: /\b(do not (?:call|tell)|keep (?:this )?confidential|don't contact)\b/i, weight: 20, label: "Unusual secrecy request" },
  { pattern: /https?:\/\/(?:bit\.ly|tinyurl\.com|t\.co|is\.gd|rb\.gy)\//i, weight: 15, label: "Shortened link" },
  { pattern: /\b(?:click|open|download) (?:the )?(?:link|attachment|file)\b/i, weight: 10, label: "Link or attachment prompt" }
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function scanEmailRisk(email) {
  const text = `${email.from?.name || ""} ${email.from?.email || ""} ${email.subject || ""} ${email.body || ""}`;
  const signals = SUSPICIOUS_PATTERNS.filter(({ pattern }) => pattern.test(text));
  const score = clamp(signals.reduce((total, signal) => total + signal.weight, 0));
  const urgency = URGENCY_PATTERNS.some((pattern) => pattern.test(text));
  const level = score >= 55 ? "High" : score >= 25 ? "Review" : "Low";
  return { score, level, signals: signals.map((signal) => signal.label), urgency };
}

export function buildAssistantOverview(emails = [], reference = new Date()) {
  const prepared = emails.map((email) => {
    const analysis = { ...(email.analysis || {}), category: email.analysis?.category || email.category || "important" };
    const ai = email.ai || analyzeEmailAI({ ...email, analysis }, reference);
    return { ...email, analysis, ai, actions: email.actions || [], deadline: email.deadline || null };
  });
  const nonSpam = prepared.filter((email) => email.analysis?.category !== "spam");
  const unread = nonSpam.filter((email) => !email.read);
  const dueSoon = nonSpam.filter((email) => email.deadline?.date && ((email.deadline.date.getTime() - reference.getTime()) >= -24 * 60 * 60 * 1000) && ((email.deadline.date.getTime() - reference.getTime()) <= 48 * 60 * 60 * 1000)).length;
  const deadlines = nonSpam
    .filter((email) => email.deadline?.date)
    .sort((a, b) => a.deadline.date - b.deadline.date);
  const tasks = nonSpam.flatMap((email) => (email.actions || []).map((action) => ({
    emailId: email.id,
    subject: email.subject,
    sender: email.from?.name || "Unknown sender",
    action,
    deadline: email.deadline?.date || null,
    category: email.analysis?.category || email.category || "important",
    priority: email.ai?.priority?.score || 0
  })));
  const risky = prepared.map((email) => ({ email, risk: scanEmailRisk(email) }))
    .filter(({ risk }) => risk.score >= 25)
    .sort((a, b) => b.risk.score - a.risk.score);
  const ranked = nonSpam.slice().sort((a, b) =>
    (b.ai?.priority?.score || 0) - (a.ai?.priority?.score || 0)
  );
  const highPriority = ranked.filter((email) => (email.ai?.priority?.score || 0) >= 60);
  const drafts = nonSpam.filter((email) => email.reply && !email.replied).length;
  const focus = ranked.filter((email) => !email.replied).slice(0, 5);
  const brief = {
    lede: emails.length === 0 ? "The inbox is loading, or no messages are available yet. This briefing refreshes when the inbox is ready." : `${nonSpam.length} non-spam messages in this inbox. ${unread.length} unread, ${highPriority.length} high-priority, and ${dueSoon} deadlines within 48 hours. ${focus[0] ? `Start with “${focus[0].subject}” from ${focus[0].from?.name || "the sender"}.` : "Review the action items below to decide what remains."}`,
    plan: [
      ...(focus[0] ? [`Open “${focus[0].subject}” first — ${focus[0].ai?.priority?.factors?.[0]?.detail || "it ranks highest"}.`] : []),
      ...(dueSoon ? [`Check ${dueSoon} deadline(s) within the next 48 hours.`] : []),
      `Review ${tasks.length} detected action item(s); ${drafts} draft(s) are waiting for approval.`,
      `Security scan flagged ${risky.length} message(s) for closer review.`
    ],
    stats: [{label:"Messages",value:nonSpam.length},{label:"Unread",value:unread.length},{label:"High priority",value:highPriority.length},{label:"Due ≤48h",value:dueSoon}],
    focus, dueSoon, drafts, spam: prepared.length-nonSpam.length
  };
  return { brief, unread, deadlines, tasks, risky, ranked, dueSoon, highPriority };
}

function sentenceExcerpt(email, query) {
  const body = String(email.body || "").replace(/\s+/g, " ").trim();
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const sentences = body.match(/[^.!?]+[.!?]?/g) || [body];
  const ranked = sentences.map((sentence) => ({
    sentence: sentence.trim(),
    score: terms.reduce((score, term) => score + (sentence.toLowerCase().includes(term) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score);
  return ranked[0]?.sentence || body.slice(0, 240);
}

export function answerInboxQuestion(emails = [], query = "") {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return { message: "Ask a question about a sender, topic, deadline, meeting, assignment, or decision.", results: [] };
  const index = buildSearchIndex(emails);
  const results = semanticSearch(index, cleanQuery).slice(0, 4);
  if (!results.length) return { message: "I couldn't find a relevant message in the current inbox. Try different keywords or a sender name.", results: [] };
  return {
    message: "I found these related messages. This is retrieval-based and extractive: it shows matching email evidence rather than inventing an answer.",
    results: results.map(({ email, score }) => ({
      email,
      relevance: Math.round(score * 100),
      excerpt: sentenceExcerpt(email, cleanQuery)
    }))
  };
}

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDate(date) {
  if (!date) return "No date detected";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
}

function renderBrief(root, overview) {
  root.replaceChildren();
  const brief = overview.brief;
  root.append(create("p", "assistant-brief-lede", brief.lede));
  const plan = create("ol", "assistant-plan");
  (brief.plan || []).forEach((item) => plan.append(create("li", "", item)));
  if (plan.children.length) root.append(plan);
  const cards = create("div", "assistant-stats");
  [
    ["Unread", overview.unread.length],
    ["High priority", overview.highPriority.length],
    ["Deadlines ≤ 48h", overview.dueSoon],
    ["Action items", overview.tasks.length]
  ].forEach(([label, value]) => {
    const card = create("div", "assistant-stat");
    card.append(create("strong", "", String(value)), create("span", "", label));
    cards.append(card);
  });
  root.append(cards);
  if (overview.ranked[0]) root.append(create("p", "assistant-muted", `Start with: ${overview.ranked[0].subject} — ${overview.ranked[0].from?.name || "sender"}`));
}

function renderTasks(root, tasks) {
  root.replaceChildren();
  if (!tasks.length) {
    root.append(create("p", "assistant-muted", "No action items were detected in the current inbox."));
    return;
  }
  tasks.slice(0, 12).forEach((task) => {
    const card = create("article", "assistant-item");
    card.append(create("strong", "", task.action));
    card.append(create("span", "assistant-item-meta", task.subject));
    card.append(create("span", "assistant-item-meta", task.deadline ? `Due: ${formatDate(task.deadline)}` : "No deadline found"));
    root.append(card);
  });
}

function renderRisk(root, risky, emails) {
  root.replaceChildren();
  root.append(create("p", "assistant-disclaimer", "Heuristic screening only—not a guarantee of safety. Verify sender and links independently; the scan never opens links or attachments."));
  const checked = emails.length;
  root.append(create("p", "assistant-muted", `Checked ${checked} messages locally. ${risky.length} have one or more warning signals.`));
  if (!risky.length) {
    root.append(create("p", "assistant-empty", "No strong warning patterns detected in this sample."));
    return;
  }
  risky.slice(0, 8).forEach(({ email, risk }) => {
    const card = create("article", `assistant-item risk-${risk.level.toLowerCase()}`);
    const top = create("div", "assistant-item-top");
    top.append(create("strong", "", email.subject || "(no subject)"), create("span", "assistant-risk-score", `${risk.level} · ${risk.score}/100`));
    card.append(top, create("span", "assistant-item-meta", email.from?.email || email.from?.name || "Unknown sender"));
    const signalList = create("ul", "assistant-signals");
    risk.signals.forEach((signal) => signalList.append(create("li", "", signal)));
    card.append(signalList);
    root.append(card);
  });
}

function renderAnswer(root, answer) {
  root.replaceChildren(create("p", "assistant-muted", answer.message));
  answer.results.forEach(({ email, excerpt, relevance }) => {
    const card = create("article", "assistant-item assistant-result");
    card.append(create("strong", "", email.subject || "(no subject)"));
    card.append(create("span", "assistant-item-meta", `${email.from?.name || "Unknown sender"} · relevance ${relevance}%`));
    card.append(create("p", "", excerpt));
    root.append(card);
  });
}

export function initAssistant({ getEmailsSnapshot } = {}) {
  const section = document.querySelector("[data-assistant]");
  if (!section) return null;
  const output = section.querySelector("[data-assistant-output]");
  const query = section.querySelector("[data-assistant-query]");
  const askButton = section.querySelector("[data-assistant-ask]");
  const actionButtons = Array.from(section.querySelectorAll("[data-assistant-action]"));

  function emails() {
    return typeof getEmailsSnapshot === "function" ? getEmailsSnapshot() || [] : [];
  }

  let activeAction = "brief";

  function run(action) {
    activeAction = action;
    const data = emails();
    const overview = buildAssistantOverview(data);
    if (action === "brief") renderBrief(output, overview);
    if (action === "tasks") renderTasks(output, overview.tasks);
    if (action === "security") renderRisk(output, overview.risky, data);
    if (action === "ask") renderAnswer(output, answerInboxQuestion(data, query?.value || ""));
    actionButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.assistantAction === action));
  }

  actionButtons.forEach((button) => button.addEventListener("click", () => run(button.dataset.assistantAction)));
  window.addEventListener("mailmate:inbox-updated", () => run(activeAction));
  askButton?.addEventListener("click", () => run("ask"));
  query?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      run("ask");
    }
  });
  run("brief");
  return { refresh: () => run("brief") };
}
