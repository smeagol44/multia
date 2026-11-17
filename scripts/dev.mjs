import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const origin = "http://127.0.0.1:4173";
const worker = "http://127.0.0.1:8787";
const status = await new Promise(resolve => {
  const build = spawn(process.execPath, ["scripts/build.mjs"], {
    stdio: "inherit", env: { ...process.env, MULTIA_API_URL: worker },
  });
  build.on("exit", resolve);
});
if (status !== 0) process.exit(status || 1);

const emulator = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--ip", "127.0.0.1",
  "--port", "8787", "--var", `APP_ORIGIN:${origin}`], { stdio: "inherit" });
const files = new Map([
  ["/", ["index.html", "text/html"]], ["/index.html", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]], ["/app.js", ["app.js", "text/javascript"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/inter-latin-wght-normal.woff2", ["inter-latin-wght-normal.woff2", "font/woff2"]],
]);
const server = createServer(async (req, res) => {
  const file = files.get(new URL(req.url, origin).pathname);
  if (!file) return res.writeHead(404).end();
  try {
    const content = await readFile(`dist/${file[0]}`);
    res.writeHead(200, { "Content-Type": file[1] }).end(content);
  } catch {
    res.writeHead(500).end("Could not read the build output.");
  }
});
server.listen(4173, "127.0.0.1", () => console.log(`MultiA is available at ${origin}`));
emulator.once("exit", code => { server.close(); process.exitCode = code || 0; });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    emulator.kill(signal);
  });
}
