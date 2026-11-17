import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { triageEmail, countByCategory, extractDeadline, extractActions } from "../src/lib/triage.js";

const reference = new Date("2026-11-15T09:00:00Z");
const inbox = JSON.parse(readFileSync(new URL("../public/test-inbox.json", import.meta.url), "utf8"));
const analyzed = inbox.map((email, index) => triageEmail(email, reference, { name: "Alex" }));

test("classifies the 26-message test inbox into the expected categories", () => {
  const expected = {
    "finance-budget-01": "important",
    "legal-contract-02": "important",
    "facilities-passes-03": "important",
    "accounts-invoice-04": "important",
    "manager-offsite-05": "important",
    "it-maintenance-06": "important",
    "international-visa-07": "important",
    "spam-giftcard-08": "spam",
    "spam-crypto-09": "spam",
    "spam-parcel-10": "spam",
    "spam-wire-11": "spam",
    "spam-webinar-12": "spam",
    "academic-cs341-13": "academic",
    "academic-seminar-14": "academic",
    "academic-exams-15": "academic",
    "academic-project-16": "academic",
    "internship-interview-17": "internship",
    "internship-thread-reply-25": "internship",
    "internship-thread-confirm-26": "internship",
    "internship-offer-18": "internship",
    "internship-recruiter-19": "internship",
    "internship-application-20": "internship",
    "personal-dinner-21": "personal",
    "personal-birthday-22": "personal",
    "personal-flat-23": "personal",
    "personal-photos-24": "personal"
  };

  for (const email of analyzed) {
    assert.equal(email.analysis.category, expected[email.id], `${email.id} (${email.subject})`);
  }
  assert.deepEqual(countByCategory(analyzed), {
    important: 7,
    academic: 4,
    internship: 6,
    personal: 4,
    spam: 5
  });
});

test("extracts the main deadline from each test message", () => {
  const deadlines = Object.fromEntries(analyzed.map((email) => [email.id, email.deadline?.iso?.slice(0, 10) || null]));

  assert.equal(deadlines["finance-budget-01"], "2026-11-20");
  assert.equal(deadlines["facilities-passes-03"], "2026-11-16");
  assert.equal(deadlines["manager-offsite-05"], "2026-11-18");
  assert.equal(deadlines["academic-cs341-13"], "2026-11-23");
  assert.equal(deadlines["internship-interview-17"], "2026-11-18");
  assert.equal(deadlines["personal-dinner-21"], "2026-11-19");
  assert.equal(deadlines["personal-photos-24"], null);
});

test("keeps the time in a deadline when the message gives one", () => {
  const maintenance = analyzed.find((email) => email.id === "it-maintenance-06");
  assert.ok(maintenance.deadline);
  assert.equal(maintenance.deadline.date.getHours(), 22);
  assert.match(maintenance.deadline.label, /10:00\s?pm/i);
});

test("extracts action items from real sentences", () => {
  const finance = analyzed.find((email) => email.id === "finance-budget-01");
  assert.ok(finance.actions.some((action) => /upload the updated sheet/i.test(action)));

  const legal = analyzed.find((email) => email.id === "legal-contract-02");
  assert.ok(legal.actions.some((action) => /review the redlines/i.test(action)));

  const personal = analyzed.find((email) => email.id === "personal-photos-24");
  assert.ok(personal.actions.some((action) => /send me your favourites/i.test(action)));
});

test("drafts a reply for every non-spam category and none for spam", () => {
  for (const email of analyzed) {
    if (email.analysis.category === "spam") {
      assert.equal(email.reply, null, email.id);
    } else {
      assert.ok(email.reply && email.reply.length > 40, email.id);
      assert.match(email.reply, /^Hi /, email.id);
    }
  }
});

test("creates reminders for messages that need action, but not spam", () => {
  const spamReminders = analyzed.filter((email) => email.analysis.category === "spam" && email.reminder);
  assert.equal(spamReminders.length, 0);
  const withReminders = analyzed.filter((email) => email.reminder);
  assert.ok(withReminders.length >= 18);
  assert.ok(withReminders.every((email) => email.reminder.dueAt));
});

test("deadline parser accepts ISO dates, relative days and weekday-only deadlines", () => {
  assert.equal(extractDeadline("Send it by 2026-12-04.", reference).iso.slice(0, 10), "2026-12-04");
  assert.equal(extractDeadline("I need this tomorrow.", reference).iso.slice(0, 10), "2026-11-16");
  assert.equal(extractDeadline("Confirm by Friday.", reference).iso.slice(0, 10), "2026-11-20");
  assert.equal(extractDeadline("No date is mentioned here.", reference), null);
});

test("action extraction handles please, conditionals and imperatives", () => {
  assert.deepEqual(extractActions("Please review the draft by Friday."), ["Review the draft by Friday"]);
  assert.ok(extractActions("If you can, reply before Thursday and I will book it.").some((action) => /reply before Thursday/i.test(action)));
  assert.ok(extractActions("Upload the file today.").some((action) => /upload the file/i.test(action)));
});
