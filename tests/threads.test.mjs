import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { triageEmail } from "../src/lib/triage.js";
import { enrichInbox, MODEL_INFO, summarizeThreadAI } from "../src/lib/ai.js";
import { attachThreads, buildThreads, normalizeSubject } from "../src/lib/threads.js";

const reference = new Date("2026-11-15T09:00:00Z");
const inbox = JSON.parse(readFileSync(new URL("../public/test-inbox.json", import.meta.url), "utf8"));
const THREAD_ID = "thread-brightlayer-intern-2026";
const messageIds = [
  "internship-interview-17",
  "internship-thread-reply-25",
  "internship-thread-confirm-26"
];

function triaged(rows = inbox) {
  return rows.map((email) => triageEmail(email, reference, { name: "Alex" }));
}

test("groups the BrightLayer conversation by its explicit thread_id", () => {
  const emails = triaged();
  const threads = buildThreads(emails, { reference });
  const thread = threads.find((item) => item.id === THREAD_ID);

  assert.ok(thread, "BrightLayer thread should be built");
  assert.equal(thread.count, 3);
  assert.deepEqual(
    thread.messages.map((message) => message.id),
    messageIds
  );
  assert.equal(normalizeSubject(thread.messages[1].subject), normalizeSubject(thread.messages[0].subject));
});

test("orders thread messages chronologically even when the source is shuffled", () => {
  const shuffled = [...triaged()].reverse();
  const threads = buildThreads(shuffled, { reference });
  const thread = threads.find((item) => item.id === THREAD_ID);

  const timestamps = thread.messages.map((message) => message.receivedAt.getTime());
  assert.deepEqual(
    timestamps,
    [...timestamps].sort((a, b) => a - b),
    "messages must ascend by receivedAt"
  );
  assert.deepEqual(
    thread.messages.map((message) => message.id),
    messageIds
  );
});

test("attaches the same thread object to every message in the conversation", () => {
  const emails = triaged();
  const threads = attachThreads(emails, { reference });
  const thread = threads.find((item) => item.id === THREAD_ID);

  for (const id of messageIds) {
    const email = emails.find((item) => item.id === id);
    assert.equal(email.thread, thread, `${id} should share the thread object`);
  }

  const unrelated = emails.find((item) => item.id === "finance-budget-01");
  assert.equal(unrelated.thread, null);
});

test("extracts participants, the interview slot and required preparation", () => {
  const emails = enrichInbox(triaged(), reference);
  const thread = emails.find((item) => item.id === "internship-interview-17").thread;

  const participantEmails = thread.participants.map((person) => person.email);
  assert.ok(participantEmails.includes("talent@brightlayer.example"));
  assert.ok(participantEmails.includes("alex.morgan@northstar.example"));

  assert.ok(thread.interview?.date, "interview date should be extracted");
  assert.equal(thread.interview.date.getFullYear(), 2026);
  assert.equal(thread.interview.date.getMonth(), 10, "November is month 10");
  assert.equal(thread.interview.date.getDate(), 25);
  assert.equal(thread.interview.date.getHours(), 11);
  assert.equal(thread.interview.date.getMinutes(), 0);

  assert.ok(thread.prep.some((item) => /one-page resume/i.test(item)), JSON.stringify(thread.prep));
  assert.ok(thread.prep.some((item) => /portfolio link/i.test(item)), JSON.stringify(thread.prep));
  assert.ok(thread.prep.some((item) => /walkthrough/i.test(item)), JSON.stringify(thread.prep));
});

test("generates the thread summary from the messages with a named engine", () => {
  const emails = enrichInbox(triaged(), reference);
  const thread = emails.find((item) => item.id === "internship-thread-confirm-26").thread;

  assert.ok(thread.summary.text.length > 80);
  assert.match(thread.summary.text, /BrightLayer Talent Team/i);
  assert.match(thread.summary.text, /Alex Morgan/i);
  assert.match(thread.summary.text, /interview/i);
  assert.match(thread.summary.text, /25 Nov/i);
  assert.match(thread.summary.text, /portfolio/i);

  assert.equal(thread.summary.engine.includes(MODEL_INFO.name), true);
  assert.match(thread.summary.engine, /on-device/i);
});

test("the summary is derived per thread rather than hard-coded", () => {
  const emails = enrichInbox(triaged(), reference);
  const first = emails.find((item) => item.id === "internship-interview-17").thread;

  // Re-running the generator over a changed transcript must change the text.
  const changed = {
    ...first,
    messages: first.messages.map((message, index) =>
      index === first.messages.length - 1
        ? { ...message, body: "The interview has moved to Friday 27 November 2026 at 3:00 PM." }
        : message
    ),
    prep: []
  };

  const regenerated = summarizeThreadAI(changed);
  assert.notEqual(regenerated.text, first.summary.text);
  assert.match(regenerated.text, /3:00|15:00/i);
});
