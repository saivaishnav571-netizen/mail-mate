import test from "node:test";
import assert from "node:assert/strict";
import { apiBaseUrl, backendMode, isBackendConfigured } from "../src/lib/feedback.js";

const at = (protocol, hostname) => ({ protocol, hostname });

test("localhost and loopback hosts are treated as local", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "LOCALHOST"]) {
    assert.equal(backendMode(at("http:", host)), "local");
    assert.equal(isBackendConfigured(at("https:", host)), true);
  }
});

test("a deployed domain is frontend-only", () => {
  const vercel = at("https:", "mail-mate-tawny.vercel.app");
  assert.equal(backendMode(vercel), "frontend-only");
  assert.equal(isBackendConfigured(vercel), false);
});

test("pages opened from disk are frontend-only", () => {
  const file = at("file:", "");
  assert.equal(backendMode(file), "frontend-only");
  assert.equal(isBackendConfigured(file), false);
});

test("an explicit VITE_API_BASE_URL always means a remote backend", () => {
  const vercel = at("https:", "mail-mate-tawny.vercel.app");
  const envBase = "https://mailmate-api.example.com/api";
  assert.equal(backendMode(vercel, envBase), "remote");
  assert.equal(isBackendConfigured(vercel, envBase), true);
});

test("the default API base stays relative for the Vite proxy", () => {
  assert.equal(apiBaseUrl(), "/api");
});
