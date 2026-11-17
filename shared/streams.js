export async function* readLines(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      const parts = (pending + value).split("\n");
      pending = parts.pop();
      for (const part of parts) yield part.replace(/\r$/, "");
    }
    if (pending) yield pending.replace(/\r$/, "");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* readEvents(stream) {
  let data = [];
  for await (const line of readLines(stream)) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    if (line === "" && data.length) {
      const payload = data.join("\n");
      data = [];
      if (payload !== "[DONE]") yield JSON.parse(payload);
    }
  }
  if (data.length && data.join("\n") !== "[DONE]") yield JSON.parse(data.join("\n"));
}
