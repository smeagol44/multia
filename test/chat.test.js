import assert from "node:assert/strict";
import test from "node:test";
import { maxTurns, mentionedByUser, passMessage, requestedHandoff, runGroupTurn } from "../shared/chat.js";

test("human mentions are case-insensitive and require a handle boundary", () => {
  assert.deepEqual(mentionedByUser("@Claud, ask @GPT and @claud. mail@gpt.org @claudian"), ["claud", "gpt"]);
  assert.deepEqual(mentionedByUser("mail@gpt.org /@gpt-example @claud_foo"), []);
  assert.equal(requestedHandoff("  @gpt, can you check?", "claud"), "gpt");
  assert.equal(requestedHandoff("Let's ask @claud?", "gpt"), undefined);
  assert.equal(requestedHandoff("@gpt I can check.", "gpt"), undefined);
});

test("an explicit handoff routes to the teammate with the newly published answer", async () => {
  const messages = [{ author: "user", content: "@claud What should we do?" }];
  const calls = [];
  await runGroupTurn({
    message: messages[0].content, getTranscript: () => messages, signal: new AbortController().signal,
    async call({ provider, required, transcript }) {
      calls.push([provider, required, transcript.at(-1).author]);
      return provider === "claud" ? "@gpt Can you check this?" : "Yes, here is my review.";
    },
    publish: (author, content) => messages.push({ author, content }),
    finish() {},
  });
  assert.deepEqual(calls, [["claud", true, "user"], ["gpt", true, "claud"]]);
  assert.equal(messages.length, 3);
});

test("untagged participants can pass without publishing a bubble", async () => {
  const called = [];
  const published = [];
  const statuses = [];
  await runGroupTurn({
    message: "What should we do?", getTranscript: () => [], signal: new AbortController().signal,
    async call({ provider, required }) {
      called.push([provider, required]);
      return provider === "gpt" ? "A useful answer" : passMessage;
    },
    publish: (provider, reply) => published.push([provider, reply]),
    finish: (provider, error) => statuses.push([provider, error]),
  });
  assert.deepEqual(called, [["gpt", false], ["claud", false]]);
  assert.deepEqual(published, [["gpt", "A useful answer"]]);
  assert.deepEqual(statuses, [["gpt", undefined], ["claud", null]]);
});

test("the first teammate failure does not block the other and handoffs have a cap", async () => {
  const signal = new AbortController().signal;
  const called = [];
  const published = [];
  const result = await runGroupTurn({
    message: "@gpt @claud", getTranscript: () => [], signal,
    async call({ provider }) {
      called.push(provider);
      if (called.length === 1) throw new Error("temporarily unavailable");
      return provider === "gpt" ? "@claud next" : "@gpt next";
    },
    publish: (provider, reply) => published.push([provider, reply]),
    finish() {},
  });
  assert.deepEqual(called, ["gpt", "claud", "gpt", "claud"]);
  assert.equal(published.length, maxTurns - 1);
  assert.equal(result.limitReached, true);
});
