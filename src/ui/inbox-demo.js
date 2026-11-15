import {
  triageEmail,
  formatDeadline,
  formatReceived,
  CATEGORY_BY_ID
} from "../lib/triage.js";
import { fetchTestInbox, parseDataset } from "../lib/dataset.js";

const DEMO_NOW = new Date("2026-11-15T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CATEGORY_CLASSES = ["cat-important", "cat-academic", "cat-internship", "cat-personal", "cat-spam"];

export function initInboxDemo(root) {
  if (!root) return;

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
    clearFilters: root.querySelector("[data-clear-filters]")
  };

  const uploadInput = document.querySelector("[data-upload-input]");
  const dropzone = document.querySelector("[data-dropzone]");
  const uploadResult = document.querySelector("[data-upload-result]");
  const approvalDialog = document.getElementById("approval-dialog");
  const remindersDialog = document.getElementById("reminders-dialog");
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
    pending: null
  };

  let toastTimer = 0;

  /* ------------------------------------------------------------------ */
  /*  Data                                                              */
  /* ------------------------------------------------------------------ */

  function analyse(rows) {
    return rows.map((row) => {
      const email = triageEmail(row, DEMO_NOW, { name: "Alex" });
      return { ...email, replied: false, replySent: null, sentAt: null };
    });
  }

  async function loadTestInbox({ announce = false } = {}) {
    setLoading(true);
    try {
      const data = await fetchTestInbox();
      state.emails = analyse(data.emails);
      setLoading(false);
      state.label = data.label;
      state.filter = "all";
      state.query = "";
      els.search.value = "";
      resetEmptyState();
      state.selectedId =
        state.emails.find((email) => email.id === "finance-budget-01")?.id ||
        state.emails[0]?.id ||
        null;
      updateFilterButtons();
      renderAll();
      if (announce) toast("Test inbox restored. 24 messages, 19 drafts.");
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
    state.emails = analyse(emails);
    setLoading(false);
    state.label = label || "Uploaded inbox";
    state.filter = "all";
    state.query = "";
    els.search.value = "";
    state.selectedId = state.emails[0]?.id || null;
    resetEmptyState();
    updateFilterButtons();
    renderAll();
    toast(`Loaded ${state.emails.length} messages from ${filename}.`);
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
    const query = state.query.trim().toLowerCase();
    return state.emails
      .filter((email) => state.filter === "all" || email.analysis.category === state.filter)
      .filter((email) => {
        if (!query) return true;
        return `${email.from.name} ${email.from.email} ${email.subject} ${email.body}`
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
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
    renderFilters();
    renderStats();
    renderList();
    renderDetail();
    renderReminderCount();
    renderStatus();
    els.resultCount.textContent = resultLabel();
  }

  function renderStatus() {
    els.status.textContent = `${state.label} · ${state.emails.length} messages · demo clock 15 Nov, 09:00`;
    if (els.demoLabel) els.demoLabel.textContent = state.label;
  }

  function resultLabel() {
    const count = filteredEmails().length;
    if (state.query.trim()) return `${count} matching`;
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
    els.statUnread.textContent = String(unread);
    els.statDue.textContent = String(dueSoonCount());
    els.statDrafts.textContent = String(drafts);
    els.statReplied.textContent = String(replied);
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

    if (!emails.length) {
      els.list.replaceChildren();
      els.empty.hidden = false;
      if (state.query.trim()) {
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
      closeDetailOverlay();
      return;
    }

    const category = email.analysis.category;
    const categoryClass = `cat-${category}`;
    els.detailBody.classList.remove(...CATEGORY_CLASSES);
    els.detailBody.classList.add(categoryClass);

    els.category.textContent = CATEGORY_BY_ID[category].label;
    els.categoryLabel.textContent = `${email.analysis.confidence}% match`;
    els.confidence.textContent = `${email.analysis.confidence}% match`;
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
    renderReply(email);
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

  /* ------------------------------------------------------------------ */
  /*  Interaction: reply and approval                                   */
  /* ------------------------------------------------------------------ */

  els.reply?.addEventListener("input", () => {
    const email = selectedEmail();
    if (!email) return;
    email.reply = els.reply.value;
    els.replyError.hidden = true;
  });

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

  [approvalDialog, remindersDialog].forEach((dialog) => {
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
}
