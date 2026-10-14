import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Keep these tests runnable on the project's minimum Node version, which does
// not yet load TypeScript by default. No production code needs a test loader.
const source = await readFile(new URL("./cloud-contract.mts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const contract = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const { CloudRequestError, MAX_SESSION_BODY_BYTES, parseSessionPayload, readSessionBody, requireSameOrigin, validateSessionId } = contract;

const validMessage = { id: "message-1", role: "assistant", content: "  keep code formatting\n", createdAt: "2026-10-14T10:00:00.000Z" };
const payload = { title: "  Fix parser  ", agent: "atlas", project: "closedcode", messages: [validMessage] };

test("session validation trims labels while preserving code content", () => {
  const result = parseSessionPayload(payload, "create");
  assert.equal(result.title, "Fix parser");
  assert.equal(result.messages[0].content, validMessage.content);
  assert.deepEqual(parseSessionPayload({ title: "New", agent: "nova", project: "" }, "create").messages, []);
});

test("clients cannot set ownership or record identifiers", () => {
  for (const unsupported of ["ownerId", "id", "createdAt", "updatedAt"]) {
    assert.throws(() => parseSessionPayload({ ...payload, [unsupported]: "other-user" }, "create"), CloudRequestError);
    assert.throws(() => parseSessionPayload({ [unsupported]: "other-user" }, "patch"), CloudRequestError);
  }
});

test("patch validation rejects empty updates, invented states, and duplicate messages", () => {
  assert.throws(() => parseSessionPayload({}, "patch"), CloudRequestError);
  assert.throws(() => parseSessionPayload({ status: "failed" }, "patch"), CloudRequestError);
  assert.throws(() => parseSessionPayload({ messages: [validMessage, validMessage] }, "patch"), CloudRequestError);
  assert.deepEqual(parseSessionPayload({ status: "complete" }, "patch"), { status: "complete" });
});

test("message roles, timestamps, counts, and content size are bounded", () => {
  for (const message of [
    { ...validMessage, role: "system" },
    { ...validMessage, createdAt: "yesterday" },
    { ...validMessage, content: "x".repeat(131_073) },
  ]) assert.throws(() => parseSessionPayload({ messages: [message] }, "patch"), CloudRequestError);
  assert.throws(() => parseSessionPayload({ messages: new Array(501).fill(validMessage) }, "patch"), CloudRequestError);
});

test("session IDs reject arbitrary strings with an indistinguishable 404", () => {
  assert.equal(validateSessionId("83687f4c-07de-4ec6-bc5d-a0520bced45b"), "83687f4c-07de-4ec6-bc5d-a0520bced45b");
  assert.throws(() => validateSessionId("../../../account"), (error) => error.status === 404 && error.message === "Session not found.");
});

test("writes reject cross-site origins and browser cross-site metadata", () => {
  assert.throws(() => requireSameOrigin(new Request("https://closedcode.test/api/sessions", { headers: { origin: "https://other.test" } })), (error) => error.status === 403);
  assert.throws(() => requireSameOrigin(new Request("https://closedcode.test/api/sessions", { headers: { "sec-fetch-site": "cross-site" } })), (error) => error.status === 403);
  requireSameOrigin(new Request("https://closedcode.test/api/sessions", { headers: { origin: "https://closedcode.test" } }));
});

test("JSON parsing rejects incorrect types and malformed bodies", async () => {
  await assert.rejects(readSessionBody(new Request("http://localhost/api/sessions", { method: "POST", body: "{}" })), (error) => error.status === 415);
  await assert.rejects(readSessionBody(new Request("http://localhost/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })), (error) => error.status === 400);
  assert.deepEqual(await readSessionBody(new Request("http://localhost/api/sessions", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(payload) })), payload);
});

test("body size enforcement does not trust a smaller Content-Length", async () => {
  const request = new Request("http://localhost/api/sessions", {
    method: "POST", headers: { "content-type": "application/json", "content-length": "2" },
    body: "x".repeat(MAX_SESSION_BODY_BYTES + 1),
  });
  await assert.rejects(readSessionBody(request), (error) => error.status === 413);
});

test("body limits count UTF-8 bytes rather than character count", async () => {
  const request = new Request("http://localhost/api/sessions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "€".repeat(Math.ceil(MAX_SESSION_BODY_BYTES / 3)) }),
  });
  await assert.rejects(readSessionBody(request), (error) => error.status === 413);
});
