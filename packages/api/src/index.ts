import "dotenv/config";
import { createApiApp, createBunFetch } from "./app";

const port = Number(process.env.PORT ?? 4501);
export default { port, fetch: createBunFetch(createApiApp()) };
