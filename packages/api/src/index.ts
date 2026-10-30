import "dotenv/config";
import { createApiApp, createBunFetch } from "./app";
import { loadEmulatorManifest } from "./service/emulatorManifest";

// Console Contract v2: the emulator's defaults, when it publishes a manifest.
// Capped by the fetch timeout, and retried in the background if it is not up yet.
await loadEmulatorManifest();

const port = Number(process.env.PORT ?? 4501);
export default { port, fetch: createBunFetch(createApiApp()) };
