import test from "node:test";
import assert from "node:assert/strict";
import { parseDataset, DatasetError } from "../src/lib/dataset.js";

test("parses a JSON array of messages", () => {
  const text = JSON.stringify([
    {
      id: "one",
      from: { name: "Ada Mensah", email: "ada@harbour.ac.example" },
      subject: "Assignment 3",
      body: "Submit the implementation by Friday.",
      receivedAt: "2026-11-14T10:30:00Z"
    }
  ]);
  const result = parseDataset(text, "inbox.json");
  assert.equal(result.emails.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.label, "inbox");
  assert.equal(result.emails[0].from.name, "Ada Mensah");
  assert.equal(result.emails[0].from.email, "ada@harbour.ac.example");
});

test("parses a JSON object with an emails list", () => {
  const text = JSON.stringify({
    emails: [
      {
        from: "Priya Raman <priya@northstar.example>",
        subject: "Budget numbers",
        body: "Please upload the sheet by Friday."
      }
    ]
  });
  const result = parseDataset(text, "wrapper.json");
  assert.equal(result.emails.length, 1);
  assert.equal(result.emails[0].from.name, "Priya Raman");
  assert.equal(result.emails[0].from.email, "priya@northstar.example");
});

test("maps separate CSV sender name and email columns", () => {
  const csv = [
    "id,fromName,fromEmail,subject,body,receivedAt",
    'csv-1,Leo,leo.martin@mail.example,Dinner on Saturday?,"Are you free on Saturday? Let me know by Thursday.","2026-11-14T20:10:00Z"'
  ].join("\n");
  const result = parseDataset(csv, "messages.csv");
  assert.equal(result.emails.length, 1);
  assert.equal(result.emails[0].from.name, "Leo");
  assert.equal(result.emails[0].from.email, "leo.martin@mail.example");
  assert.match(result.emails[0].body, /free on Saturday/);
});

test("handles quoted commas and newlines in CSV cells", () => {
  const csv = [
    "from,subject,body",
    '"Sam Okafor <sam@northstar.example>","Offsite, agenda","Line one, with a comma.\nLine two."'
  ].join("\n");
  const result = parseDataset(csv, "quoted.csv");
  assert.equal(result.emails.length, 1);
  assert.equal(result.emails[0].subject, "Offsite, agenda");
  assert.match(result.emails[0].body, /Line one, with a comma\.\nLine two\./);
});

test("reports rows with missing fields instead of inventing data", () => {
  const text = JSON.stringify([
    { from: { name: "A", email: "a@example.test" }, subject: "Valid", body: "Hello" },
    { from: { name: "B", email: "b@example.test" }, subject: "", body: "Missing subject" },
    { subject: "No sender", body: "Missing sender" }
  ]);
  const result = parseDataset(text, "partial.json");
  assert.equal(result.emails.length, 1);
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].row, 2);
  assert.match(result.errors[0].message, /subject/i);
  assert.match(result.errors[1].message, /sender/i);
});

test("rejects empty, unsupported and unusable files", () => {
  assert.throws(() => parseDataset("", "empty.json"), DatasetError);
  assert.throws(() => parseDataset("{not json", "broken.json"), /syntax error/i);
  assert.throws(() => parseDataset("a,b,c", "notes.txt"), /\.json or \.csv/i);
  assert.throws(() => parseDataset("[]", "empty.json"), /No messages/i);
  assert.throws(
    () => parseDataset(JSON.stringify([{ subject: "No body" }]), "bad.json"),
    /No usable messages/i
  );
});
