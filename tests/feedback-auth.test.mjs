import test from "node:test";
import assert from "node:assert/strict";
import { exportFeedbackCsv, fetchFeedback } from "../src/lib/feedback.js";

test("private feedback reads include the admin token", async (t) => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const rows = await fetchFeedback({ limit: 25, adminToken: "a".repeat(32) });
  assert.deepEqual(rows, []);
  assert.match(captured.url, /\/feedback\?limit=25$/);
  assert.equal(captured.init.headers["X-Admin-Token"], "a".repeat(32));
});

test("CSV export includes the admin token", async (t) => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response("id,email_subject\n1,Example", {
      status: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": 'attachment; filename="feedback.csv"'
      }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await exportFeedbackCsv({
    approvedOnly: false,
    adminToken: "b".repeat(32)
  });
  assert.equal(captured.init.headers["X-Admin-Token"], "b".repeat(32));
  assert.match(captured.url, /approved_only=false$/);
  assert.equal(result.filename, "feedback.csv");
  assert.match(await result.blob.text(), /Example/);
});

test("private feedback reads surface unauthorized responses", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "A valid X-Admin-Token header is required." }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    fetchFeedback({ limit: 5 }),
    (error) => error.status === 401 && /valid X-Admin-Token/.test(error.message)
  );
});
