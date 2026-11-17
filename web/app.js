import { AI, firstLine, instructionsLimit, providers, runGroupTurn } from "../shared/chat.js";
import { readLines } from "../shared/streams.js";
import { icon } from "./icons.js";
import { markdown } from "./markdown.js";
import { changeVault, openVault } from "./vault.js";

const $ = selector => document.querySelector(selector);
const apiURL = $('meta[name="multia-api"]').content;
const dateFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const effortLabels = { low: "Low", medium: "Medium", high: "High" };
const draft = $("#message");
const history = $("#history");
const transcript = $("#message-list");
const dialogs = [...document.querySelectorAll("dialog")];

const state = {
  session: null, key: null, data: null, expiry: null,
  drafts: new Map(), runs: new Map(), activity: new Map(), usage: new Map(),
  notices: new Map(),
};
let renderedChat;
let renderedMessages = 0;
let activityFrame = 0;

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(label, glyph, action) {
  const el = element("button", "icon-button");
  el.type = "button";
  el.title = label;
  el.setAttribute("aria-label", label);
  el.innerHTML = icon(glyph);
  el.addEventListener("click", action);
  return el;
}

function avatar(who) {
  const el = element("span", `avatar ${who}`);
  el.innerHTML = icon(who);
  el.setAttribute("aria-hidden", "true");
  return el;
}

function newChat() {
  return { id: crypto.randomUUID(), name: "New chat", instructions: "", messages: [] };
}

function initialDatabase() {
  const chat = newChat();
  return {
    revision: 0, selected: chat.id, chats: [chat],
    prefs: {
      theme: "graphite", accent: "violet",
      gpt: { model: "gpt-6.1-sol", effort: "low" },
      claud: { model: "claude-sonnet-5-5", effort: "low" },
    },
  };
}

function selectedChat() {
  return state.data?.chats.find(chat => chat.id === state.data.selected);
}

function formatError(error) {
  if (error?.name === "QuotaExceededError") return "This browser’s chat storage is full. Delete a saved chat to free space.";
  return error?.message || "Something went wrong.";
}

async function save(change, options) {
  const key = state.key;
  const previous = state.data.selected;
  const database = await changeVault(key, change);
  if (state.key !== key) return;
  if (database.revision >= state.data.revision) state.data = database;
  render(options);
  if (state.data.selected !== previous) {
    draft.value = state.drafts.get(state.data.selected) || "";
    updateComposer();
  }
}

function openSidebar(open) {
  $("#sidebar").classList.toggle("is-open", open);
  $("#open-sidebar").setAttribute("aria-expanded", String(open));
  $("#scrim").hidden = !open;
}

function openActivity(open) {
  $("#activity").hidden = !open;
  $("#workspace").classList.toggle("has-activity", open);
  $("#toggle-activity").setAttribute("aria-expanded", String(open));
  if (open) renderActivity();
}

function showDialog(dialog) {
  const status = dialog.querySelector("[data-dialog-status]");
  if (status) status.hidden = true;
  dialog.showModal();
}

async function dialogAction(dialog, action) {
  const controls = [...dialog.querySelectorAll("button:not([data-close])")];
  controls.forEach(control => { control.disabled = true; });
  try {
    await action();
    dialog.close();
  } catch (error) {
    const status = dialog.querySelector("[data-dialog-status]");
    status.textContent = formatError(error);
    status.hidden = false;
  } finally {
    controls.forEach(control => { control.disabled = false; });
  }
}

function setNotice(chatID, text) {
  if (text) state.notices.set(chatID, text);
  else state.notices.delete(chatID);
  if (selectedChat()?.id === chatID) updateComposer();
}

function openSettings() {
  const chat = selectedChat();
  $("#settings-dialog").dataset.chat = chat.id;
  $("#chat-name").value = chat.name;
  $("#instructions").value = chat.instructions;
  updateInstructionsCount();
  showDialog($("#settings-dialog"));
}

function updateInstructionsCount() {
  $("#instruction-count").textContent = `${$("#instructions").value.length} / ${instructionsLimit}`;
}

function openModel(provider) {
  const dialog = $("#provider-dialog");
  dialog.dataset.provider = provider;
  $("#provider-title").textContent = providers[provider].name;
  const config = state.data.prefs[provider];
  $("#model").replaceChildren(...Object.entries(providers[provider].models)
    .map(([value, label]) => new Option(label, value)));
  $("#model").value = config.model;
  $("#effort").value = config.effort;
  showDialog(dialog);
}

function openUsage(provider) {
  const info = providers[provider];
  $("#usage-title").textContent = `${info.name} usage`;
  $("#usage-url").href = info.usageURL;
  const detail = $("#usage-detail");
  const recorded = state.usage.get(provider);
  const labels = { requests: "Requests remaining", tokens: "Tokens remaining",
    inputTokens: "Input tokens remaining", outputTokens: "Output tokens remaining" };
  const entries = Object.entries(labels).filter(([key]) => recorded?.limits[key] !== undefined);
  if (entries.length) {
    const list = element("dl", "limits");
    for (const [key, label] of entries) {
      const value = recorded.limits[key];
      list.append(element("dt", "", label), element("dd", "", Number.isFinite(Number(value)) ? Number(value).toLocaleString() : value));
    }
    detail.replaceChildren(element("p", "muted",
      `API rate limits last reported for ${info.models[recorded.model]} at ${dateFormat.format(recorded.when)}.`), list);
  } else {
    detail.replaceChildren(element("p", "muted", "API rate limits appear here when the provider reports them in a reply."));
  }
  showDialog($("#usage-dialog"));
}

function renderChats() {
  const items = state.data.chats.map(chat => {
    const current = chat.id === state.data.selected;
    const el = element("button", `chat-item${current ? " selected" : ""}`);
    el.type = "button";
    el.title = chat.name;
    if (current) el.setAttribute("aria-current", "page");
    const glyph = element("span");
    glyph.innerHTML = icon("chat");
    el.append(glyph, element("span", "chat-item-name", chat.name));
    if (state.runs.has(chat.id)) el.append(element("span", "running-dot"));
    el.addEventListener("click", async () => {
      openSidebar(false);
      const previous = selectedChat().id;
      if (chat.id === previous) return;
      try {
        await save(data => {
          if (data.chats.some(item => item.id === chat.id)) data.selected = chat.id;
        }, { scroll: true });
      } catch (error) {
        setNotice(previous, formatError(error));
      }
    });
    return el;
  });
  $("#chat-list").replaceChildren(...items);
}

function renderMembers() {
  const cards = AI.map(provider => {
    const label = providers[provider];
    const config = state.data.prefs[provider];
    const connected = state.session.connected[provider];
    const el = element("div", `member ${provider}`);
    const identity = element("div", "member-identity");
    identity.append(element("span", "member-name", label.name));
    identity.append(element("span", "model-name",
      connected ? `${label.models[config.model]} · ${effortLabels[config.effort]}` : "API key needed"));
    const actions = element("div", "member-actions");
    actions.append(button(`${label.name} model and effort`, "sliders", () => openModel(provider)),
      button(`${label.name} usage`, "gauge", () => openUsage(provider)));
    el.append(avatar(provider), identity, actions);
    return el;
  });
  $("#members").replaceChildren(...cards);
}

function drawMessage(message) {
  const fromUser = message.author === "user";
  const who = fromUser ? "You" : providers[message.author].name;
  const row = element("article", `message ${message.author}`);
  const stack = element("div", "message-stack");
  const metadata = element("div", "message-meta");
  const time = element("time", "", dateFormat.format(message.time));
  time.dateTime = new Date(message.time).toISOString();
  metadata.append(element("strong", "", who), time);
  const body = element("div", "bubble");
  body.append(markdown(message.content));
  stack.append(metadata, body);
  row.append(avatar(message.author), stack);
  return row;
}

function emptyChat() {
  const container = element("div", "empty");
  const avatars = element("div", "avatar-row");
  avatars.append(avatar("gpt"), avatar("claud"));
  container.append(avatars, element("h2", "", "Start a conversation"),
    element("p", "muted", "Ask the group, or mention @gpt or @claud to get a reply from one of them."));
  return container;
}

function renderTranscript(chat, scroll) {
  const atBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 90;
  const changed = renderedChat !== chat.id;
  if (changed || renderedMessages > chat.messages.length || renderedMessages === 0) {
    transcript.replaceChildren();
    renderedChat = chat.id;
    renderedMessages = 0;
  }
  if (!chat.messages.length) transcript.append(emptyChat());
  for (const message of chat.messages.slice(renderedMessages)) transcript.append(drawMessage(message));
  renderedMessages = chat.messages.length;
  if (changed || scroll || atBottom) history.scrollTop = history.scrollHeight;
}

function renderActivity() {
  if ($("#activity").hidden) return;
  const activity = state.activity.get(selectedChat()?.id);
  const list = $("#activity-list");
  const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 50;
  const items = activity?.map(item => {
    const card = element("article", "activity-entry");
    const heading = element("div", "activity-entry-title");
    heading.append(avatar(item.provider), element("strong", "", providers[item.provider].name),
      element("span", "activity-phase", item.phase));
    card.append(heading);
    if (item.text) card.append(element("p", "summary", item.text));
    if (item.error) card.append(element("p", "notice", item.error));
    return card;
  }) || [];
  list.replaceChildren(...(items.length ? items : [element("p", "muted", "Provider updates will appear here during a reply.")]));
  if (nearEnd) list.scrollTop = list.scrollHeight;
}

function repaintActivity() {
  if (activityFrame) return;
  activityFrame = requestAnimationFrame(() => {
    activityFrame = 0;
    renderActivity();
  });
}

function updateComposer() {
  const chat = selectedChat();
  if (!chat) return;
  const running = state.runs.has(chat.id);
  $("#send").disabled = running || !draft.value.trim();
  $("#stop").hidden = !running;
  const status = $("#chat-status");
  const latest = state.activity.get(chat.id)?.at(-1);
  const notice = state.notices.get(chat.id);
  status.className = notice ? "notice" : "notice muted";
  status.hidden = !(notice || running);
  status.textContent = notice || (latest ? `${providers[latest.provider].name} · ${latest.phase}` : "Waiting for a reply…");
}

function render(options = {}) {
  const chat = selectedChat();
  if (!chat) return;
  document.documentElement.dataset.theme = state.data.prefs.theme;
  document.documentElement.dataset.accent = state.data.prefs.accent;
  $("#chat-title").textContent = chat.name;
  renderChats();
  renderMembers();
  renderTranscript(chat, options.scroll);
  updateComposer();
  renderActivity();
}

function signOut(message = "") {
  clearTimeout(state.expiry);
  for (const run of state.runs.values()) run.abort();
  dialogs.forEach(dialog => dialog.close());
  openActivity(false);
  openSidebar(false);
  for (const name of ["drafts", "runs", "activity", "usage", "notices"]) state[name].clear();
  state.session = state.key = state.data = null;
  renderedChat = undefined;
  renderedMessages = 0;
  draft.value = "";
  $("#chat-name").value = "";
  $("#instructions").value = "";
  $("#chat-title").textContent = "";
  $("#chat-status").textContent = "";
  $("#chat-list").replaceChildren();
  transcript.replaceChildren();
  $("#activity-list").replaceChildren();
  $("#usage-detail").replaceChildren();
  $("#workspace").hidden = true;
  $("#gate").hidden = false;
  $("#login-status").textContent = message;
  $("#password").focus();
}

async function callAPI(endpoint, payload, signal, session = null) {
  const headers = { "Content-Type": "application/json" };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  let response;
  try {
    response = await fetch(`${apiURL}${endpoint}`, {
      method: "POST", body: JSON.stringify(payload), headers, signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("The MultiA backend could not be reached.");
  }
  if (response.ok) return response;
  const fault = (await response.json().catch(() => null))?.error;
  const error = new Error(fault || `The backend returned HTTP ${response.status}.`);
  if (session && response.status === 401 && state.session === session) signOut(error.message);
  throw error;
}

function stageActivity(chatID, provider, phase) {
  const item = { provider, phase, text: "" };
  state.activity.get(chatID).push(item);
  if (selectedChat()?.id === chatID) {
    updateComposer();
    repaintActivity();
  }
  return item;
}

async function getReply(chatID, turn, instructions, config, signal, session) {
  if (!session.connected[turn.provider] && !turn.required) return "";
  const activity = stageActivity(chatID, turn.provider, "Thinking…");
  const response = await callAPI("/api/turn", {
    ...turn, ...config[turn.provider], instructions,
    transcript: turn.transcript.map(({ author, content }) => ({ author, content })),
  }, signal, session);
  let reply = "";
  let completed = false;
  if (!response.body) throw new Error("No reply stream was returned.");
  for await (const line of readLines(response.body)) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.type === "usage") {
      if (Object.keys(event.usage).length) state.usage.set(turn.provider, {
        limits: event.usage, model: config[turn.provider].model, when: Date.now(),
      });
    } else if (event.type === "activity") {
      activity.text += event.text;
    } else if (event.type === "reply") {
      reply += event.text;
      if (activity.phase !== "Writing…") {
        activity.phase = "Writing…";
        if (selectedChat()?.id === chatID) updateComposer();
      }
    } else if (event.type === "done") {
      completed = true;
      activity.incomplete = event.incomplete;
    } else if (event.type === "error") throw new Error(event.message);
    if (selectedChat()?.id === chatID) repaintActivity();
  }
  if (!completed) throw new Error("The reply stream ended unexpectedly.");
  return reply;
}

async function sendMessage() {
  const chat = selectedChat();
  const text = draft.value.trim();
  if (!chat || !text || state.runs.has(chat.id)) return;
  const chatID = chat.id;
  const session = state.session;
  const key = state.key;
  const run = new AbortController();
  const messages = [];
  const failures = [];
  state.runs.set(chatID, run);
  state.activity.set(chatID, []);
  setNotice(chatID, "");
  draft.value = "";
  state.drafts.delete(chatID);
  updateComposer();
  let userMessageSaved = false;

  const append = async (author, content) => {
    if (state.key !== key || run.signal.aborted) return;
    const message = { id: crypto.randomUUID(), author, content, time: Date.now() };
    await save(data => {
      const target = data.chats.find(item => item.id === chatID);
      if (!target) throw new Error("This chat was deleted in another tab.");
      if (author === "user" && !target.messages.length && target.name === "New chat") {
        target.name = firstLine(content).slice(0, 64);
      }
      target.messages.push(message);
      messages.splice(0, messages.length, ...target.messages);
    }, { scroll: author === "user" && selectedChat().id === chatID });
  };

  try {
    await append("user", text);
    userMessageSaved = true;
    if (state.session !== session || run.signal.aborted) return;
    const config = state.data.prefs;
    const result = await runGroupTurn({
      message: text, getTranscript: () => messages, publish: append, signal: run.signal,
      call: turn => getReply(chatID, turn, chat.instructions, config, run.signal, session),
      finish(provider, error) {
        const item = state.activity.get(chatID)?.at(-1);
        if (item?.provider !== provider) return;
        item.phase = error ? "Error" : error === null ? "Skipped" : item.incomplete ? "Output limit" : "Responded";
        if (error) {
          item.error = formatError(error);
          failures.push(item.error);
        }
        if (selectedChat()?.id === chatID) repaintActivity();
      },
    });
    if (run.signal.aborted || state.session !== session) return;
    if (result?.limitReached) failures.push("The AI handoff limit was reached. Send a new message to continue.");
    if (failures.length) setNotice(chatID, failures.join(" "));
  } catch (error) {
    if (state.session === session) {
      setNotice(chatID, formatError(error));
      if (!userMessageSaved && !state.drafts.has(chatID)) {
        state.drafts.set(chatID, text);
        if (selectedChat()?.id === chatID) draft.value = text;
      }
    }
  } finally {
    if (state.runs.get(chatID) === run) {
      if (run.signal.aborted) {
        const item = state.activity.get(chatID)?.at(-1);
        if (item && ["Thinking…", "Writing…"].includes(item.phase)) item.phase = "Stopped";
      }
      state.runs.delete(chatID);
      renderChats();
      if (selectedChat()?.id === chatID) {
        updateComposer();
        repaintActivity();
      }
    }
  }
}

function editDraft(prefix, suffix = "", fallback = "", selectURL = false) {
  const start = draft.selectionStart;
  const end = draft.selectionEnd;
  const text = draft.value.slice(start, end) || fallback;
  draft.setRangeText(prefix + text + suffix, start, end, "end");
  if (selectURL) {
    const pos = start + prefix.length + text.length + 2;
    draft.setSelectionRange(pos, pos + "https://".length);
  } else if (suffix) {
    draft.setSelectionRange(start + prefix.length, start + prefix.length + text.length);
  }
  draft.focus();
  draft.dispatchEvent(new Event("input"));
}

for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon);
for (const el of document.querySelectorAll("[data-close]")) el.addEventListener("click", () => el.closest("dialog").close());
for (const el of document.querySelectorAll("[data-mention]")) el.addEventListener("click", () => {
  const before = draft.value.at(draft.selectionStart - 1);
  editDraft(`${draft.selectionStart && !/\s/.test(before) ? " " : ""}${el.dataset.mention} `);
});
const wrappers = { bold: ["**", "**"], italic: ["*", "*"], underline: ["<u>", "</u>"],
  link: ["[", "](https://)", "link text", true] };
for (const el of document.querySelectorAll("[data-format]")) {
  el.addEventListener("click", () => editDraft(...wrappers[el.dataset.format]));
}

const form = $("#login");
if (!apiURL) {
  form.hidden = true;
  $("#login-status").textContent = "The backend has not been configured for this deployment.";
  $("#setup-link").hidden = false;
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#password");
  const submit = form.querySelector("button");
  submit.disabled = true;
  $("#login-status").textContent = "Unlocking…";
  try {
    const session = await (await callAPI("/api/session", { password: input.value })).json();
    let vault;
    try {
      vault = await openVault(input.value, initialDatabase);
    } catch (error) {
      if (error.name === "OperationError") throw new Error("The conversation history in this browser could not be decrypted with this password.");
      throw error;
    }
    state.session = session;
    state.key = vault.key;
    state.data = vault.database;
    state.expiry = setTimeout(() => signOut("Session expired. Unlock MultiA again."), Math.max(0, session.expiresAt - Date.now()));
    $("#gate").hidden = true;
    $("#workspace").hidden = false;
    render({ scroll: true });
    draft.focus();
  } catch (error) {
    if (state.session) signOut(formatError(error));
    else $("#login-status").textContent = formatError(error);
  } finally {
    input.value = "";
    if (!state.session) input.focus();
    submit.disabled = false;
  }
});

$("#new-chat").addEventListener("click", async () => {
  const before = selectedChat().id;
  try {
    await save(data => {
      const chat = newChat();
      data.chats.unshift(chat);
      data.selected = chat.id;
    }, { scroll: true });
    openSidebar(false);
    draft.focus();
  } catch (error) {
    setNotice(before, formatError(error));
  }
});
$("#open-sidebar").addEventListener("click", () => { openSidebar(true); $("#new-chat").focus(); });
$("#scrim").addEventListener("click", () => { openSidebar(false); $("#open-sidebar").focus(); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#scrim").hidden) {
    openSidebar(false);
    $("#open-sidebar").focus();
  }
});
$("#lock").addEventListener("click", () => signOut());
$("#chat-settings").addEventListener("click", openSettings);
$("#instructions").addEventListener("input", updateInstructionsCount);
$("#toggle-activity").addEventListener("click", () => openActivity($("#activity").hidden));
$("#close-activity").addEventListener("click", () => {
  openActivity(false);
  $("#toggle-activity").focus();
});
$("#settings-form").addEventListener("submit", event => {
  event.preventDefault();
  const dialog = $("#settings-dialog");
  const name = $("#chat-name").value.trim();
  if (!name) return;
  dialogAction(dialog, () => save(data => {
    const chat = data.chats.find(item => item.id === dialog.dataset.chat);
    if (chat) {
      chat.name = name;
      chat.instructions = $("#instructions").value;
    }
  }));
});
$("#duplicate").addEventListener("click", () => {
  const dialog = $("#settings-dialog");
  dialogAction(dialog, () => save(data => {
    const chat = data.chats.find(item => item.id === dialog.dataset.chat);
    if (!chat) return;
    const copy = { ...structuredClone(chat), id: crypto.randomUUID(), name: chat.name.slice(0, 73) + " (copy)" };
    data.chats.unshift(copy);
    data.selected = copy.id;
  }, { scroll: true }));
});
$("#delete").addEventListener("click", () => {
  const dialog = $("#settings-dialog");
  const id = dialog.dataset.chat;
  const name = state.data.chats.find(chat => chat.id === id)?.name;
  if (!name || !window.confirm(`Delete “${name}” from this browser?`)) return;
  state.runs.get(id)?.abort();
  dialogAction(dialog, async () => {
    await save(data => {
      data.chats = data.chats.filter(chat => chat.id !== id);
      if (!data.chats.length) data.chats.push(newChat());
      if (data.selected === id) data.selected = data.chats[0].id;
    }, { scroll: true });
    for (const field of ["activity", "drafts", "notices"]) state[field].delete(id);
  });
});
$("#provider-form").addEventListener("submit", event => {
  event.preventDefault();
  const dialog = $("#provider-dialog");
  dialogAction(dialog, () => save(data => {
    data.prefs[dialog.dataset.provider] = { model: $("#model").value, effort: $("#effort").value };
  }));
});
$("#appearance").addEventListener("click", () => {
  $("#theme").value = state.data.prefs.theme;
  $("#accent").value = state.data.prefs.accent;
  openSidebar(false);
  showDialog($("#appearance-dialog"));
});
$("#appearance-form").addEventListener("submit", event => {
  event.preventDefault();
  dialogAction($("#appearance-dialog"), () => save(data => {
    data.prefs.theme = $("#theme").value;
    data.prefs.accent = $("#accent").value;
  }));
});
draft.addEventListener("input", () => {
  state.drafts.set(selectedChat().id, draft.value);
  updateComposer();
});
draft.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});
$("#compose").addEventListener("submit", event => {
  event.preventDefault();
  sendMessage();
});
$("#stop").addEventListener("click", () => state.runs.get(selectedChat().id)?.abort());
