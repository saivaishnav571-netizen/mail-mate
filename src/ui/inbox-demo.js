import {
  triageEmail,
  formatDeadline,
  formatReceived,
  CATEGORIES,
  CATEGORY_BY_ID
} from "../lib/triage.js";
import {
  enrichInbox,
  buildSearchIndex,
  semanticSearch,
  buildInboxBrief,
  rewriteReply
} from "../lib/ai.js";
import { fetchTestInbox, parseDataset } from "../lib/dataset.js";
import { createDashboardScene } from "./dashboard-scene.js";
import { pulseValue, replayAnimation } from "../lib/motion.js";
import {
  activateModel,
  approveFeedback,
  downloadBlob,
  exportFeedbackCsv,
  fetchAnalytics,
  fetchCurrentModel,
  fetchFeedback,
  fetchHealth,
  fetchModelVersions,
  isBackendConfigured,
  retrainModel,
  submitFeedback
} from "../lib/feedback.js";

const DEMO_NOW = new Date("2026-11-15T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CATEGORY_CLASSES = ["cat-important", "cat-academic", "cat-internship", "cat-personal", "cat-spam"];

export function initInboxDemo(root) {
  if (!root) return;
  const dashboardScene = createDashboardScene(root.querySelector("[data-dashboard-scene]"));
  window.addEventListener("pagehide", () => dashboardScene.destroy(), { once: true });

  const els = {
    filters: root.querySelector("[data-filters]"),
    list: root.querySelector("[data-list]"),
    loading: root.querySelector("[data-list-loading]"),
    empty: root.querySelector("[data-empty]"),
    emptyTitle: root.querySelector("[data-empty] .empty-title"),
    emptyCopy: root.querySelector("[data-empty] p:not(.empty-title)"),
    retry: root.querySelector("[data-retry]"),
    search: root.querySelector("[data-search]"),
    resultCount: root.querySelector("[data-result-count]"),
    status: root.querySelector("[data-statusline]"),
    demoLabel: document.querySelector("[data-demo-label]"),
    detailPane: root.querySelector("[data-detail-pane]"),
    detailEmpty: root.querySelector("[data-detail-empty]"),
    detailBody: root.querySelector("[data-detail-body]"),
    detailClose: root.querySelector("[data-detail-close]"),
    scrim: root.querySelector("[data-scrim]"),
    category: root.querySelector("[data-detail-category]"),
    categoryLabel: root.querySelector("[data-detail-category-label]"),
    confidence: root.querySelector("[data-detail-confidence]"),
    reviewConfidence: root.querySelector("[data-review-confidence]"),
    subject: root.querySelector("[data-detail-subject]"),
    avatar: root.querySelector("[data-detail-avatar]"),
    from: root.querySelector("[data-detail-from]"),
    email: root.querySelector("[data-detail-email]"),
    received: root.querySelector("[data-detail-received]"),
    text: root.querySelector("[data-detail-text]"),
    reasonSummary: root.querySelector("[data-detail-reason]"),
    reasons: root.querySelector("[data-detail-reasons]"),
    deadline: root.querySelector("[data-detail-deadline]"),
    deadlineNote: root.querySelector("[data-detail-deadline-note]"),
    actions: root.querySelector("[data-detail-actions]"),
    threadCard: root.querySelector("[data-thread-card]"),
    threadCount: root.querySelector("[data-thread-count]"),
    threadSubject: root.querySelector("[data-thread-subject]"),
    threadStatus: root.querySelector("[data-thread-status]"),
    threadEngine: root.querySelector("[data-thread-engine]"),
    threadParticipants: root.querySelector("[data-thread-participants]"),
    threadSummary: root.querySelector("[data-thread-summary]"),
    threadInterview: root.querySelector("[data-thread-interview]"),
    threadPrep: root.querySelector("[data-thread-prep]"),
    threadTimeline: root.querySelector("[data-thread-timeline]"),
    feedbackTotal: root.querySelector("[data-feedback-total]"),
    categoryOverride: root.querySelector("[data-category-override]"),
    feedbackBox: root.querySelector("[data-feedback-box]"),
    feedbackState: root.querySelector("[data-feedback-state]"),
    feedbackCorrect: root.querySelector("[data-feedback-correct]"),
    feedbackIncorrect: root.querySelector("[data-feedback-incorrect]"),
    feedbackCorrection: root.querySelector("[data-feedback-correction]"),
    feedbackCategory: root.querySelector("[data-feedback-category]"),
    feedbackSave: root.querySelector("[data-feedback-save]"),
    feedbackCancel: root.querySelector("[data-feedback-cancel]"),
    feedbackDialog: document.getElementById("feedback-dialog"),
    feedbackClose: document.querySelector("[data-feedback-close]"),
    feedbackStats: document.querySelector("[data-feedback-stats]"),
    feedbackCategories: document.querySelector("[data-feedback-categories]"),
    feedbackModel: document.querySelector("[data-feedback-model]"),
    feedbackList: document.querySelector("[data-feedback-list]"),
    feedbackApproved: document.querySelector("[data-feedback-approved]"),
    feedbackToken: document.querySelector("[data-feedback-token]"),
    feedbackRetrain: document.querySelector("[data-feedback-retrain]"),
    feedbackExport: document.querySelector("[data-feedback-export]"),
    feedbackExportAll: document.querySelector("[data-feedback-export-all]"),
    feedbackModels: document.querySelector("[data-feedback-models]"),
    feedbackAdminNote: document.querySelector("[data-feedback-admin-note]"),
    replyCard: root.querySelector("[data-reply-card]"),
    reply: root.querySelector("[data-reply]"),
    replyError: root.querySelector("[data-reply-error]"),
    review: root.querySelector("[data-review]"),
    copy: root.querySelector("[data-copy]"),
    replyNote: root.querySelector(".reply-note"),
    spamNote: root.querySelector("[data-spam-note]"),
    sentNote: root.querySelector("[data-sent-note]"),
    reminderCount: root.querySelector("[data-reminder-count]"),
    remindersToggle: root.querySelector("[data-reminders-toggle]"),
    statUnread: root.querySelector("[data-stat-unread]"),
    statDue: root.querySelector("[data-stat-due]"),
    statDrafts: root.querySelector("[data-stat-drafts]"),
    statReplied: root.querySelector("[data-stat-replied]"),
    statFocus: root.querySelector("[data-stat-focus]"),
    clearFilters: root.querySelector("[data-clear-filters]"),
    semanticToggle: root.querySelector("[data-semantic-toggle]"),
    sortToggle: root.querySelector("[data-sort-toggle]"),
    aiSummary: root.querySelector("[data-ai-summary]"),
    aiTone: root.querySelector("[data-ai-tone]"),
    aiUrgency: root.querySelector("[data-ai-urgency]"),
    aiModel: root.querySelector("[data-ai-model]"),
    aiPriority: root.querySelector("[data-ai-priority]"),
    aiPriorityBand: root.querySelector("[data-ai-priority-band]"),
    aiPriorityFill: root.querySelector("[data-ai-priority-fill]"),
    aiPriorityFactors: root.querySelector("[data-ai-priority-factors]"),
    modelAgreement: root.querySelector("[data-model-agreement]"),
    modelBars: root.querySelector("[data-model-bars]"),
    modelTerms: root.querySelector("[data-model-terms]"),
    similarCard: root.querySelector("[data-similar-card]"),
    similarList: root.querySelector("[data-similar-list]")
  };

  const uploadInput = document.querySelector("[data-upload-input]");
  const dropzone = document.querySelector("[data-dropzone]");
  const uploadResult = document.querySelector("[data-upload-result]");
  const approvalDialog = document.getElementById("approval-dialog");
  const remindersDialog = document.getElementById("reminders-dialog");
  const briefDialog = document.getElementById("brief-dialog");
  const briefStats = document.querySelector("[data-brief-stats]");
  const briefLede = document.querySelector("[data-brief-lede]");
  const briefList = document.querySelector("[data-brief-list]");
  const briefPlan = document.querySelector("[data-brief-plan]");
  const approvalTo = document.querySelector("[data-approval-to]");
  const approvalSubject = document.querySelector("[data-approval-subject]");
  const approvalDraft = document.querySelector("[data-approval-draft]");
  const approveCheck = document.querySelector("[data-approve-check]");
  const approveConfirm = document.querySelector("[data-approval-confirm]");
  const reminderList = document.querySelector("[data-reminder-list]");
  const reminderEmpty = document.querySelector("[data-reminder-empty]");
  const toastEl = document.querySelector("[data-toast]");
  const narrow = window.matchMedia("(max-width: 860px)");

  const state = {
    emails: [],
    selectedId: null,
    filter: "all",
    query: "",
    label: "Test inbox",
    loading: true,
    pending: null,
    semantic: false,
    sort: "newest",
    searchIndex: null,
    relevance: new Map(),
    modelVersion: null,
    feedbackTotal: 0,
    feedbackOffline: false,
    feedbackHydrated: false,
    listSignature: "",
    staggerUntil: 0,
    renderedDetailId: null
  };

  let toastTimer = 0;

  /* ------------------------------------------------------------------ */
  /*  Data                                                              */
  /* ------------------------------------------------------------------ */

  function analyse(rows) {
    const emails = rows.map((row) => {
      const email = triageEmail(row, DEMO_NOW, { name: "Alex" });
      if (email.analysis) email.analysis.originalCategory = email.analysis.category;
      return { ...email, replied: false, replySent: null, sentAt: null, replyTone: "warm" };
    });
    enrichInbox(emails, DEMO_NOW);
    return emails;
  }

  function setEmails(rows) {
    state.emails = analyse(rows);
    state.searchIndex = buildSearchIndex(state.emails);
    state.relevance = new Map();
    state.feedbackHydrated = false;
    state.listSignature = "";
    state.renderedDetailId = null;
  }

  async function loadTestInbox({ announce = false } = {}) {
    setLoading(true);
    try {
      const data = await fetchTestInbox();
      setEmails(data.emails);
      setLoading(false);
      state.label = data.label;
      state.filter = "all";
      state.query = "";
      state.semantic = false;
      state.sort = "newest";
      els.search.value = "";
      resetEmptyState();
      state.selectedId =
        state.emails.find((email) => email.id === "finance-budget-01")?.id ||
        state.emails[0]?.id ||
        null;
      updateFilterButtons();
      renderAll();
      if (announce) toast(`Test inbox restored. ${state.emails.length} messages, ${state.emails.filter((email) => email.reply).length} drafts.`);
      void syncFeedbackData({ rerender: true });
    } catch (error) {
      state.emails = [];
      state.selectedId = null;
      state.label = "Test inbox";
      setLoading(false);
      els.status.textContent = "The test inbox could not be loaded.";
      els.empty.hidden = false;
      els.emptyTitle.textContent = "The test inbox did not load.";
      els.emptyCopy.textContent = "Check the connection, or upload a JSON or CSV file below.";
      if (els.retry) els.retry.hidden = false;
      renderAll();
      toast(error.message || "The test inbox could not be loaded.");
    }
  }

  function applyDataset(emails, label, filename) {
    setEmails(emails);
    setLoading(false);
    state.label = label || "Uploaded inbox";
    state.filter = "all";
    state.query = "";
    state.semantic = false;
    state.sort = "newest";
    els.search.value = "";
    state.selectedId = state.emails[0]?.id || null;
    resetEmptyState();
    updateFilterButtons();
    renderAll();
    toast(`Loaded ${state.emails.length} messages from ${filename}.`);
    void syncFeedbackData({ rerender: true });
  }

  function setLoading(next) {
    state.loading = next;
    if (els.loading) els.loading.hidden = !next;
    if (next) {
      els.status.textContent = "Loading the test inbox…";
      els.list.replaceChildren();
      els.empty.hidden = true;
      els.resultCount.textContent = "Loading…";
      els.detailEmpty.hidden = false;
      els.detailBody.hidden = true;
    }
    els.list.setAttribute("aria-busy", String(next));
  }

  function resetEmptyState() {
    els.empty.hidden = true;
    els.emptyTitle.textContent = "No messages in this view.";
    els.emptyCopy.textContent = "Try another bucket or clear the search.";
    if (els.retry) els.retry.hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /*  Derived state                                                     */
  /* ------------------------------------------------------------------ */

  function withReminderCount() {
    return state.emails.filter((email) => email.reminder && !email.reminder.done).length;
  }

  function deadlineDelta(email) {
    return email.deadline ? email.deadline.date.getTime() - DEMO_NOW.getTime() : Infinity;
  }

  function dueSoonCount() {
    return state.emails.filter((email) => {
      const delta = deadlineDelta(email);
      return delta >= -DAY_MS && delta <= 2 * DAY_MS;
    }).length;
  }

  function filteredEmails() {
    const query = state.query.trim();
    const lowered = query.toLowerCase();
    state.relevance = new Map();

    let results;
    if (query && state.semantic && state.searchIndex) {
      const matches = semanticSearch(state.searchIndex, query);
      for (const match of matches) state.relevance.set(match.email.id, match.score);
      results = matches.map((match) => match.email);
      if (!results.length) {
        results = state.emails.filter((email) => matchesQuery(email, lowered));
      }
    } else {
      results = state.emails.filter((email) => matchesQuery(email, lowered));
    }

    results = results.filter((email) => state.filter === "all" || email.analysis.category === state.filter);

    if (state.sort === "priority") {
      results.sort(
        (a, b) =>
          b.ai.priority.score - a.ai.priority.score ||
          b.receivedAt.getTime() - a.receivedAt.getTime()
      );
    } else if (!(query && state.semantic)) {
      results.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    }

    return results;
  }

  function matchesQuery(email, query) {
    if (!query) return true;
    return `${email.from.name} ${email.from.email} ${email.subject} ${email.body}`
      .toLowerCase()
      .includes(query);
  }

  function selectedEmail() {
    return state.emails.find((email) => email.id === state.selectedId) || null;
  }

  function categoryCounts() {
    return state.emails.reduce(
      (counts, email) => {
        counts[email.analysis.category] += 1;
        counts.all += 1;
        return counts;
      },
      { all: 0, important: 0, academic: 0, internship: 0, personal: 0, spam: 0 }
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Render: shell                                                     */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    if (state.loading) return;
    els.loading.hidden = true;
    renderTools();
    renderFilters();
    renderStats();
    renderList();
    renderDetail();
    renderReminderCount();
    renderStatus();
    const counts = categoryCounts();
    dashboardScene.updateCounts([counts.important, counts.academic, counts.internship, counts.personal, counts.spam]);
    root.querySelector("[data-dashboard-total]")?.replaceChildren(String(counts.all));
    root.querySelector("[data-dashboard-unread]")?.replaceChildren(String(state.emails.filter((email) => !email.read).length));
    els.resultCount.textContent = resultLabel();
  }

  function renderTools() {
    if (els.semanticToggle) {
      els.semanticToggle.classList.toggle("is-active", state.semantic);
      els.semanticToggle.setAttribute("aria-pressed", String(state.semantic));
    }
    if (els.sortToggle) {
      const active = state.sort === "priority";
      els.sortToggle.classList.toggle("is-active", active);
      els.sortToggle.setAttribute("aria-pressed", String(active));
      els.sortToggle.textContent = active ? "AI priority" : "Newest first";
    }
    if (els.search) {
      els.search.placeholder = state.semantic
        ? "Search by meaning, not just words"
        : "Search sender, subject, text";
    }
  }

  function renderStatus() {
    els.status.textContent = `${state.label} · ${state.emails.length} messages · demo clock 15 Nov, 09:00`;
    if (els.demoLabel) els.demoLabel.textContent = state.label;
  }

  function resultLabel() {
    const count = filteredEmails().length;
    if (state.query.trim()) {
      if (state.semantic) return `${count} semantic match${count === 1 ? "" : "es"}`;
      return `${count} matching`;
    }
    if (state.sort === "priority") return `${count} messages · AI priority`;
    if (state.filter === "all") return `${count} messages`;
    return `${count} in ${CATEGORY_BY_ID[state.filter].label}`;
  }

  function renderFilters() {
    const counts = categoryCounts();
    root.querySelectorAll("[data-count]").forEach((node) => {
      node.textContent = String(counts[node.dataset.count] ?? 0);
    });
    root.querySelectorAll("[data-category]").forEach((button) => {
      const active = button.dataset.category === state.filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderStats() {
    const unread = state.emails.filter((email) => !email.read).length;
    const drafts = state.emails.filter((email) => email.reply && !email.replied).length;
    const replied = state.emails.filter((email) => email.replied).length;
    const focus = state.emails.filter(
      (email) => email.analysis.category !== "spam" && !email.replied && email.ai.priority.score >= 60
    ).length;
    setStat(els.statUnread, unread);
    setStat(els.statDue, dueSoonCount());
    setStat(els.statDrafts, drafts);
    setStat(els.statReplied, replied);
    setStat(els.statFocus, focus);
  }

  function setStat(node, value) {
    if (!node) return;
    const next = String(value);
    const changed = node.textContent !== next && node.textContent !== "—";
    node.textContent = next;
    if (changed) pulseValue(node);
  }

  function renderReminderCount() {
    const open = withReminderCount();
    els.reminderCount.textContent = String(open);
    els.remindersToggle.setAttribute(
      "aria-label",
      `Reminders, ${open} open`
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Render: message list                                              */
  /* ------------------------------------------------------------------ */

  function renderList() {
    const emails = filteredEmails();
    const fragment = document.createDocumentFragment();
    const signature = emails.map((email) => email.id).join("|");
    const shouldStagger = signature !== state.listSignature && emails.length > 0;
    state.listSignature = signature;

    if (!emails.length) {
      els.list.replaceChildren();
      els.list.classList.remove("is-stagger");
      els.empty.hidden = false;
      if (state.query.trim() && state.semantic) {
        els.emptyTitle.textContent = "No semantic matches.";
        els.emptyCopy.textContent = "Try different words, or turn off Semantic search.";
      } else if (state.query.trim()) {
        els.emptyTitle.textContent = "Nothing matches that search.";
        els.emptyCopy.textContent = "Try a sender, a subject, or a word from the message.";
      } else if (state.filter !== "all") {
        els.emptyTitle.textContent = `No ${CATEGORY_BY_ID[state.filter].label.toLowerCase()} messages.`;
        els.emptyCopy.textContent = "Choose another bucket or clear the search.";
      }
      return;
    }

    els.empty.hidden = true;

    for (const email of emails) {
      fragment.append(createMailItem(email));
    }
    els.list.replaceChildren(fragment);

    if (shouldStagger) {
      state.staggerUntil = performance.now() + 900;
      Array.from(els.list.children).forEach((item, index) => {
        item.style.setProperty("--stagger-i", String(Math.min(index, 14)));
      });
      els.list.classList.add("is-stagger");
    } else if (performance.now() > state.staggerUntil) {
      // Keep the class briefly so a quick follow-up render (e.g. feedback
      // hydration) does not clip the entrance animation mid-flight.
      els.list.classList.remove("is-stagger");
    }
  }

  function createMailItem(email) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const category = email.analysis.category;
    const due = deadlineDelta(email);
    const isSoon = due >= -DAY_MS && due <= 2 * DAY_MS;

    button.type = "button";
    button.className = `mail-item cat-${category}`;
    button.dataset.id = email.id;
    button.classList.toggle("is-selected", email.id === state.selectedId);
    button.classList.toggle("is-unread", !email.read);
    button.classList.toggle("is-read", email.read);
    button.classList.toggle("is-replied", Boolean(email.replied));
    button.setAttribute("aria-pressed", String(email.id === state.selectedId));
    button.setAttribute(
      "aria-label",
      `${email.read ? "" : "Unread. "}${email.from.name}. ${email.subject}. ${CATEGORY_BY_ID[category].label}.`
    );

    const unread = document.createElement("span");
    unread.className = "mail-unread";
    unread.setAttribute("aria-hidden", "true");

    const top = document.createElement("span");
    top.className = "mail-top";
    const from = document.createElement("span");
    from.className = "mail-from";
    from.textContent = email.from.name;
    const time = document.createElement("span");
    time.className = "mail-time";
    time.textContent = formatReceived(email.receivedAt, DEMO_NOW);
    top.append(from, time);

    const subject = document.createElement("span");
    subject.className = "mail-subject";
    subject.textContent = email.subject;
    subject.title = email.subject;

    const snippet = document.createElement("span");
    snippet.className = "mail-snippet";
    snippet.textContent = email.body.replace(/\s+/g, " ").slice(0, 132);

    const tags = document.createElement("span");
    tags.className = "mail-tags";
    const tag = document.createElement("span");
    tag.className = "mini-tag";
    tag.textContent = CATEGORY_BY_ID[category].label;
    tags.append(tag);

    if (email.deadline) {
      const dueTag = document.createElement("span");
      dueTag.className = `mail-due${isSoon ? " is-soon" : ""}`;
      dueTag.textContent = shortDeadline(email.deadline, due);
      tags.append(dueTag);
    }

    const priority = email.ai?.priority;
    if (priority && priority.score >= 40) {
      const priorityTag = document.createElement("span");
      priorityTag.className = `mail-priority is-${priority.bandClass}`;
      priorityTag.textContent = priority.score >= 80 ? "P1" : priority.score >= 60 ? "P2" : "P3";
      priorityTag.title = `AI priority ${priority.score}/100 · ${priority.band}`;
      tags.append(priorityTag);
    }

    const relevance = state.relevance.get(email.id);
    if (relevance) {
      const matchTag = document.createElement("span");
      matchTag.className = "mail-match";
      matchTag.textContent = `${Math.round(relevance * 100)}% match`;
      matchTag.title = "TF-IDF semantic similarity";
      tags.append(matchTag);
    }

    const replied = document.createElement("span");
    replied.className = "mail-replied";
    replied.textContent = "Replied";
    tags.append(replied);

    button.append(unread, top, subject, snippet, tags);
    item.append(button);
    return item;
  }

  function shortDeadline(deadline, delta) {
    if (delta < -DAY_MS) return "Overdue";
    if (deadline.label.startsWith("Today")) return "Today";
    if (deadline.label.startsWith("Tomorrow")) return "Tomorrow";
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(deadline.date);
  }

  /* ------------------------------------------------------------------ */
  /*  Render: detail                                                    */
  /* ------------------------------------------------------------------ */

  function renderDetail() {
    const email = selectedEmail();
    const hasEmail = Boolean(email);
    els.detailEmpty.hidden = hasEmail;
    els.detailBody.hidden = !hasEmail;

    if (!hasEmail) {
      state.renderedDetailId = null;
      els.detailBody.classList.remove("is-swapping");
      closeDetailOverlay();
      return;
    }

    const category = email.analysis.category;
    const categoryClass = `cat-${category}`;
    els.detailBody.classList.remove(...CATEGORY_CLASSES);
    els.detailBody.classList.add(categoryClass);

    const ensemble = email.ai?.model?.ensembleConfidence ?? email.analysis.confidence;
    els.category.textContent = CATEGORY_BY_ID[category].label;
    els.categoryLabel.textContent = `${ensemble}% match`;
    els.confidence.textContent = `${ensemble}% match`;
    const needsHumanReview = ensemble < 65 ||
      (email.ai?.model && !email.ai.model.agreement) ||
      (email.ai?.model?.knownTokens !== undefined && email.ai.model.knownTokens < 3);
    if (els.reviewConfidence) {
      els.reviewConfidence.hidden = !needsHumanReview;
      els.reviewConfidence.textContent = needsHumanReview
        ? (email.ai?.model && !email.ai.model.agreement ? "Model disagreement · review" : ensemble < 65 ? "Low confidence · review" : "Sparse text · review")
        : "High-confidence match";
      els.reviewConfidence.classList.toggle("is-review", needsHumanReview);
      els.reviewConfidence.title = "Advisory only. Review when confidence is below 65%, rule/model disagree, or the email has too few known tokens.";
    }
    els.confidence.title = email.ai
      ? `Rule engine ${email.analysis.confidence}% · ${email.ai.model.predictedLabel} model ${Math.round(
          email.ai.model.confidence * 100
        )}%`
      : "";
    els.subject.textContent = email.subject;
    els.avatar.textContent = initials(email.from.name);
    els.avatar.className = `avatar ${categoryClass}`;
    els.from.textContent = email.from.name;
    els.email.textContent = email.from.email || "No address provided";
    els.received.textContent = formatFullDate(email.receivedAt);
    els.received.dateTime = email.receivedAt.toISOString();
    els.text.textContent = email.body;

    const reasons = email.analysis.reasons || [];
    els.reasonSummary.textContent = reasons.length
      ? `${CATEGORY_BY_ID[category].label} scored highest from ${reasons.length} signal${reasons.length === 1 ? "" : "s"}.`
      : "No strong signals; placed in Important for a human check.";
    els.reasons.replaceChildren(
      ...reasons.map((reason) => {
        const item = document.createElement("li");
        item.textContent = reason;
        return item;
      })
    );

    renderDeadline(email);
    renderActions(email);
    renderAI(email);
    renderThread(email);
    renderFeedback(email);
    renderReply(email);

    if (state.renderedDetailId !== email.id) {
      state.renderedDetailId = email.id;
      replayAnimation(els.detailBody, "is-swapping");
    }
  }

  function renderAI(email) {
    const ai = email.ai;
    if (!ai) return;

    els.aiSummary.textContent = ai.summary;
    els.aiTone.textContent = `Tone · ${ai.sentiment.label}`;
    els.aiTone.dataset.tone = ai.sentiment.label.toLowerCase();
    els.aiUrgency.textContent = `Urgency ${ai.sentiment.urgency}/100`;

    const model = ai.model;
    els.aiModel.textContent = `Model · ${model.predictedLabel} ${Math.round(model.confidence * 100)}%`;
    els.aiModel.classList.toggle("is-agree", model.agreement);
    els.aiModel.classList.toggle("is-disagree", !model.agreement);

    const priority = ai.priority;
    els.aiPriority.textContent = `${priority.score}/100`;
    els.aiPriorityBand.textContent = priority.band;
    els.aiPriorityBand.className = `priority-band is-${priority.bandClass}`;
    els.aiPriorityFill.className = `priority-fill is-${priority.bandClass}`;
    els.aiPriorityFill.style.width = `${priority.score}%`;
    els.aiPriorityFactors.replaceChildren(
      ...priority.factors.map((factor) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.className = "priority-factor-label";
        label.textContent = factor.label;
        const detail = document.createElement("span");
        detail.className = "priority-factor-detail";
        detail.textContent = factor.detail;
        const points = document.createElement("b");
        points.className = "priority-factor-points";
        points.textContent = `${factor.points > 0 ? "+" : ""}${factor.points}`;
        item.append(label, detail, points);
        return item;
      })
    );

    els.modelAgreement.textContent = model.agreement ? "Agrees with bucket" : `Suggests ${model.predictedLabel}`;
    els.modelAgreement.className = `model-agreement ${model.agreement ? "is-agree" : "is-disagree"}`;

    els.modelBars.replaceChildren(
      ...model.ranked.map((item) => {
        const row = document.createElement("div");
        row.className = "model-bar";
        row.classList.toggle("is-winner", item.id === email.analysis.category);

        const label = document.createElement("span");
        label.className = "model-bar-label";
        label.textContent = item.label;

        const track = document.createElement("span");
        track.className = "model-bar-track";
        const fill = document.createElement("span");
        fill.className = `model-bar-fill cat-bg-${item.id}`;
        fill.style.width = `${Math.max(2, Math.round(item.probability * 100))}%`;
        track.append(fill);

        const value = document.createElement("span");
        value.className = "model-bar-value";
        value.textContent = `${Math.round(item.probability * 100)}%`;

        row.append(label, track, value);
        return row;
      })
    );

    const terms = model.topTerms.map((term) => term.term).slice(0, 5);
    els.modelTerms.textContent = terms.length
      ? `Top terms · ${terms.join(" · ")}`
      : "Top terms · no known vocabulary matches";

    const similar = ai.similar || [];
    els.similarCard.hidden = similar.length === 0;
    els.similarList.replaceChildren(
      ...similar.map(({ email: other, score }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "similar-chip";
        button.dataset.similarId = other.id;
        button.title = `Open “${other.subject}”`;
        const subject = document.createElement("span");
        subject.className = "similar-subject";
        subject.textContent = other.subject;
        const meta = document.createElement("span");
        meta.className = "similar-meta";
        meta.textContent = `${other.from.name} · ${Math.round(score * 100)}% similar`;
        button.append(subject, meta);
        return button;
      })
    );

    updateToneButtons(email.replyTone || null);
  }

  function renderThread(email) {
    const thread = email.thread;
    if (!thread) {
      els.threadCard.hidden = true;
      return;
    }

    els.threadCard.hidden = false;
    els.threadCount.textContent = `${thread.count} message${thread.count === 1 ? "" : "s"}`;
    els.threadSubject.textContent = thread.subject;
    els.threadStatus.textContent = thread.status;
    els.threadStatus.className = `thread-chip thread-status is-${thread.status.toLowerCase().replace(/\s+/g, "-")}`;
    els.threadEngine.textContent = thread.summary?.engine || "deterministic-nlu";
    els.threadSummary.textContent = thread.summary?.text || "No summary generated.";

    els.threadParticipants.replaceChildren(
      ...thread.participants.map((person) => {
        const chip = document.createElement("span");
        chip.className = "thread-person";
        chip.title = person.email || person.name;
        const name = document.createElement("span");
        name.className = "thread-person-name";
        name.textContent = person.name || person.email;
        const address = document.createElement("span");
        address.className = "thread-person-email";
        address.textContent = person.email || "";
        chip.append(name, address);
        return chip;
      })
    );

    els.threadInterview.textContent = thread.interview?.date
      ? formatInterview(thread.interview.date)
      : "No interview scheduled";

    const preparation = thread.prep?.length ? thread.prep : thread.actions.slice(0, 4);
    if (preparation.length) {
      els.threadPrep.replaceChildren(
        ...preparation.map((item) => {
          const li = document.createElement("li");
          li.textContent = item;
          return li;
        })
      );
    } else {
      const empty = document.createElement("li");
      empty.className = "is-empty";
      empty.textContent = "No specific preparation requested.";
      els.threadPrep.replaceChildren(empty);
    }

    els.threadTimeline.replaceChildren(
      ...thread.messages.map((message) => {
        const item = document.createElement("li");
        item.className = `thread-event is-${message.direction === "outgoing" ? "out" : "in"}`;

        const dot = document.createElement("span");
        dot.className = "thread-event-dot";
        dot.setAttribute("aria-hidden", "true");

        const body = document.createElement("div");
        body.className = "thread-event-body";

        const head = document.createElement("span");
        head.className = "thread-event-head";
        const who = message.direction === "outgoing" ? "You" : message.from?.name || message.from?.email || "Unknown";
        head.textContent = `${who} · ${formatFullDate(message.receivedAt)}`;

        const gist = document.createElement("p");
        gist.className = "thread-event-text";
        gist.textContent = message.ai?.summary || message.body || "";

        body.append(head, gist);
        item.append(dot, body);
        return item;
      })
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Human-in-the-loop feedback                                        */
  /* ------------------------------------------------------------------ */

  function categoryOption(category, selected) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.label;
    option.selected = category.id === selected;
    return option;
  }

  function renderFeedback(email) {
    if (!els.feedbackBox) return;

    const current = email.analysis.category;
    if (els.categoryOverride) {
      els.categoryOverride.replaceChildren(
        ...CATEGORIES.map((category) => categoryOption(category, current))
      );
      els.categoryOverride.value = current;
    }

    els.feedbackCorrection.hidden = true;
    els.feedbackCorrect.disabled = false;
    els.feedbackIncorrect.disabled = false;
    els.feedbackBox.classList.remove("is-correct", "is-incorrect", "is-offline");

    const feedback = email.feedback;
    if (state.feedbackOffline) {
      els.feedbackState.textContent = "Service offline";
      els.feedbackBox.classList.add("is-offline");
    } else if (!feedback) {
      els.feedbackState.textContent = "Not reviewed";
    } else if (feedback.type === "correct") {
      els.feedbackState.textContent = `Confirmed correct · ${feedback.modelVersion || "model"}`;
      els.feedbackBox.classList.add("is-correct");
    } else {
      const label = CATEGORY_BY_ID[feedback.corrected]?.label || feedback.corrected;
      els.feedbackState.textContent = `Corrected to ${label} · ${feedback.modelVersion || "model"}`;
      els.feedbackBox.classList.add("is-incorrect");
    }
  }

  function feedbackPayload(email, type, corrected) {
    const predicted = email.analysis.originalCategory || email.analysis.category;
    const confidence = Number(
      (email.ai?.model?.confidence ?? (email.analysis.confidence || 50) / 100).toFixed(4)
    );
    const payload = {
      email_id: email.id,
      email_subject: email.subject,
      email_text: email.body,
      predicted_category: predicted,
      original_confidence: Math.max(0, Math.min(1, confidence)),
      feedback_type: type
    };
    if (state.modelVersion) payload.model_version = state.modelVersion;
    if (type === "incorrect") payload.corrected_category = corrected;
    return payload;
  }

  async function submitCategoryFeedback(email, type, corrected = null) {
    if (!email || !email.analysis) return;
    const predicted = email.analysis.originalCategory || email.analysis.category;
    if (type === "incorrect" && (!corrected || corrected === predicted)) {
      toast("Choose a category that differs from the prediction.");
      return;
    }

    try {
      const saved = await submitFeedback(feedbackPayload(email, type, corrected));
      state.feedbackOffline = false;
      state.modelVersion = saved.model_version || state.modelVersion;
      email.feedback = {
        type: saved.feedback_type,
        corrected: saved.corrected_category,
        modelVersion: saved.model_version,
        at: saved.created_at
      };

      if (saved.feedback_type === "incorrect" && CATEGORY_BY_ID[saved.corrected_category]) {
        email.analysis.originalCategory = predicted;
        email.analysis.category = saved.corrected_category;
        email.analysis.categoryLabel = CATEGORY_BY_ID[saved.corrected_category].label;
      }

      await refreshFeedbackTotals();
      renderAll();
      toast(
        saved.feedback_type === "correct"
          ? `Prediction confirmed and saved as ${saved.model_version}.`
          : `Correction saved as ${saved.model_version}. No retraining was triggered.`
      );
    } catch (error) {
      if (error.status === 0) state.feedbackOffline = true;
      renderFeedback(email);
      toast(error.message || "Feedback could not be saved.");
    }
  }

  function applyStoredFeedback(rows) {
    const latest = new Map();
    for (const row of rows) {
      if (!latest.has(row.email_id)) latest.set(row.email_id, row);
    }

    for (const email of state.emails) {
      const row = latest.get(email.id);
      if (!row) continue;
      email.feedback = {
        type: row.feedback_type,
        corrected: row.corrected_category,
        modelVersion: row.model_version,
        at: row.created_at
      };
      if (row.feedback_type === "incorrect" && CATEGORY_BY_ID[row.corrected_category]) {
        email.analysis.originalCategory =
          email.analysis.originalCategory || row.predicted_category;
        email.analysis.category = row.corrected_category;
        email.analysis.categoryLabel = CATEGORY_BY_ID[row.corrected_category].label;
      }
    }
  }

  async function refreshFeedbackTotals() {
    if (!isBackendConfigured()) {
      state.feedbackOffline = true;
      return;
    }
    try {
      const analytics = await fetchAnalytics();
      state.feedbackTotal = analytics.total_feedback;
      if (els.feedbackTotal) els.feedbackTotal.textContent = String(state.feedbackTotal);
    } catch {
      state.feedbackOffline = true;
    }
  }

  async function syncFeedbackData({ rerender = false } = {}) {
    if (!isBackendConfigured()) {
      state.feedbackOffline = true;
      if (rerender) renderAll();
      return;
    }
    try {
      const [health, analytics] = await Promise.all([fetchHealth(), fetchAnalytics()]);
      state.feedbackOffline = false;
      state.modelVersion = health.active_model;
      state.feedbackTotal = analytics.total_feedback;
      if (els.feedbackTotal) els.feedbackTotal.textContent = String(state.feedbackTotal);

      // Stored feedback contains email identifiers and subjects. Only fetch it
      // after an administrator has entered the private dashboard token.
      const adminToken = els.feedbackToken?.value.trim();
      if (!state.feedbackHydrated && adminToken) {
        const rows = await fetchFeedback({ limit: 500, adminToken });
        applyStoredFeedback(rows);
        state.feedbackHydrated = true;
      }
    } catch {
      state.feedbackOffline = true;
    }
    if (rerender) renderAll();
  }

  function getAdminToken() {
    const token = els.feedbackToken?.value.trim();
    if (!token) {
      toast("Enter the admin token to review feedback, export data, approve corrections, retrain, or activate a model.");
      els.feedbackToken?.focus();
      return null;
    }
    return token;
  }

  function openFeedbackDashboard() {
    openDialog(els.feedbackDialog);
    renderFeedbackDashboard();
  }

  async function renderFeedbackDashboard() {
    if (!els.feedbackStats) return;
    const adminToken = getAdminToken();
    if (!adminToken) {
      els.feedbackStats.replaceChildren();
      els.feedbackCategories.replaceChildren();
      els.feedbackList.replaceChildren();
      els.feedbackModels.replaceChildren();
      els.feedbackModel.textContent = "Enter the admin token to view private feedback records.";
      els.feedbackApproved.textContent = "Locked";
      return;
    }
    els.feedbackStats.replaceChildren();
    els.feedbackCategories.replaceChildren();
    els.feedbackList.replaceChildren();
    els.feedbackModels.replaceChildren();
    els.feedbackModel.textContent = "Loading the feedback service…";
    els.feedbackApproved.textContent = "…";
    if (els.feedbackAdminNote) {
      els.feedbackAdminNote.textContent = "Retraining is manual. A candidate is evaluated before activation.";
    }

    try {
      const [analytics, recent, versions] = await Promise.all([
        fetchAnalytics(),
        fetchFeedback({ limit: 25, adminToken }),
        fetchModelVersions()
      ]);

      state.feedbackOffline = false;
      state.feedbackTotal = analytics.total_feedback;
      if (els.feedbackTotal) els.feedbackTotal.textContent = String(state.feedbackTotal);
      if (!state.feedbackHydrated) {
        applyStoredFeedback(recent);
        state.feedbackHydrated = true;
      }

      const currentEmail = selectedEmail();
      if (currentEmail) renderFeedback(currentEmail);

      const stats = [
        { label: "Total feedback", value: analytics.total_feedback },
        { label: "Corrected predictions", value: analytics.corrected_predictions },
        {
          label: "User agreement · not accuracy",
          value: `${(analytics.user_agreement_rate * 100).toFixed(1)}%`
        },
        { label: "Approved for training", value: analytics.approved_for_training }
      ];
      els.feedbackStats.replaceChildren(
        ...stats.map((stat) => {
          const card = document.createElement("div");
          card.className = "brief-stat";
          const value = document.createElement("strong");
          value.textContent = String(stat.value);
          const label = document.createElement("span");
          label.textContent = stat.label;
          card.append(value, label);
          return card;
        })
      );

      if (!analytics.most_frequently_corrected_categories.length) {
        const empty = document.createElement("li");
        empty.className = "feedback-empty";
        empty.textContent = "No corrections yet. Agreement feedback is counted separately.";
        els.feedbackCategories.replaceChildren(empty);
      } else {
        const highest = analytics.most_frequently_corrected_categories[0].count || 1;
        els.feedbackCategories.replaceChildren(
          ...analytics.most_frequently_corrected_categories.map((entry) => {
            const item = document.createElement("li");
            item.className = "feedback-category-row";
            const label = document.createElement("span");
            label.className = "feedback-category-name";
            label.textContent = CATEGORY_BY_ID[entry.category]?.label || entry.category;
            const bar = document.createElement("span");
            bar.className = "feedback-category-bar";
            const fill = document.createElement("span");
            fill.style.width = `${Math.max(4, Math.round((entry.count / highest) * 100))}%`;
            bar.append(fill);
            const count = document.createElement("b");
            count.textContent = String(entry.count);
            item.append(label, bar, count);
            return item;
          })
        );
      }

      if (analytics.current_model) {
        const model = analytics.current_model;
        const accuracy = `${(model.accuracy * 100).toFixed(1)}%`;
        const macroF1 = `${(model.macro_f1 * 100).toFixed(1)}%`;
        els.feedbackModel.textContent = `${model.version} · active · model accuracy ${accuracy} on a ${model.test_size}-example labelled holdout · macro F1 ${macroF1}. User agreement is reported separately.`;
      } else {
        els.feedbackModel.textContent = "No active model version.";
      }

      els.feedbackApproved.textContent = `${analytics.approved_for_training} approved`;
      if (!recent.length) {
        const empty = document.createElement("li");
        empty.className = "feedback-empty";
        empty.textContent = "No feedback submissions yet.";
        els.feedbackList.replaceChildren(empty);
      } else {
        els.feedbackList.replaceChildren(
          ...recent.map((row) => {
            const item = document.createElement("li");
            item.className = "feedback-item";

            const main = document.createElement("div");
            main.className = "feedback-item-main";
            const subject = document.createElement("span");
            subject.className = "feedback-item-subject";
            subject.textContent = row.email_subject || row.email_id;
            const change = document.createElement("span");
            change.className = "feedback-item-change";
            change.textContent =
              row.feedback_type === "correct"
                ? `Confirmed ${CATEGORY_BY_ID[row.predicted_category]?.label || row.predicted_category}`
                : `${CATEGORY_BY_ID[row.predicted_category]?.label || row.predicted_category} → ${
                    CATEGORY_BY_ID[row.corrected_category]?.label || row.corrected_category
                  }`;
            const meta = document.createElement("span");
            meta.className = "feedback-item-meta";
            meta.textContent = `${row.model_version} · ${Math.round(row.original_confidence * 100)}% confidence · ${new Date(
              row.created_at
            ).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;
            main.append(subject, change, meta);

            const actions = document.createElement("div");
            actions.className = "feedback-item-actions";
            if (row.approved_for_training) {
              const badge = document.createElement("span");
              badge.className = "feedback-approved-badge";
              badge.textContent = "Approved";
              actions.append(badge);
            } else {
              const approve = document.createElement("button");
              approve.type = "button";
              approve.className = "micro-action";
              approve.dataset.feedbackApprove = String(row.id);
              approve.textContent = "Approve";
              actions.append(approve);
            }

            item.append(main, actions);
            return item;
          })
        );
      }

      els.feedbackModels.replaceChildren(
        ...versions.map((model) => {
          const item = document.createElement("li");
          item.className = "feedback-model-row";

          const main = document.createElement("div");
          main.className = "feedback-model-main";
          const name = document.createElement("span");
          name.className = "feedback-model-name";
          name.textContent = `${model.version} · ${model.training_size} training examples${
            model.feedback_count ? ` · ${model.feedback_count} approved feedback` : ""
          }`;
          const metrics = document.createElement("span");
          metrics.className = "feedback-model-meta";
          metrics.textContent = `Accuracy ${(model.accuracy * 100).toFixed(1)}% · macro F1 ${(
            model.macro_f1 * 100
          ).toFixed(1)}% · ${model.test_size}-example labelled holdout`;
          main.append(name, metrics);

          if (model.is_active) {
            const badge = document.createElement("span");
            badge.className = "feedback-active-badge";
            badge.textContent = "Active";
            item.append(main, badge);
          } else {
            const activate = document.createElement("button");
            activate.type = "button";
            activate.className = "micro-action";
            activate.dataset.feedbackActivate = model.version;
            activate.textContent = "Activate";
            item.append(main, activate);
          }
          return item;
        })
      );
    } catch (error) {
      const unauthorized = error?.status === 401;
      state.feedbackOffline = !unauthorized;
      const currentEmail = selectedEmail();
      if (currentEmail) renderFeedback(currentEmail);
      const offline = document.createElement("div");
      offline.className = "brief-stat";
      const value = document.createElement("strong");
      value.textContent = unauthorized ? "Access denied" : "Offline";
      const label = document.createElement("span");
      label.textContent = unauthorized
        ? "The admin token was rejected. Check the token configured on the backend."
        : "Start the FastAPI backend to load feedback";
      offline.append(value, label);
      els.feedbackStats.replaceChildren(offline);
      els.feedbackModel.textContent = error.message;
      els.feedbackApproved.textContent = "Unavailable";
      const empty = document.createElement("li");
      empty.className = "feedback-empty";
      empty.textContent = unauthorized
        ? "Private feedback records remain hidden until a valid admin token is supplied."
        : "No analytics are shown because the local service is not reachable. Nothing is fabricated.";
      els.feedbackCategories.replaceChildren(empty);
      els.feedbackList.replaceChildren(empty.cloneNode(true));
      els.feedbackModels.replaceChildren(empty.cloneNode(true));
    }
  }

  function renderDeadline(email) {
    els.deadline.classList.remove("is-soon", "is-none");
    const deadline = email.deadline;
    if (!deadline) {
      els.deadline.textContent = "None found";
      els.deadline.classList.add("is-none");
      els.deadlineNote.textContent = "No date cue in this message.";
      return;
    }

    const delta = deadline.date.getTime() - DEMO_NOW.getTime();
    els.deadline.textContent = formatDeadline(deadline.date, DEMO_NOW);
    if (delta < 0) {
      els.deadline.classList.add("is-soon");
      els.deadlineNote.textContent = "This date is in the past on the demo clock.";
    } else if (delta <= 2 * DAY_MS) {
      els.deadline.classList.add("is-soon");
      els.deadlineNote.textContent = "Due within 48 hours. A reminder is set earlier.";
    } else {
      els.deadlineNote.textContent = "Extracted from the message. Times use the demo clock.";
    }
  }

  function renderActions(email) {
    const actions = email.actions || [];
    if (!actions.length) {
      const item = document.createElement("li");
      item.className = "is-empty";
      item.textContent = "No clear action. Read and decide.";
      els.actions.replaceChildren(item);
      return;
    }
    els.actions.replaceChildren(
      ...actions.map((action) => {
        const item = document.createElement("li");
        item.textContent = action;
        return item;
      })
    );
  }

  function renderReply(email) {
    const isSpam = email.analysis.category === "spam";
    const replied = Boolean(email.replied);

    els.replyCard.hidden = isSpam;
    els.spamNote.hidden = !isSpam;
    els.sentNote.hidden = !replied;
    els.review.hidden = isSpam || replied;
    els.copy.hidden = isSpam;
    els.replyNote.hidden = replied;
    els.replyError.hidden = true;

    if (isSpam) return;

    els.reply.readOnly = replied;
    els.reply.value = email.replySent || email.reply || "";
    els.reply.setAttribute("aria-label", `Reply draft for ${email.from.name}`);
  }

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function formatFullDate(date) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date);
  }

  function formatInterview(date) {
    const day = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date);
    return `${day} at ${time}`;
  }

  /* ------------------------------------------------------------------ */
  /*  Interaction: filters and search                                   */
  /* ------------------------------------------------------------------ */

  function selectEmail(id, { markRead = true, openOverlay = true } = {}) {
    const email = state.emails.find((item) => item.id === id);
    if (!email) return;

    state.selectedId = id;
    if (markRead) email.read = true;

    renderList();
    renderDetail();
    renderStats();
    if (openOverlay && narrow.matches) openDetailOverlay();
  }

  function ensureSelectionVisible() {
    const visible = filteredEmails();
    if (!visible.some((email) => email.id === state.selectedId)) {
      state.selectedId = visible[0]?.id || null;
      if (!state.selectedId) closeDetailOverlay();
    }
  }

  function setFilter(category) {
    state.filter = category;
    ensureSelectionVisible();
    renderFilters();
    renderList();
    renderDetail();
    els.resultCount.textContent = resultLabel();
  }

  els.filters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    setFilter(button.dataset.category);
  });

  els.search?.addEventListener("input", () => {
    state.query = els.search.value;
    ensureSelectionVisible();
    renderList();
    renderDetail();
    els.resultCount.textContent = resultLabel();
  });

  els.clearFilters?.addEventListener("click", () => {
    state.filter = "all";
    state.query = "";
    els.search.value = "";
    ensureSelectionVisible();
    renderAll();
    els.search.focus();
  });

  els.retry?.addEventListener("click", () => loadTestInbox());

  els.list?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (!button) return;
    selectEmail(button.dataset.id, { markRead: true, openOverlay: true });
  });

  els.similarList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-similar-id]");
    if (!button) return;
    selectEmail(button.dataset.similarId, { markRead: true, openOverlay: true });
  });

  els.semanticToggle?.addEventListener("click", () => {
    state.semantic = !state.semantic;
    ensureSelectionVisible();
    renderTools();
    renderList();
    renderDetail();
    els.resultCount.textContent = resultLabel();
    if (state.semantic) toast("Semantic search on. Results are ranked by meaning.");
  });

  els.sortToggle?.addEventListener("click", () => {
    state.sort = state.sort === "priority" ? "newest" : "priority";
    ensureSelectionVisible();
    renderTools();
    renderList();
    renderDetail();
    els.resultCount.textContent = resultLabel();
    toast(state.sort === "priority" ? "Sorted by AI priority." : "Sorted by newest first.");
  });

  /* ------------------------------------------------------------------ */
  /*  Interaction: reply and approval                                   */
  /* ------------------------------------------------------------------ */

  els.reply?.addEventListener("input", () => {
    const email = selectedEmail();
    if (!email) return;
    email.reply = els.reply.value;
    email.replyTone = null;
    updateToneButtons(null);
    els.replyError.hidden = true;
  });

  root.querySelectorAll("[data-tone]").forEach((button) => {
    button.addEventListener("click", () => {
      const email = selectedEmail();
      if (!email || email.analysis.category === "spam" || email.replied) return;
      const tone = button.dataset.tone;
      const draft = rewriteReply(email, tone);
      if (!draft) return;
      email.reply = draft;
      email.replyTone = tone;
      els.reply.value = draft;
      updateToneButtons(tone);
      toast(`Draft rewritten in a ${tone} tone.`);
    });
  });

  function updateToneButtons(tone) {
    root.querySelectorAll("[data-tone]").forEach((button) => {
      const active = button.dataset.tone === tone;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  els.review?.addEventListener("click", openApproval);
  els.copy?.addEventListener("click", copyDraft);

  function openApproval() {
    const email = selectedEmail();
    if (!email || email.analysis.category === "spam" || email.replied) return;

    const draft = els.reply.value.trim();
    if (!draft) {
      els.replyError.hidden = false;
      els.reply.focus();
      return;
    }

    state.pending = email;
    approvalTo.textContent = `${email.from.name} · ${email.from.email}`;
    approvalSubject.textContent = email.subject;
    approvalDraft.value = draft;
    approveCheck.checked = false;
    approveConfirm.disabled = true;
    openDialog(approvalDialog);
  }

  approveCheck?.addEventListener("change", () => {
    approveConfirm.disabled = !approveCheck.checked;
  });

  approveConfirm?.addEventListener("click", () => {
    const email = state.pending;
    if (!email || !approveCheck.checked) return;

    const draft = approvalDraft.value.trim();
    if (!draft) {
      approvalDraft.focus();
      return;
    }

    email.reply = draft;
    email.replySent = draft;
    email.replied = true;
    email.read = true;
    email.sentAt = new Date().toISOString();
    if (email.reminder) email.reminder.done = true;

    state.pending = null;
    closeDialog(approvalDialog);
    renderAll();
    toast("Send simulated. The reply is logged on this page only.");
  });

  [document.querySelector("[data-approval-close]"), document.querySelector("[data-approval-cancel]")].forEach(
    (button) => button?.addEventListener("click", () => closeDialog(approvalDialog))
  );

  approvalDialog?.addEventListener("close", () => {
    state.pending = null;
    approveCheck.checked = false;
    approveConfirm.disabled = true;
  });

  async function copyDraft() {
    const text = els.reply.value.trim();
    if (!text) {
      toast("There is no draft to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("Draft copied to the clipboard.");
    } catch {
      els.reply.focus();
      els.reply.select();
      try {
        document.execCommand("copy");
        toast("Draft copied to the clipboard.");
      } catch {
        toast("Copy is blocked by this browser. Select the draft and copy it.");
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Interaction: reminders                                            */
  /* ------------------------------------------------------------------ */

  els.remindersToggle?.addEventListener("click", () => {
    renderReminders();
    openDialog(remindersDialog);
  });

  document
    .querySelector("[data-reminders-close]")
    ?.addEventListener("click", () => closeDialog(remindersDialog));

  reminderList?.addEventListener("click", (event) => {
    const open = event.target.closest("[data-reminder-open]");
    const done = event.target.closest("[data-reminder-done]");
    const undo = event.target.closest("[data-reminder-undo]");

    if (open) {
      const email = state.emails.find((item) => item.id === open.dataset.reminderOpen);
      if (!email) return;
      closeDialog(remindersDialog);
      state.filter = "all";
      state.query = "";
      els.search.value = "";
      updateFilterButtons();
      ensureSelectionVisible();
      selectEmail(email.id, { markRead: true, openOverlay: true });
      renderFilters();
      els.resultCount.textContent = resultLabel();
      return;
    }

    if (done) {
      const email = state.emails.find((item) => item.id === done.dataset.reminderDone);
      if (!email?.reminder) return;
      email.reminder.done = true;
      renderReminders();
      renderReminderCount();
      renderStats();
      toast("Reminder marked done.");
      return;
    }

    if (undo) {
      const email = state.emails.find((item) => item.id === undo.dataset.reminderUndo);
      if (!email?.reminder) return;
      email.reminder.done = false;
      renderReminders();
      renderReminderCount();
      toast("Reminder reopened.");
    }
  });

  function renderReminders() {
    const reminders = state.emails
      .filter((email) => email.reminder)
      .sort((a, b) => {
        if (a.reminder.done !== b.reminder.done) return a.reminder.done ? 1 : -1;
        return new Date(a.reminder.dueAt).getTime() - new Date(b.reminder.dueAt).getTime();
      });

    reminderEmpty.hidden = reminders.length > 0;
    const fragment = document.createDocumentFragment();

    for (const email of reminders) {
      const item = document.createElement("li");
      item.className = `reminder-item cat-${email.analysis.category}`;
      item.classList.toggle("is-done", email.reminder.done);

      const main = document.createElement("div");
      main.className = "reminder-main";
      const when = document.createElement("span");
      when.className = "reminder-when";
      when.textContent = formatDeadline(new Date(email.reminder.dueAt), DEMO_NOW);
      const subject = document.createElement("span");
      subject.className = "reminder-subject";
      subject.textContent = email.subject;
      const action = document.createElement("span");
      action.className = "reminder-action";
      action.textContent = email.reminder.label;
      main.append(when, subject, action);

      const buttons = document.createElement("div");
      buttons.className = "reminder-buttons";

      const open = document.createElement("button");
      open.type = "button";
      open.className = "reminder-open";
      open.dataset.reminderOpen = email.id;
      open.textContent = "Open";

      const done = document.createElement("button");
      done.type = "button";
      if (email.reminder.done) {
        done.className = "reminder-done";
        done.dataset.reminderUndo = email.id;
        done.textContent = "Undo";
      } else {
        done.className = "reminder-done";
        done.dataset.reminderDone = email.id;
        done.textContent = "Mark done";
      }

      buttons.append(open, done);
      item.append(main, buttons);
      fragment.append(item);
    }

    reminderList.replaceChildren(fragment);
  }

  /* ------------------------------------------------------------------ */
  /*  Interaction: AI daily brief                                       */
  /* ------------------------------------------------------------------ */

  document.querySelector("[data-brief-toggle]")?.addEventListener("click", renderBrief);
  document.querySelector("[data-brief-close]")?.addEventListener("click", () => closeDialog(briefDialog));

  briefList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-brief-open]");
    if (!button) return;
    const email = state.emails.find((item) => item.id === button.dataset.briefOpen);
    closeDialog(briefDialog);
    if (!email) return;
    state.filter = "all";
    state.query = "";
    els.search.value = "";
    email.read = true;
    renderAll();
    selectEmail(email.id, { markRead: true, openOverlay: true });
    document.getElementById("demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function renderBrief() {
    const brief = buildInboxBrief(state.emails, DEMO_NOW);
    briefLede.textContent = brief.lede;

    briefStats.replaceChildren(
      ...brief.stats.map((stat) => {
        const card = document.createElement("div");
        card.className = "brief-stat";
        const value = document.createElement("strong");
        value.textContent = String(stat.value);
        const label = document.createElement("span");
        label.textContent = stat.label;
        card.append(value, label);
        return card;
      })
    );

    if (!brief.focus.length) {
      const empty = document.createElement("li");
      empty.className = "brief-empty";
      empty.textContent = "Nothing urgent. The inbox is clear enough to leave alone.";
      briefList.replaceChildren(empty);
    } else {
      briefList.replaceChildren(
        ...brief.focus.map((email, index) => {
          const item = document.createElement("li");
          item.className = "brief-item";

          const rank = document.createElement("span");
          rank.className = "brief-rank";
          rank.textContent = String(index + 1).padStart(2, "0");

          const main = document.createElement("div");
          main.className = "brief-main";
          const subject = document.createElement("span");
          subject.className = "brief-subject";
          subject.textContent = email.subject;
          const meta = document.createElement("span");
          meta.className = "brief-meta";
          meta.textContent = `${email.from.name} · ${email.ai.priority.score}/100 · ${email.ai.priority.band}`;
          const reason = document.createElement("span");
          reason.className = "brief-reason";
          reason.textContent = email.ai.priority.factors[0]?.detail || "Highest AI priority";
          main.append(subject, meta, reason);

          const open = document.createElement("button");
          open.type = "button";
          open.className = "brief-open";
          open.dataset.briefOpen = email.id;
          open.textContent = "Open";

          item.append(rank, main, open);
          return item;
        })
      );
    }

    briefPlan.replaceChildren(
      ...brief.plan.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      })
    );

    openDialog(briefDialog);
  }

  /* ------------------------------------------------------------------ */
  /*  Interaction: human-in-the-loop feedback                           */
  /* ------------------------------------------------------------------ */

  document.querySelector("[data-feedback-toggle]")?.addEventListener("click", openFeedbackDashboard);
  els.feedbackClose?.addEventListener("click", () => closeDialog(els.feedbackDialog));

  els.feedbackCorrect?.addEventListener("click", () => {
    const email = selectedEmail();
    if (email) submitCategoryFeedback(email, "correct");
  });

  els.feedbackIncorrect?.addEventListener("click", () => {
    const email = selectedEmail();
    if (!email) return;
    const current = email.analysis.originalCategory || email.analysis.category;
    els.feedbackCategory.replaceChildren(
      ...CATEGORIES.filter((category) => category.id !== current).map((category) =>
        categoryOption(category, null)
      )
    );
    els.feedbackCorrection.hidden = false;
    els.feedbackCategory.focus();
  });

  els.feedbackCancel?.addEventListener("click", () => {
    els.feedbackCorrection.hidden = true;
  });

  els.feedbackSave?.addEventListener("click", () => {
    const email = selectedEmail();
    if (!email) return;
    submitCategoryFeedback(email, "incorrect", els.feedbackCategory.value);
  });

  els.categoryOverride?.addEventListener("change", () => {
    const email = selectedEmail();
    if (!email) return;
    const next = els.categoryOverride.value;
    if (next === email.analysis.category) {
      renderFeedback(email);
      return;
    }
    submitCategoryFeedback(email, "incorrect", next);
  });

  els.feedbackList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-feedback-approve]");
    if (!button) return;
    const token = getAdminToken();
    if (!token) return;
    button.disabled = true;
    try {
      await approveFeedback(Number(button.dataset.feedbackApprove), token);
      toast("Feedback approved for training.");
      await renderFeedbackDashboard();
    } catch (error) {
      button.disabled = false;
      toast(error.message || "Feedback could not be approved.");
    }
  });

  els.feedbackModels?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-feedback-activate]");
    if (!button) return;
    const token = getAdminToken();
    if (!token) return;
    button.disabled = true;
    try {
      const model = await activateModel(button.dataset.feedbackActivate, token);
      state.modelVersion = model.version;
      toast(`${model.version} is now the active model.`);
      await renderFeedbackDashboard();
      renderAll();
    } catch (error) {
      button.disabled = false;
      toast(error.message || "The model could not be activated.");
    }
  });

  els.feedbackExport?.addEventListener("click", async () => {
    const token = getAdminToken();
    if (!token) return;
    try {
      const { blob, filename } = await exportFeedbackCsv({ approvedOnly: true, adminToken: token });
      downloadBlob(blob, filename);
      toast("Approved feedback exported as CSV.");
    } catch (error) {
      toast(error.message || "The CSV could not be exported.");
    }
  });

  els.feedbackExportAll?.addEventListener("click", async () => {
    const token = getAdminToken();
    if (!token) return;
    try {
      const { blob, filename } = await exportFeedbackCsv({ approvedOnly: false, adminToken: token });
      downloadBlob(blob, filename);
      toast("All feedback exported as CSV.");
    } catch (error) {
      toast(error.message || "The CSV could not be exported.");
    }
  });

  els.feedbackRetrain?.addEventListener("click", async () => {
    const token = getAdminToken();
    if (!token) return;
    els.feedbackRetrain.disabled = true;
    if (els.feedbackAdminNote) els.feedbackAdminNote.textContent = "Training a candidate model…";
    try {
      const result = await retrainModel(token);
      const accuracy = (result.evaluation.accuracy * 100).toFixed(1);
      const macroF1 = (result.evaluation.macro_f1 * 100).toFixed(1);
      await renderFeedbackDashboard();
      if (els.feedbackAdminNote) {
        els.feedbackAdminNote.textContent = `Candidate ${result.candidate.version} trained from ${
          result.training_samples
        } examples (${result.feedback_used} approved feedback). Holdout accuracy ${accuracy}%, macro F1 ${macroF1}%. ${
          result.recommended ? "It matches or beats the active model." : "It does not beat the active model."
        } It is inactive until you activate it.`;
      }
      toast(`Candidate ${result.candidate.version} trained and evaluated. Not deployed.`);
    } catch (error) {
      if (els.feedbackAdminNote) {
        els.feedbackAdminNote.textContent = error.message || "Retraining failed.";
      }
      toast(error.message || "Retraining failed.");
    } finally {
      els.feedbackRetrain.disabled = false;
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Interaction: mobile detail overlay                               */
  /* ------------------------------------------------------------------ */

  function openDetailOverlay() {
    if (!narrow.matches) return;
    els.detailPane.classList.add("is-open");
    els.scrim.hidden = false;
    requestAnimationFrame(() => els.scrim.classList.add("is-visible"));
    document.body.classList.add("has-detail-overlay");
  }

  function closeDetailOverlay() {
    els.detailPane.classList.remove("is-open");
    els.scrim.classList.remove("is-visible");
    els.scrim.hidden = true;
    document.body.classList.remove("has-detail-overlay");
  }

  els.detailClose?.addEventListener("click", closeDetailOverlay);
  els.scrim?.addEventListener("click", closeDetailOverlay);
  narrow.addEventListener("change", () => {
    if (!narrow.matches) closeDetailOverlay();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.detailPane.classList.contains("is-open")) {
      closeDetailOverlay();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Interaction: upload and reset                                    */
  /* ------------------------------------------------------------------ */

  document
    .querySelectorAll("[data-upload-trigger], [data-open-upload]")
    .forEach((button) => button.addEventListener("click", openPicker));

  function openPicker() {
    uploadInput?.click();
  }

  dropzone?.addEventListener("click", openPicker);
  dropzone?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  });

  uploadInput?.addEventListener("change", () => {
    const file = uploadInput.files?.[0];
    uploadInput.value = "";
    if (file) processFile(file);
  });

  let dragDepth = 0;
  dropzone?.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    dropzone.classList.add("is-dragging");
  });

  dropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  dropzone?.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropzone.classList.remove("is-dragging");
  });

  dropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove("is-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) processFile(file);
  });

  document.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
  });

  document.addEventListener("drop", (event) => {
    if (event.dataTransfer?.files?.length) event.preventDefault();
  });

  async function processFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showUploadError("That file is larger than 2 MB. Split it into smaller files.");
      return;
    }

    els.status.textContent = `Reading ${file.name}…`;
    try {
      const text = await file.text();
      const result = parseDataset(text, file.name);
      applyDataset(result.emails, result.label, file.name);
      showUploadResult(result, file.name);
      document.getElementById("demo")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    } catch (error) {
      showUploadError(error.message || "That file could not be read.");
      renderStatus();
    }
  }

  function showUploadResult(result, filename) {
    if (!uploadResult) return;
    uploadResult.hidden = false;
    uploadResult.classList.remove("is-error");
    uploadResult.replaceChildren();

    const heading = document.createElement("strong");
    heading.textContent = `Loaded ${result.emails.length} messages from ${filename}.`;
    uploadResult.append(heading);

    if (result.errors.length) {
      const copy = document.createElement("p");
      copy.textContent = `${result.errors.length} row${result.errors.length === 1 ? "" : "s"} skipped:`;
      uploadResult.append(copy);
      const list = document.createElement("ul");
      result.errors.slice(0, 6).forEach((error) => {
        const item = document.createElement("li");
        item.textContent = `Row ${error.row}: ${error.message}`;
        list.append(item);
      });
      uploadResult.append(list);
    } else {
      const copy = document.createElement("p");
      copy.textContent = "Every row had a sender, subject and body.";
      uploadResult.append(copy);
    }

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "text-link";
    jump.textContent = "Open the live inbox";
    jump.addEventListener("click", () => {
      document.getElementById("demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    uploadResult.append(jump);
  }

  function showUploadError(message) {
    if (!uploadResult) {
      toast(message);
      return;
    }
    uploadResult.hidden = false;
    uploadResult.classList.add("is-error");
    uploadResult.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "That file could not be loaded.";
    const copy = document.createElement("p");
    copy.textContent = message;
    uploadResult.append(heading, copy);
    toast(message);
  }

  document.querySelector("[data-reset]")?.addEventListener("click", () => {
    loadTestInbox({ announce: true });
    if (uploadResult) uploadResult.hidden = true;
  });

  document.querySelector("[data-load-test]")?.addEventListener("click", () => {
    loadTestInbox({ announce: true });
    if (uploadResult) uploadResult.hidden = true;
  });

  /* ------------------------------------------------------------------ */
  /*  Modal helpers and boot                                           */
  /* ------------------------------------------------------------------ */

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  [approvalDialog, remindersDialog, briefDialog, els.feedbackDialog].forEach((dialog) => {
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("is-visible"), 4400);
  }

  document.querySelector("[data-toast]")?.addEventListener("click", () => {
    toastEl.classList.remove("is-visible");
  });

  updateFilterButtons();
  renderReminderCount();
  loadTestInbox();

  function updateFilterButtons() {
    root.querySelectorAll("[data-category]").forEach((button) => {
      const active = button.dataset.category === state.filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  return {
    /** Local-only snapshot used by assistant features; never transmitted. */
    getAssistantSnapshot() {
      return state.emails.map((email) => ({
        id: email.id,
        from: { name: email.from?.name || "", email: email.from?.email || "" },
        subject: email.subject || "",
        body: email.body || "",
        read: Boolean(email.read),
        replied: Boolean(email.replied),
        analysis: email.analysis || {},
        deadline: email.deadline || null,
        actions: email.actions || [],
        ai: email.ai || {},
        reply: email.reply || null
      }));
    },

    /** Aggregate metadata only: no subjects, senders or message bodies. */
    getAnalyticsSnapshot() {
      const ratio = (value) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        return Math.min(1, Math.max(0, number / 100));
      };

      return {
        dataset: state.label || "Test inbox",
        messages: state.emails
          .filter((email) => email.analysis?.category)
          .map((email) => ({
            email_id: email.id,
            category: email.analysis.category,
            confidence: ratio(email.analysis.confidence),
            model_confidence:
              email.ai?.model?.ensembleConfidence !== undefined
                ? ratio(email.ai.model.ensembleConfidence)
                : null,
            priority: Math.round(Number(email.ai?.priority?.score) || 0),
            received_at: email.receivedAt instanceof Date ? email.receivedAt.toISOString() : null
          }))
      };
    }
  };
}
