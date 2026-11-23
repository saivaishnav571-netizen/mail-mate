import test from "node:test";
import assert from "node:assert/strict";
import { buildAgenda, calculateHabitStreak, countCareerStages, generateStudyPlan, searchNotes, sortTasks, splitTaskIdeas, summarizeExpenses } from "../src/productivity/core.js";

test("task sorting puts open overdue tasks first, then date and priority", () => {
  const tasks = [
    { id: "done", status: "done", due: "2026-11-20", priority: "high" },
    { id: "later", status: "todo", due: "2026-11-25", priority: "high" },
    { id: "overdue", status: "todo", due: "2026-11-22", priority: "low" },
    { id: "undated", status: "todo", priority: "high" }
  ];
  assert.deepEqual(sortTasks(tasks, "2026-11-23").map((t) => t.id), ["overdue", "later", "undated", "done"]);
});

test("task breakdown trims, deduplicates and limits the generated steps", () => {
  assert.deepEqual(splitTaskIdeas("Plan project; build prototype and test it"), ["Plan project", "build prototype", "test it"]);
  assert.equal(splitTaskIdeas("one, two, three, four, five, six, seven").length, 6);
});

test("study planner distributes subjects through the date range", () => {
  const plan = generateStudyPlan({ subjects: ["DBMS", "OS", "CN"], startDate: "2026-11-23", examDate: "2026-11-26", hoursPerDay: 2 });
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((p) => p.subject), ["DBMS", "OS", "CN", "DBMS"]);
  assert.ok(plan.every((p) => p.hours === 2));
  assert.equal(generateStudyPlan({ subjects: [], startDate: "2026-11-23", examDate: "2026-11-26" }).length, 0);
  assert.equal(generateStudyPlan({ subjects: ["OS"], startDate: "2026-11-23", examDate: "2026-11-22" }).length, 0);
});

test("habit streak tolerates a missed current day by anchoring yesterday", () => {
  assert.equal(calculateHabitStreak(["2026-11-20", "2026-11-21", "2026-11-22"], "2026-11-23"), 3);
  assert.equal(calculateHabitStreak(["2026-11-21", "2026-11-23"], "2026-11-23"), 1);
  assert.equal(calculateHabitStreak([], "2026-11-23"), 0);
});

test("expense summary groups valid amounts and flags budget overrun", () => {
  const summary = summarizeExpenses([{ amount: 120, category: "Food" }, { amount: "80", category: "Food" }, { amount: 50, category: "Travel" }, { amount: -9, category: "Invalid" }], 200);
  assert.equal(summary.total, 250);
  assert.equal(summary.remaining, 0);
  assert.equal(summary.overBudget, true);
  assert.deepEqual(summary.byCategory, { Food: 200, Travel: 50 });
});

test("note search ranks matches and returns all notes for blank query", () => {
  const notes = [{ title: "DSA", content: "graphs and traversal", tags: ["coding"] }, { title: "Exam", content: "revision plan", tags: ["study"] }];
  assert.equal(searchNotes(notes, "graphs coding")[0].title, "DSA");
  assert.equal(searchNotes(notes, "unknown").length, 0);
  assert.equal(searchNotes(notes, "").length, 2);
});

test("career stage counts include all defined stages and ignore unknown values", () => {
  const counts = countCareerStages([{ stage: "Applied" }, { stage: "Interview" }, { stage: "Applied" }, { stage: "Other" }]);
  assert.equal(counts.Applied, 2);
  assert.equal(counts.Interview, 1);
  assert.equal(counts.Offer, 0);
});

test("agenda combines due tasks and events in date order and marks overdue", () => {
  const agenda = buildAgenda([{ id: "t", title: "Finish report", due: "2026-11-22", status: "todo" }, { id: "done", title: "Done", due: "2026-11-21", status: "done" }], [{ id: "e", title: "Meeting", date: "2026-11-24" }], "2026-11-23");
  assert.deepEqual(agenda.map((i) => i.id), ["t", "e"]);
  assert.equal(agenda[0].overdue, true);
  assert.equal(agenda[1].overdue, false);
});
