import { createHandler } from "./handler.mjs";

const handler = createHandler({
  token: Deno.env.get("TMDB_API_READ_ACCESS_TOKEN") || "",
  allowedOriginList: Deno.env.get("TMDB_ALLOWED_ORIGINS") || ""
});

Deno.serve(handler);
