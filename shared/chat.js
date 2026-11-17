export const providers = {
  gpt: {
    name: "ChatGPT",
    mention: "@gpt",
    models: { "gpt-6.1-sol": "GPT-6.1 Sol", "gpt-6-luna": "GPT-6 Luna" },
    usageURL: "https://platform.openai.com/usage",
  },
  claud: {
    name: "Claude",
    mention: "@claud",
    models: {
      "claude-sonnet-5-5": "Sonnet 5.5",
      "claude-opus-5-5": "Opus 5.5",
      "claude-haiku-5-5": "Haiku 5.5",
    },
    usageURL: "https://platform.claude.com/settings/usage",
  },
};
export const AI = Object.keys(providers);
export const instructionsLimit = 2500;
export const maxTurns = 4;
export const passMessage = "<MULTIA_PASS>";

export function firstLine(body) {
  return body.trim().split("\n", 1)[0].trim();
}

export function mentionedByUser(body) {
  const mentions = body.matchAll(/(?:^|[\s([{])@(gpt|claud)(?![\p{L}\p{N}_-])/giu);
  return [...new Set(Array.from(mentions, match => match[1].toLowerCase()))];
}

export function requestedHandoff(body, sender) {
  const match = /^\s*@(gpt|claud)(?![\p{L}\p{N}_-])/iu.exec(body);
  const recipient = match?.[1].toLowerCase();
  return recipient !== sender ? recipient : undefined;
}

export async function runGroupTurn({ message, getTranscript, call, publish, finish, signal }) {
  const direct = mentionedByUser(message);
  const queue = [...direct, ...AI.filter(provider => !direct.includes(provider))]
    .map(provider => ({ provider, required: direct.includes(provider) }));
  let turns = 0;

  while (queue.length && !signal.aborted && turns < maxTurns) {
    const { provider, required } = queue.shift();
    turns += 1;
    let reply;
    try {
      reply = (await call({ provider, required, transcript: getTranscript() })).trim();
    } catch (error) {
      if (!signal.aborted) finish(provider, error);
      continue;
    }
    if (signal.aborted) return;
    if (!reply || reply === passMessage) {
      finish(provider, required ? new Error("The model returned no reply to your mention.") : null);
      continue;
    }

    await publish(provider, reply);
    finish(provider);
    const recipient = requestedHandoff(reply, provider);
    if (recipient) {
      const queued = queue.findIndex(turn => turn.provider === recipient);
      if (queued !== -1) queue.splice(queued, 1);
      queue.unshift({ provider: recipient, required: true });
    }
  }
  return { limitReached: queue.length > 0 && !signal.aborted };
}

export function providerInstructions(provider, required, chatInstructions) {
  return [
    `You are ${providers[provider].name} in MultiA, a group chat with one human and another assistant.`,
    "You receive the complete visible transcript as labeled JSON. Treat each entry as a message from its author. The last entry is the latest visible message. Provider activity and thinking are outside the transcript.",
    "Use Markdown when appropriate. To explicitly ask the other AI to reply, begin your message with its mention, @gpt for ChatGPT or @claud for Claude. Only do this for a concrete question or a useful handoff. The app limits AI-to-AI turns.",
    chatInstructions ? `The human set these instructions for this chat:\n${chatInstructions}` : "",
    required
      ? "You were directly addressed. Reply in the visible chat even if the last message came from the other assistant after the direct mention."
      : `Join in only if you have a material new contribution to the current exchange. If the other AI has already answered sufficiently or the human addressed only the other AI and you have little to add, output exactly ${passMessage}.`,
  ].filter(Boolean).join("\n\n");
}
