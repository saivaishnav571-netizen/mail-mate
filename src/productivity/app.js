import { buildAgenda, calculateHabitStreak, countCareerStages, generateStudyPlan, searchNotes, sortTasks, splitTaskIdeas, summarizeExpenses } from "./productivity/core.js";
import "./productivity.css";

const STORAGE_KEY = "mailmate-productivity-v1";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const today = () => new Date().toISOString().slice(0, 10);
const makeId = () => globalThis.crypto?.randomUUID?.() || `mm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const safeDate = (date) => date ? new Date(`${date}T12:00:00`) : null;
const dateLabel = (date) => safeDate(date)?.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) || "No date";
const money = (amount) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(amount) || 0);

const defaults = { tasks: [], events: [], studyPlan: [], notes: [], applications: [], habits: [], expenses: [], budget: 0 };
function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...defaults, ...parsed, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], events: Array.isArray(parsed.events) ? parsed.events : [], studyPlan: Array.isArray(parsed.studyPlan) ? parsed.studyPlan : [], notes: Array.isArray(parsed.notes) ? parsed.notes : [], applications: Array.isArray(parsed.applications) ? parsed.applications : [], habits: Array.isArray(parsed.habits) ? parsed.habits : [], expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [] };
  } catch { return structuredClone(defaults); }
}
let state = loadState();
let taskFilter = "all";
let noteQuery = "";

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { announce("Could not save. Browser storage may be full or disabled."); }
  renderAll();
}
function announce(message) {
  let toast = $("#hub-toast");
  if (!toast) { toast = document.createElement("div"); toast.id = "hub-toast"; toast.className = "hub-toast"; document.body.append(toast); }
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(announce.timer);
  announce.timer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, className, onClick) {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}
function empty(parent, message) { parent.append(el("p", "empty-state", message)); }
function moduleName(id) { return ({ overview:"Overview", tasks:"Tasks", study:"Study planner", notes:"Notes", calendar:"Calendar", career:"Career tracker", habits:"Habits", finance:"Expense tracker" })[id] || "Overview"; }
function openModule(id) {
  $$(".module-nav-item").forEach((item) => item.classList.toggle("active", item.dataset.module === id));
  $$(".module-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === id));
  $("#module-title").textContent = moduleName(id);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$("[data-module]").forEach((item) => item.addEventListener("click", () => openModule(item.dataset.module)));
$$("[data-go]").forEach((item) => item.addEventListener("click", () => openModule(item.dataset.go)));

function renderOverview() {
  const done = state.tasks.filter((t) => t.status === "done").length;
  const active = state.tasks.filter((t) => t.status !== "done").length;
  const streak = state.habits.reduce((best, h) => Math.max(best, calculateHabitStreak(h.checkins || [], today())), 0);
  const month = today().slice(0, 7);
  const spent = state.expenses.filter((e) => (e.date || "").startsWith(month)).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const metrics = [["Active tasks", active, "to keep moving"], ["Completed", done, "tasks finished"], ["Habits", state.habits.length, `${streak} day best streak`], ["Spent this month", money(spent), state.budget ? `${money(state.budget)} budget` : "Set a budget"]];
  const target = $("#overview-metrics"); target.replaceChildren();
  metrics.forEach(([label, value, hint]) => { const card = el("article", "metric-card"); card.append(el("span", "metric-label", label), el("strong", "metric-value", String(value)), el("small", "", hint)); target.append(card); });
  const taskTarget = $("#overview-tasks"); taskTarget.replaceChildren();
  const focus = sortTasks(state.tasks.filter((t) => t.status !== "done")).slice(0, 5);
  if (!focus.length) empty(taskTarget, "Nothing queued. Add a task to start.");
  focus.forEach((task) => { const row = el("div", "compact-row"); row.append(el("span", "priority-dot " + task.priority), el("span", "compact-title", task.title), el("span", "compact-meta", task.due ? dateLabel(task.due) : task.status)); taskTarget.append(row); });
  const agendaTarget = $("#overview-agenda"); agendaTarget.replaceChildren();
  const agenda = buildAgenda(state.tasks, state.events, today()).filter((item) => item.date >= today()).slice(0, 5);
  if (!agenda.length) empty(agendaTarget, "No upcoming dates. Add a task deadline or event.");
  agenda.forEach((item) => { const row = el("div", "compact-row"); row.append(el("span", "agenda-date", safeDate(item.date)?.toLocaleDateString(undefined, { month: "short", day: "numeric" }) || item.date), el("span", "compact-title", item.title), el("span", "compact-meta", item.kind)); agendaTarget.append(row); });
}
function renderTasks() {
  const open = state.tasks.filter((t) => t.status !== "done").length;
  const overdue = state.tasks.filter((t) => t.status !== "done" && t.due && t.due < today()).length;
  const done = state.tasks.filter((t) => t.status === "done").length;
  $("#task-kpis").textContent = `${open} open · ${overdue} overdue · ${done} completed`;
  const list = $("#task-list"); list.replaceChildren();
  let tasks = state.tasks;
  if (taskFilter !== "all") tasks = tasks.filter((t) => t.status === taskFilter);
  tasks = sortTasks(tasks);
  if (!tasks.length) return empty(list, taskFilter === "done" ? "Completed tasks will appear here." : "No tasks yet. Add one above.");
  tasks.forEach((task) => {
    const row = el("article", "task-card" + (task.status === "done" ? " is-done" : ""));
    const checkbox = button(task.status === "done" ? "✓" : "", "task-check", () => { task.status = task.status === "todo" ? "doing" : task.status === "doing" ? "done" : "todo"; save(); });
    checkbox.setAttribute("aria-label", "Change task status");
    const content = el("div", "task-content"); content.append(el("strong", "", task.title));
    const meta = el("div", "task-meta"); meta.append(el("span", "priority-badge priority-" + task.priority, task.priority), el("span", "status-badge", task.status === "doing" ? "In progress" : task.status === "done" ? "Completed" : "To do"));
    if (task.due) meta.append(el("span", "task-due" + (task.due < today() && task.status !== "done" ? " overdue" : ""), task.due < today() && task.status !== "done" ? "Overdue · " + dateLabel(task.due) : dateLabel(task.due)));
    content.append(meta);
    row.append(checkbox, content, button("×", "icon-button", () => { state.tasks = state.tasks.filter((t) => t.id !== task.id); save(); }));
    list.append(row);
  });
}
$$("[data-task-filter]").forEach((item) => item.addEventListener("click", () => { taskFilter = item.dataset.taskFilter; $$("[data-task-filter]").forEach((b) => b.classList.toggle("active", b === item)); renderTasks(); }));
$("#task-form").addEventListener("submit", (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  state.tasks.unshift({ id: makeId(), title: String(data.get("title")).trim(), priority: data.get("priority"), due: data.get("due") || "", status: "todo", createdAt: new Date().toISOString() });
  form.reset(); save(); announce("Task added.");
});
$("#breakdown-button").addEventListener("click", () => {
  const input = $("#breakdown-input"); const ideas = splitTaskIdeas(input.value);
  const results = $("#breakdown-results"); results.replaceChildren();
  if (!ideas.length) return announce("Enter a task idea to break it into steps.");
  const list = el("ul", "breakdown-list"); ideas.forEach((idea) => list.append(el("li", "", idea)));
  results.append(list, button("Add all steps as tasks", "secondary-button", () => { ideas.forEach((title) => state.tasks.push({ id: makeId(), title, priority: "medium", due: "", status: "todo", createdAt: new Date().toISOString() })); input.value = ""; results.replaceChildren(); save(); announce("Steps added."); }));
});

$("#study-form").addEventListener("submit", (event) => {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  const subjects = String(data.get("subjects")).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const plan = generateStudyPlan({ subjects, examDate: data.get("examDate"), startDate: today(), hoursPerDay: data.get("hours") });
  state.studyPlan = plan; save(); announce(plan.length ? "Study plan created." : "Choose a future date and at least one subject.");
});
function renderStudy() {
  const root = $("#study-plan"); root.replaceChildren();
  if (!state.studyPlan.length) return empty(root, "Your study schedule will appear here. Create one above.");
  const byDate = state.studyPlan.reduce((acc, session) => { (acc[session.date] ||= []).push(session); return acc; }, {});
  Object.entries(byDate).forEach(([date, sessions]) => { const card = el("article", "study-day"); card.append(el("span", "study-date", dateLabel(date)), el("strong", "", sessions.map((s) => s.subject).join(" · ")), el("small", "", `${sessions.reduce((sum, s) => sum + s.hours, 0)} study hour(s)`)); root.append(card); });
  root.append(button("Clear plan", "text-button", () => { state.studyPlan = []; save(); }));
}

$("#note-form").addEventListener("submit", (event) => {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  state.notes.unshift({ id: makeId(), title: String(data.get("title")).trim(), content: String(data.get("content")).trim(), tags: String(data.get("tags") || "").split(",").map((s) => s.trim()).filter(Boolean), createdAt: new Date().toISOString() });
  event.currentTarget.reset(); save(); announce("Note saved.");
});
$("#notes-search").addEventListener("input", (event) => { noteQuery = event.target.value; renderNotes(); });
function renderNotes() {
  const root = $("#notes-list"); root.replaceChildren(); const notes = searchNotes(state.notes, noteQuery);
  if (!notes.length) return empty(root, noteQuery ? "No notes match that search." : "No saved notes yet.");
  notes.forEach((note) => { const card = el("article", "note-card"); card.append(el("strong", "", note.title), el("p", "note-content", note.content), el("small", "note-date", new Date(note.createdAt).toLocaleDateString())); if (note.tags.length) { const tags = el("div", "tag-row"); note.tags.forEach((tag) => tags.append(el("span", "tag", tag))); card.append(tags); } card.append(button("Delete", "text-button danger-text", () => { state.notes = state.notes.filter((n) => n.id !== note.id); save(); })); root.append(card); });
}

$("#event-form").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); state.events.push({ id: makeId(), title: String(data.get("title")).trim(), date: data.get("date") }); event.currentTarget.reset(); save(); announce("Event added."); });
function renderAgenda() {
  const root = $("#agenda-list"); root.replaceChildren(); const agenda = buildAgenda(state.tasks, state.events, today());
  if (!agenda.length) return empty(root, "No dated tasks or events yet.");
  agenda.forEach((item) => { const card = el("article", "agenda-card" + (item.overdue ? " overdue-card" : "")); card.append(el("div", "agenda-date-block", dateLabel(item.date)), el("div", "agenda-content", item.title), el("span", "kind-badge", item.kind)); if (item.kind === "Event") card.append(button("Delete", "text-button danger-text", () => { state.events = state.events.filter((e) => e.id !== item.id); save(); })); root.append(card); });
}

$("#career-form").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); state.applications.unshift({ id: makeId(), company: String(data.get("company")).trim(), role: String(data.get("role")).trim(), stage: data.get("stage"), followUp: data.get("date") || "", createdAt: new Date().toISOString() }); event.currentTarget.reset(); save(); announce("Application tracked."); });
function renderCareer() {
  const counts = countCareerStages(state.applications); const summary = $("#career-summary"); summary.replaceChildren();
  Object.entries(counts).forEach(([stage, count]) => { const box = el("div", "stage-count"); box.append(el("span", "", stage), el("strong", "", String(count))); summary.append(box); });
  const root = $("#career-list"); root.replaceChildren();
  if (!state.applications.length) return empty(root, "Applications you add will appear here.");
  state.applications.forEach((application) => { const card = el("article", "career-card"); const top = el("div", "career-title"); top.append(el("strong", "", application.company), el("span", "career-role", application.role)); const select = document.createElement("select"); select.className = "stage-select"; select.setAttribute("aria-label", "Application stage"); ["Wishlist","Applied","Assessment","Interview","Offer","Rejected"].forEach((stage) => { const option = document.createElement("option"); option.value = stage; option.textContent = stage; option.selected = stage === application.stage; select.append(option); }); select.addEventListener("change", () => { application.stage = select.value; save(); }); card.append(top, select); if (application.followUp) card.append(el("small", "follow-up", "Follow-up: " + dateLabel(application.followUp))); card.append(button("Remove", "text-button danger-text", () => { state.applications = state.applications.filter((a) => a.id !== application.id); save(); })); root.append(card); });
}

$("#habit-form").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const name = String(data.get("name")).trim(); if (state.habits.some((h) => h.name.toLowerCase() === name.toLowerCase())) return announce("That habit already exists."); state.habits.push({ id: makeId(), name, checkins: [] }); event.currentTarget.reset(); save(); announce("Habit added."); });
function renderHabits() {
  const root = $("#habit-list"); root.replaceChildren(); if (!state.habits.length) return empty(root, "Add a habit you want to practice consistently.");
  state.habits.forEach((habit) => { const checked = (habit.checkins || []).includes(today()); const streak = calculateHabitStreak(habit.checkins || [], today()); const card = el("article", "habit-card" + (checked ? " checked" : "")); const action = button(checked ? "✓ Done today" : "Check in today", "habit-check-button", () => { habit.checkins ||= []; if (checked) habit.checkins = habit.checkins.filter((d) => d !== today()); else habit.checkins.push(today()); save(); }); card.append(el("strong", "", habit.name), el("span", "habit-streak", `🔥 ${streak} day streak`), action, button("Remove", "text-button danger-text", () => { state.habits = state.habits.filter((h) => h.id !== habit.id); save(); })); root.append(card); });
}

$("#budget-form").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); state.budget = Number(data.get("budget")) || 0; save(); announce("Budget saved."); });
$("#expense-form").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); state.expenses.unshift({ id: makeId(), amount: Number(data.get("amount")), category: data.get("category"), note: String(data.get("note") || "").trim(), date: data.get("date") }); event.currentTarget.reset(); save(); announce("Expense added."); });
function renderFinance() {
  const month = today().slice(0, 7); const entries = state.expenses.filter((e) => (e.date || "").startsWith(month)); const summary = summarizeExpenses(entries, state.budget);
  const root = $("#finance-summary"); root.replaceChildren();
  const metrics = el("div", "finance-metrics"); metrics.append(el("div", "finance-metric", "Spent this month"), el("strong", "", money(summary.total)), el("div", "finance-metric", "Budget remaining"), el("strong", "", summary.budget ? money(summary.remaining) : "Budget not set")); root.append(metrics);
  if (summary.budget) { const bar = el("div", "budget-track"); const fill = el("i", "budget-fill" + (summary.overBudget ? " over" : "")); fill.style.width = `${Math.min(100, summary.total / summary.budget * 100)}%`; bar.append(fill); root.append(bar, el("small", summary.overBudget ? "budget-warning" : "budget-note", summary.overBudget ? `Budget exceeded by ${money(summary.total - summary.budget)}` : `${money(summary.total)} of ${money(summary.budget)}`)); }
  const list = $("#expense-list"); list.replaceChildren(); if (!state.expenses.length) return empty(list, "No expenses recorded yet.");
  state.expenses.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((expense) => { const row = el("div", "expense-row"); row.append(el("span", "expense-category", expense.category), el("span", "expense-note", expense.note || "—"), el("small", "", dateLabel(expense.date)), el("strong", "", money(expense.amount)), button("×", "icon-button", () => { state.expenses = state.expenses.filter((e) => e.id !== expense.id); save(); })); list.append(row); });
}

function renderAll() { renderOverview(); renderTasks(); renderStudy(); renderNotes(); renderAgenda(); renderCareer(); renderHabits(); renderFinance(); }
$("#export-data").addEventListener("click", () => { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, data: state }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mailmate-productivity-backup.json"; anchor.click(); URL.revokeObjectURL(url); announce("Backup exported."); });
$("#reset-data").addEventListener("click", () => { if (!window.confirm("Reset the Productivity Hub data in this browser? This does not affect the inbox.")) return; state = structuredClone(defaults); localStorage.removeItem(STORAGE_KEY); save(); announce("Hub data reset."); });
renderAll();
