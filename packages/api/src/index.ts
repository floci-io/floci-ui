import "dotenv/config";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import eks from "./routes/eks";
import ec2 from "./routes/ec2";
import secretsmanager from "./routes/secretsmanager";
import clouds from "./routes/clouds";
const app = new Hono();

// The Secrets Manager routes read and delete secret values with server-side
// AWS credentials, so an unrestricted `cors()` would let any web page in the
// browser drive them cross-origin. Restrict CORS to trusted origins for those
// routes only and keep the permissive default elsewhere. (Broad CORS hardening
// for the other routes is tracked separately.) In production the frontend is
// served from the same origin (see serveStatic below), so same-origin requests
// are unaffected; cross-origin callers must be explicitly allow-listed.
//
// A single CORS middleware handles both cases: stacking two `cors()` calls
// would either short-circuit the OPTIONS preflight in the wrong handler or let
// the later one overwrite `Access-Control-Allow-Origin` on real requests.
const secretsManagerOrigins = (
  process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: (origin, c) =>
      c.req.path.startsWith("/api/secretsmanager")
        ? secretsManagerOrigins.includes(origin)
          ? origin
          : null
        : "*",
  }),
);
app.use("*", logger());

app.route("/api/eks", eks);
app.route("/api/ec2", ec2);
app.route("/api/secretsmanager", secretsmanager);
app.route("/api/clouds", clouds);

// Serve static frontend files when public/ directory is present (production)
app.use("*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT ?? 4501);
export default { port, fetch: app.fetch };
