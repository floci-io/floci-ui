import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import eks from "./routes/eks";
import ec2 from "./routes/ec2";
import secretsmanager from "./routes/secretsmanager";
import clouds from "./routes/clouds";
import { NotFoundError, toHttpError } from "./cloud-spi/errors";
import type { CloudProvider } from "./cloud-spi/types";
import { resolveScopedCloud } from "./service/defaultCloud";

/** The part of Bun's `Server` a route may use to extend its own request's idle timeout. */
export interface RequestTimeoutServer {
  timeout(request: Request, seconds: number): void;
}

export interface ApiBindings {
  server?: RequestTimeoutServer;
}

export function createApiApp(
  cloudRoutes: Hono = clouds,
  scope: CloudProvider | null = resolveScopedCloud(),
) {
  const app = new Hono<{ Bindings: ApiBindings }>();

  // Secrets Manager and KMS routes handle sensitive values with server-side
  // AWS credentials, so an unrestricted `cors()` would let any web page in the
  // browser drive them cross-origin. Restrict CORS to trusted origins for those
  // routes and keep the permissive default elsewhere. In production the frontend
  // is served from the same origin (see serveStatic below), so same-origin requests
  // are unaffected; cross-origin callers must be explicitly allow-listed.
  //
  // A single CORS middleware handles both cases: stacking two `cors()` calls
  // would either short-circuit the OPTIONS preflight in the wrong handler or let
  // the later one overwrite `Access-Control-Allow-Origin` on real requests.
  const trustedOrigins = (
    process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:4500"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (
      c.req.method === "POST" &&
      isKeyMutationRoute(c.req.path) &&
      origin &&
      origin !== new URL(c.req.url).origin &&
      !trustedOrigins.includes(origin)
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (origin, c) =>
        isSensitiveCredentialRoute(c.req.path)
          ? trustedOrigins.includes(origin)
            ? origin
            : null
          : "*",
    }),
  );
  app.use("*", logger());

  // EKS, EC2 and Secrets Manager predate /api/clouds and are AWS only, so a console
  // scoped to another cloud does not serve them either.
  if (scope !== null && scope !== "aws") {
    app.use("*", async (c, next) => {
      if (isAwsOnlyRoute(c.req.path)) {
        const { status, body } = toHttpError(new NotFoundError("Unknown cloud"));
        return c.json(body, status);
      }
      await next();
    });
  }

  app.route("/api/eks", eks);
  app.route("/api/ec2", ec2);
  app.route("/api/secretsmanager", secretsmanager);
  app.route("/api/clouds", cloudRoutes);

  // Serve static frontend files when public/ directory is present (production)
  app.use("*", serveStatic({ root: "./public" }));
  app.get("*", serveStatic({ path: "./public/index.html" }));

  return app;
}

/**
 * Bun's fetch handler. Bun passes its server as the second argument; handing it
 * on as `c.env.server` lets a long-running route raise its own idle timeout.
 */
export function createBunFetch(app: ReturnType<typeof createApiApp>) {
  return (request: Request, server?: RequestTimeoutServer) =>
    app.fetch(request, { server });
}

function isAwsOnlyRoute(path: string): boolean {
  return /^\/api\/(?:eks|ec2|secretsmanager)(?:\/|$)/.test(path);
}

function isSensitiveCredentialRoute(path: string): boolean {
  return (
    path.startsWith("/api/secretsmanager") ||
    /^\/api\/clouds\/[^/]+\/services\/kms\/resources\/[^/]+\/(?:encrypt|decrypt|sign|verify|rotate|cancel-deletion)$/.test(path) ||
    isKeyMutationRoute(path)
  );
}

function isKeyMutationRoute(path: string): boolean {
  return (
    /^\/api\/clouds\/[^/]+\/services\/kms\/resources\/[^/]+\/(?:rotate|cancel-deletion|recover|purge-deleted)$/.test(path) ||
    /^\/api\/clouds\/[^/]+\/services\/(?:secrets|certificates)\/resources\/[^/]+\/(?:recover|purge-deleted)$/.test(path)
  );
}
