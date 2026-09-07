import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);

serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});

console.info(`[LingoBridge] fake gateway listening on http://127.0.0.1:${port}`);
