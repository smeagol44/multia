import { AI, instructionsLimit, providers } from "../shared/chat.js";
import { callProvider } from "./providers.js";

const encoder = new TextEncoder();
const sessionSeconds = 8 * 60 * 60;
const maxBodyBytes = 3 * 1024 * 1024;
const efforts = new Set(["low", "medium", "high"]);
const roles = new Set(["user", ...AI]);

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function makeSession(secret) {
  const expiresAt = Date.now() + sessionSeconds * 1000;
  const payload = `v1.${expiresAt}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return { token: `${payload}.${hex(signature)}`, expiresAt };
}

async function validSession(request, secret) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (v1\.\d{13}\.[0-9a-f-]{36}\.[0-9a-f]{64})$/)?.[1];
  if (!token) return false;
  const separator = token.lastIndexOf(".");
  const payload = token.slice(0, separator);
  const expiresAt = Number(payload.split(".")[1]);
  if (expiresAt <= Date.now()) return false;
  const bytes = Uint8Array.from(token.slice(separator + 1).match(/../g), pair => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", await hmacKey(secret), bytes, encoder.encode(payload));
}

async function samePassword(actual, expected) {
  // Verify a fixed-length HMAC with Web Crypto's constant-time signature comparison.
  const key = await hmacKey(expected);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(actual));
}

async function readJson(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RangeError("Request is too large.");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function validTurn(turn) {
  return turn && AI.includes(turn.provider) && Object.hasOwn(providers[turn.provider].models, turn.model) &&
    efforts.has(turn.effort) && typeof turn.required === "boolean" &&
    typeof turn.instructions === "string" && turn.instructions.length <= instructionsLimit &&
    Array.isArray(turn.transcript) && turn.transcript.length > 0 &&
    turn.transcript.every(message => message && roles.has(message.author) &&
      typeof message.content === "string" && message.content.trim());
}

function streamTurn(turn, env, request, headers) {
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(180_000)]);
  const events = callProvider(turn, env, signal);
  const body = new ReadableStream({
    async pull(output) {
      try {
        const { value, done } = await events.next();
        if (done) output.close();
        else output.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch (error) {
        const message = signal.aborted ? "The request stopped or exceeded three minutes." :
          error instanceof TypeError ? "The provider could not be reached." : error.message;
        output.enqueue(encoder.encode(JSON.stringify({ type: "error", message }) + "\n"));
        output.close();
      }
    },
    async cancel() {
      controller.abort();
      await events.return();
    },
  });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = env.APP_ORIGIN?.split(",").map(value => value.trim()).includes(origin);
    const headers = { "Cache-Control": "no-store", "Vary": "Origin" };
    if (allowed) headers["Access-Control-Allow-Origin"] = origin;
    const json = (data, status = 200) => Response.json(data, { status, headers });
    if (!allowed) return json({ error: "Origin is unavailable." }, 403);

    const path = new URL(request.url).pathname;
    if (!["/api/session", "/api/turn"].includes(path)) return json({ error: "Unknown endpoint." }, 404);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        ...headers, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Authorization, Content-Type",
      } });
    }
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (!env.APP_PASSWORD || !env.SESSION_SECRET || !env.LOGIN_LIMITER) {
      return json({ error: "The MultiA backend needs configuration." }, 503);
    }

    if (path === "/api/session") {
      const client = request.headers.get("CF-Connecting-IP") || "local";
      const limit = await env.LOGIN_LIMITER.limit({ key: client });
      if (!limit.success) return json({ error: "Too many sign-in attempts. Try again in a minute." }, 429);
      let payload;
      try {
        payload = await readJson(request, 8192);
      } catch {
        return json({ error: "Invalid sign-in request." }, 400);
      }
      if (typeof payload?.password !== "string" || !await samePassword(payload.password, env.APP_PASSWORD)) {
        return json({ error: "Incorrect password." }, 401);
      }
      return json({ ...await makeSession(env.SESSION_SECRET), connected: {
        gpt: Boolean(env.OPENAI_API_KEY), claud: Boolean(env.ANTHROPIC_API_KEY),
      } });
    }

    if (!await validSession(request, env.SESSION_SECRET)) {
      return json({ error: "Your session expired. Unlock MultiA again." }, 401);
    }
    let turn;
    try {
      turn = await readJson(request, maxBodyBytes);
    } catch (error) {
      return error instanceof RangeError
        ? json({ error: "This conversation exceeds the request limit. Start a new chat to continue." }, 413)
        : json({ error: "Invalid chat request." }, 400);
    }
    if (!validTurn(turn)) return json({ error: "Invalid chat settings or transcript." }, 400);
    if (turn.provider === "gpt" ? !env.OPENAI_API_KEY : !env.ANTHROPIC_API_KEY) {
      return json({ error: `${providers[turn.provider].name} needs an API key on the backend.` }, 503);
    }
    return streamTurn(turn, env, request, headers);
  },
};
