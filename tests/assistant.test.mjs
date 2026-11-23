import test from "node:test";
import assert from "node:assert/strict";
import { answerInboxQuestion, buildAssistantOverview, scanEmailRisk } from "../src/ui/assistant.js";

const emails = [
  { id:"1", from:{name:"Professor",email:"prof@university.edu"}, subject:"Assignment deadline", body:"Please submit the assignment by tomorrow.", analysis:{category:"academic"}, actions:["Submit assignment"], deadline:{date:new Date("2026-11-24T10:00:00Z")}, ai:{priority:{score:88,factors:[{detail:"Deadline soon"}]}} },
  { id:"2", from:{name:"Scam",email:"unknown@example.net"}, subject:"Urgent: You won a prize", body:"Verify your password and pay now. Click https://bit.ly/example", analysis:{category:"spam"}, actions:[], ai:{priority:{score:10}} }
];

test("assistant overview counts actionable messages and tasks", () => {
  const overview = buildAssistantOverview(emails, new Date("2026-11-23T10:00:00Z"));
  assert.equal(overview.tasks.length, 1);
  assert.equal(overview.ranked[0].id, "1");
  assert.equal(overview.risky.length, 1);
});

test("risk scan exposes signal labels and bounded score", () => {
  const result = scanEmailRisk(emails[1]);
  assert.ok(result.score >= 25);
  assert.ok(result.score <= 100);
  assert.ok(result.signals.includes("Credential request"));
});

test("inbox question retrieval returns source messages", () => {
  const result = answerInboxQuestion(emails, "assignment deadline submit");
  assert.equal(result.results[0].email.id, "1");
  assert.ok(result.results[0].excerpt.toLowerCase().includes("submit"));
});

test("empty and unmatched questions return useful states", () => {
  assert.equal(answerInboxQuestion(emails, "").results.length, 0);
  assert.equal(answerInboxQuestion(emails, "xylophone qwerty").results.length, 0);
});
