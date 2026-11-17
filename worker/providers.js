import { providers, providerInstructions } from "../shared/chat.js";
import { readEvents } from "../shared/streams.js";

const transcriptLabel = { user: "Human", gpt: "ChatGPT", claud: "Claude" };

function readableError(status, provider, detail) {
  const name = providers[provider].name;
  if (status === 401 || status === 403) return `${name} rejected its API credentials or model permissions.`;
  if (status === 429) return `${name} reported an API rate limit or exhausted quota. Check Usage for details.`;
  if (status >= 500) return `${name} is temporarily unavailable (HTTP ${status}).`;
  return `${name} rejected the request (HTTP ${status})${detail ? `: ${detail.slice(0, 340)}` : "."}`;
}

function usageHeaders(headers, provider) {
  const names = provider === "gpt" ? {
    requests: "x-ratelimit-remaining-requests",
    tokens: "x-ratelimit-remaining-tokens",
    requestsReset: "x-ratelimit-reset-requests",
  } : {
    requests: "anthropic-ratelimit-requests-remaining",
    tokens: "anthropic-ratelimit-tokens-remaining",
    inputTokens: "anthropic-ratelimit-input-tokens-remaining",
    outputTokens: "anthropic-ratelimit-output-tokens-remaining",
    requestsReset: "anthropic-ratelimit-requests-reset",
  };
  return Object.fromEntries(Object.entries(names).flatMap(([summary, header]) => {
    const value = headers.get(header);
    return value === null ? [] : [[summary, value]];
  }));
}

async function* openAIEvents(stream) {
  for await (const event of readEvents(stream)) {
    if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
      yield { type: "reply", text: event.delta };
    } else if (event.type === "response.reasoning_summary_text.delta") {
      yield { type: "activity", text: event.delta };
    } else if (event.type === "response.reasoning_summary_part.added" && event.summary_index > 0) {
      yield { type: "activity", text: "\n\n" };
    } else if (event.type === "response.completed") {
      yield { type: "done" };
      return;
    } else if (event.type === "response.incomplete") {
      yield { type: "done", incomplete: true };
      return;
    } else if (event.type === "error" || event.type === "response.failed") {
      throw new Error("ChatGPT stopped before completing the reply.");
    }
  }
  throw new Error("The ChatGPT stream closed before the reply finished.");
}

async function* claudeEvents(stream) {
  for await (const event of readEvents(stream)) {
    const delta = event.delta;
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block?.type === "text" && block.text) yield { type: "reply", text: block.text };
      if (block?.type === "thinking" && block.thinking) yield { type: "activity", text: block.thinking };
    } else if (event.type === "content_block_delta") {
      if (delta?.type === "text_delta") yield { type: "reply", text: delta.text };
      if (delta?.type === "thinking_delta") yield { type: "activity", text: delta.thinking };
    } else if (event.type === "message_delta" && delta?.stop_reason === "max_tokens") {
      yield { type: "done", incomplete: true };
      return;
    } else if (event.type === "message_stop") {
      yield { type: "done" };
      return;
    } else if (event.type === "error") {
      throw new Error("Claude stopped before completing the reply.");
    }
  }
  throw new Error("The Claude stream closed before the reply finished.");
}

export async function* callProvider(turn, env, signal, request = fetch) {
  const { provider, model, effort, required, instructions, transcript } = turn;
  const text = JSON.stringify(transcript.map(({ author, content }) => ({
    author: transcriptLabel[author], message: content,
  })));
  const system = providerInstructions(provider, required, instructions);
  const openAI = provider === "gpt";
  const url = openAI ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages";
  const headers = new Headers({ "Content-Type": "application/json" });
  if (openAI) {
    headers.set("Authorization", `Bearer ${env.OPENAI_API_KEY}`);
  } else {
    headers.set("x-api-key", env.ANTHROPIC_API_KEY);
    headers.set("anthropic-version", "2023-06-01");
  }
  const body = openAI ? {
    model, instructions: system, input: text, stream: true, store: false,
    reasoning: { effort, summary: "auto" }, max_output_tokens: 8192,
  } : {
    model, system, messages: [{ role: "user", content: text }], stream: true,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort }, max_tokens: 8192,
  };

  const send = () => request(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  let response = await send();
  let detail;
  if (!response.ok) {
    detail = (await response.json().catch(() => null))?.error?.message;
    if (openAI && [400, 403].includes(response.status) && typeof detail === "string" &&
        /reasoning[._ ]summar|summar(?:y|ies) (?:are|is) (?:not supported|available)|verif[^.]*reasoning/i.test(detail)) {
      delete body.reasoning.summary;
      response = await send();
      detail = response.ok ? undefined : (await response.json().catch(() => null))?.error?.message;
    }
  }
  yield { type: "usage", usage: usageHeaders(response.headers, provider) };
  if (!response.ok || !response.body) throw new Error(readableError(response.status, provider,
    typeof detail === "string" ? detail : undefined));

  yield* openAI ? openAIEvents(response.body) : claudeEvents(response.body);
}
