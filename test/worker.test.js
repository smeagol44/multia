import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { callProvider } from "../worker/providers.js";

const origin = "https://smeagol44.github.io";
const env = {
  APP_ORIGIN: origin,
  APP_PASSWORD: "a test-only passphrase",
  SESSION_SECRET: "a test-only session secret",
  LOGIN_LIMITER: { limit: async () => ({ success: true }) },
  OPENAI_API_KEY: "test-openai",
  ANTHROPIC_API_KEY: "test-claude",
};

function post(path, payload, overrides = {}) {
  return new Request(`https://worker.example${path}`, {
    method: "POST", body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json", Origin: origin, ...overrides },
  });
}

function stream(events, headers = {}) {
  return new Response(events.map(event => "data: " + JSON.stringify(event) + "\r\n\r\n").join(""), { headers });
}

function turn(provider, model) {
  return { provider, model, effort: "low", required: true, instructions: "No spoilers",
    transcript: [{ author: "user", content: "Question" }, { author: "claud", content: "Public answer", activity: "Hidden" }] };
}

test("worker rejects cross-origin, unauthenticated, and tampered-token calls", async () => {
  assert.equal((await worker.fetch(post("/api/session", {}, { Origin: "https://elsewhere.example" }), env)).status, 403);
  assert.equal((await worker.fetch(post("/api/session", { password: "wrong" }), env)).status, 401);
  assert.equal((await worker.fetch(post("/api/session", { password: env.APP_PASSWORD }),
    { ...env, LOGIN_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal((await worker.fetch(post("/api/turn", {}), env)).status, 401);
  const login = await worker.fetch(post("/api/session", { password: env.APP_PASSWORD }), env);
  const loggedIn = await login.json();
  assert.equal(login.status, 200);
  assert.deepEqual(loggedIn.connected, { gpt: true, claud: true });
  const changed = loggedIn.token.replace(/.$/, last => last === "a" ? "b" : "a");
  assert.equal((await worker.fetch(post("/api/turn", {}, { Authorization: "Bearer " + changed }), env)).status, 401);
  assert.equal((await worker.fetch(post("/api/turn", {}, { Authorization: "Bearer " + loggedIn.token }), env)).status, 400);
  assert.equal(login.headers.get("access-control-allow-origin"), origin);
  assert.equal(login.headers.get("cache-control"), "no-store");
});

test("OpenAI summary fallback keeps private activity separate from visible text", async () => {
  const calls = [];
  const request = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.get("Authorization"), "Bearer test-openai");
    if (calls.length === 1) return Response.json({
      error: { message: "Verify your organization to use reasoning summaries" },
    }, { status: 400 });
    return stream([
      { type: "response.reasoning_summary_text.delta", delta: "summary" },
      { type: "response.output_text.delta", delta: "reply" },
      { type: "response.completed" },
    ], { "x-ratelimit-remaining-requests": "99" });
  };
  const emitted = await Array.fromAsync(callProvider(turn("gpt", "gpt-6.1-sol"), env, undefined, request));
  assert.equal(calls[0].reasoning.summary, "auto");
  assert.equal(calls[1].reasoning.summary, undefined);
  assert.equal(calls[1].store, false);
  assert.ok(calls[1].input.includes("Public answer"));
  assert.ok(!calls[1].input.includes("Hidden"));
  assert.deepEqual(emitted, [
    { type: "usage", usage: { requests: "99" } }, { type: "activity", text: "summary" },
    { type: "reply", text: "reply" }, { type: "done" },
  ]);
});

test("Claude streams thinking summaries separately and returns rate-limit headers", async () => {
  const request = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(options.headers.get("x-api-key"), "test-claude");
    assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.match(body.system, /No spoilers/);
    return stream([
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "summary" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "reply" } },
      { type: "message_stop" },
    ], { "anthropic-ratelimit-input-tokens-remaining": "900" });
  };
  assert.deepEqual(await Array.fromAsync(callProvider(turn("claud", "claude-sonnet-5-5"), env, undefined, request)), [
    { type: "usage", usage: { inputTokens: "900" } }, { type: "activity", text: "summary" },
    { type: "reply", text: "reply" }, { type: "done" },
  ]);
});
