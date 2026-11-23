export const TASK_PRIORITIES = ["low", "medium", "high"];
export const TASK_STATUSES = ["todo", "doing", "done"];
export const APPLICATION_STAGES = ["Wishlist", "Applied", "Assessment", "Interview", "Offer", "Rejected"];

export function sortTasks(tasks = [], today = new Date().toISOString().slice(0, 10)) {
  const priority = { high: 3, medium: 2, low: 1 };
  return [...tasks].sort((a, b) => {
    const aDone = a.status === "done";
    const bDone = b.status === "done";
    if (aDone !== bDone) return Number(aDone) - Number(bDone);
    const aOver = Boolean(a.due && a.due < today && !aDone);
    const bOver = Boolean(b.due && b.due < today && !bDone);
    if (aOver !== bOver) return Number(bOver) - Number(aOver);
    if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
    if (a.due !== b.due) return a.due ? -1 : 1;
    return (priority[b.priority] || 0) - (priority[a.priority] || 0);
  });
}

export function splitTaskIdeas(text = "") {
  const parts = String(text).split(/\s*(?:;|,|\band then\b|\bthen\b|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts)].slice(0, 6);
}

export function generateStudyPlan({ subjects = [], examDate, startDate = new Date().toISOString().slice(0, 10), hoursPerDay = 2 }) {
  const clean = subjects.map((s) => typeof s === "string" ? s.trim() : String(s.name || "").trim()).filter(Boolean);
  if (!clean.length || !examDate || examDate < startDate) return [];
  const hours = Math.max(0.5, Math.min(12, Number(hoursPerDay) || 2));
  const start = new Date(startDate + "T12:00:00Z");
  const end = new Date(examDate + "T12:00:00Z");
  const days = Math.round((end - start) / 86400000);
  const plan = [];
  for (let d = 0; d <= days; d++) {
    const date = new Date(start.getTime() + d * 86400000).toISOString().slice(0, 10);
    const subject = clean[d % clean.length];
    plan.push({ date, subject, hours: hours, session: d + 1, note: d === days ? "Final review" : "Focus session" });
  }
  return plan;
}

export function calculateHabitStreak(checkins = [], today = new Date().toISOString().slice(0, 10)) {
  const unique = new Set(checkins);
  let anchor = today;
  if (!unique.has(today)) {
    const yesterday = new Date(today + "T12:00:00Z");
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    anchor = yesterday.toISOString().slice(0, 10);
  }
  if (!unique.has(anchor)) return 0;
  let streak = 0;
  let cursor = new Date(anchor + "T12:00:00Z");
  while (unique.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function summarizeExpenses(entries = [], budget = 0) {
  const valid = entries.filter((entry) => Number.isFinite(Number(entry.amount)) && Number(entry.amount) >= 0);
  const total = valid.reduce((sum, entry) => sum + Number(entry.amount), 0);
  const byCategory = {};
  for (const entry of valid) {
    const category = entry.category || "Other";
    byCategory[category] = (byCategory[category] || 0) + Number(entry.amount);
  }
  return { total, budget: Math.max(0, Number(budget) || 0), remaining: Math.max(0, (Number(budget) || 0) - total), overBudget: Number(budget) > 0 && total > Number(budget), byCategory };
}

export function searchNotes(notes = [], query = "") {
  const terms = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...notes];
  return notes.map((note) => {
    const text = `${note.title || ""} ${note.content || ""} ${(note.tags || []).join(" ")}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
    return { note, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.note);
}

export function countCareerStages(applications = []) {
  const counts = Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, 0]));
  applications.forEach((application) => {
    if (counts[application.stage] !== undefined) counts[application.stage]++;
  });
  return counts;
}

export function buildAgenda(tasks = [], events = [], today = new Date().toISOString().slice(0, 10), applications = []) {
  return [
    ...tasks.filter((task) => task.due && task.status !== "done").map((task) => ({ id: task.id, date: task.due, title: task.title, kind: "Task", priority: task.priority || "medium" })),
    ...events.filter((event) => event.date).map((event) => ({ id: event.id, date: event.date, title: event.title, kind: "Event", priority: "medium" })),\n    ...applications.filter((application) => application.followUp).map((application) => ({ id: application.id, date: application.followUp, title: `${application.company} — ${application.role}`, kind: "Follow-up", priority: "high" }))
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)).map((item) => ({ ...item, overdue: item.date < today }));
}
