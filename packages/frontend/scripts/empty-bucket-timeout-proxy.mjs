// Test fixture for packages/api/src/routes/emptyBucket.integration.test.ts.
// Starts the frontend's Vite dev server on a free loopback port so a request can
// go through its /api proxy to the API named by API_TARGET. Prints one JSON line,
// {"port": <bound port>}, once the server is listening, and closes on SIGTERM.
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 0, strictPort: true },
});
await server.listen();

const address = server.httpServer?.address();
if (!address || typeof address === "string") {
  await server.close();
  throw new Error("Vite did not report a bound TCP port");
}
process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);

process.on("SIGTERM", () => {
  server.close().finally(() => process.exit(0));
});
