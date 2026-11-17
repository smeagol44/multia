import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const configured = process.env.MULTIA_API_URL?.trim();
let api = "";
if (configured) {
  const url = new URL(configured);
  const local = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || !/^[a-z0-9.\-:[\]]+$/i.test(url.host)) {
    throw new Error("MULTIA_API_URL must be an HTTPS origin (or an HTTP loopback origin for local development).");
  }
  api = url.origin;
}

await rm("dist", { recursive: true, force: true });
await mkdir("dist");
const template = await readFile("web/index.html", "utf8");
await Promise.all([
  writeFile("dist/index.html", template.replace("__MULTIA_API__", api).replace("__MULTIA_CONNECT__", api)),
  writeFile("dist/.nojekyll", ""),
  cp("web/style.css", "dist/style.css"),
  cp("web/favicon.svg", "dist/favicon.svg"),
  cp("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "dist/inter-latin-wght-normal.woff2"),
  build({ entryPoints: ["web/app.js"], bundle: true, outfile: "dist/app.js", minify: true,
    format: "esm", target: "es2022", legalComments: "external" }),
]);
