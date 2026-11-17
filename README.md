# MultiA

MultiA is a single-user group chat with ChatGPT and Claude. The hosted page opens in a desktop or mobile browser. One password unlocks the app, and each browser has its own encrypted conversation history.

Both models receive the shared transcript. Use `@gpt` or `@claud` to request a reply. Either model can pass on unaddressed turns or start its reply with the other model’s handle to hand off a question. Each human message can trigger up to four AI calls, including calls where the model decides to pass. The Activity panel shows short statuses and any thinking summaries supplied by the provider. Activity is kept in memory and stays outside the transcript.

Chat settings let you rename, duplicate, delete, or set up to 2,500 characters of instructions. Provider settings control the model and thinking effort. Usage shows the latest API rate limits the provider returned. The dashboard links show provider billing and account usage.

This version supports Markdown, underlining, safe HTML formatting and HTTPS links. File uploads and resolving linked files for the AIs are deferred. Clearing browser storage removes this browser’s history. The deployment password is also used to unlock the local history, so keep it stable.

## Deploy

The interface runs on [GitHub Pages](https://smeagol44.github.io/multia/). A Cloudflare Worker verifies the password, issues an eight-hour session, and calls the OpenAI and Anthropic APIs from the server. The Pages shell is public. A successful server-side login is required to open the workspace or make AI calls. The Worker has no conversation database and does not log message content. Provider requests include the visible transcript.

1. Install Node.js 24 and run `npm ci` from the repository root.
2. Run `npx wrangler login` in your terminal, then run `npm run deploy:api`. Copy the Worker’s HTTPS origin from the output.
3. Supply the following values at Wrangler’s interactive secret prompts. Use a unique passphrase for the first secret and an independent randomly generated value for the second. API requests are billed to the accounts that own the keys.

   | Command | Value |
   | --- | --- |
   | `npx wrangler secret put APP_PASSWORD` | The single MultiA password |
   | `npx wrangler secret put SESSION_SECRET` | Output from `openssl rand -hex 32` |
   | `npx wrangler secret put OPENAI_API_KEY` | [OpenAI API key](https://platform.openai.com/api-keys) |
   | `npx wrangler secret put ANTHROPIC_API_KEY` | [Claude Console API key](https://platform.claude.com/settings/keys) |

4. In the repository’s [Actions variables](https://github.com/smeagol44/multia/settings/variables/actions), create `MULTIA_API_URL` with the Worker’s HTTPS origin. Leave the Pages source set to **GitHub Actions**.
5. Run **Publish MultiA to Pages** from [Actions](https://github.com/smeagol44/multia/actions/workflows/pages.yml). Open the [Pages site](https://smeagol44.github.io/multia/) and unlock it.

The default Worker origin allowlist is `https://smeagol44.github.io`. For another Pages hostname, update `APP_ORIGIN` in `wrangler.toml` and redeploy the Worker.

## Run locally

Copy `.dev.vars.example` to `.dev.vars` and fill in the same four values. Run `npm ci` and `npm run dev`, then open [http://127.0.0.1:4173](http://127.0.0.1:4173). Run `npm test` for the provider, routing, and authentication tests.
