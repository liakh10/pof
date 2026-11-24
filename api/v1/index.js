// Vercel function for /v1/* (vercel.json rewrites /v1/:path* to /api/v1?path=:path*).
import { handleV1 } from "./_core.js";

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const query = Object.fromEntries(url.searchParams);
  let path = query.path ?? url.pathname.replace(/^\/(api\/)?v1\/?/, "");
  delete query.path;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const out = await handleV1({ method: req.method, path, query, origin: `${proto}://${req.headers.host}` });
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(req.method === "HEAD" ? "" : out.body);
}
