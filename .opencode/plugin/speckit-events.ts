import { Plugin } from "@opencode/plugin";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// The dispatcher + interpreter are resolved per-project at plugin load from
// the `directory` OpenCode passes to the plugin factory (C8), not
// process.cwd() — OpenCode may be launched from a parent directory or host
// another workspace, in which case process.cwd() points at the wrong project.
//
// V2 port: the factory below receives `ctx`, and its per-project directory is
// `ctx.location.directory` (V1 `directory` argument).
let DISPATCHER = '';
let INTERPRETER = '';

function canImportSpecifyCli(py: string): boolean {
  // R2: a project-local venv commonly lacks Spec Kit (installed globally or
  // via uv tool). Probe the interpreter can import specify_cli before
  // selecting it, so an unrelated venv doesn't shadow the PATH fallback.
  try {
    execFileSync(py, ['-c', 'import specify_cli'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 10000,
    });
    return true;
  } catch (e) {
    return false;
  }
}

function resolveDispatcher(directory: string): void {
  DISPATCHER = path.join(directory, '.specify', 'events.py');
  // Prefer a project-local venv interpreter that can import specify_cli (R2),
  // then fall back to a platform-appropriate PATH interpreter (S2: python on
  // Windows, where python3 is commonly absent; python3 on POSIX).
  const venvPy = path.join(directory, '.venv', 'bin', 'python');
  const venvWin = path.join(directory, '.venv', 'Scripts', 'python.exe');
  INTERPRETER = (
    (fs.existsSync(venvPy) && canImportSpecifyCli(venvPy) && venvPy) ||
    (fs.existsSync(venvWin) && canImportSpecifyCli(venvWin) && venvWin) ||
    (process.platform === 'win32' ? 'python' : 'python3')
  ) as string;
}

function runEvent(command: string, event: string, input: any, output: any, timeoutSec: number): string {
  if (!DISPATCHER) return '';
  try {
    // execFileSync with an argv array invokes the interpreter directly — no
    // shell — so command/event strings with metacharacters can't break out
    // of the dispatcher argument (C9). The dispatcher arg is seconds; the
    // execFileSync timeout is ms with a buffer so the outer cap fires after
    // the dispatcher's inner subprocess (S3). stdout is captured and
    // returned so context-injection hooks (V2 ctx.session.hook("context"))
    // can push it into their outputs; stderr stays inherited so dispatcher
    // errors remain visible (C11).
    return execFileSync(INTERPRETER, [DISPATCHER, command, event, String(timeoutSec)], {
      input: JSON.stringify({ input, output }),
      stdio: ['pipe', 'pipe', 'inherit'],
      encoding: 'utf-8',
      timeout: (timeoutSec + 5) * 1000,
    });
  } catch (e) {
    // Propagate to OpenCode's hook machinery so only this hook is rejected,
    // not the entire host process. process.exit() would kill the agent.
    throw new Error(`specify event ${command} (${event}) failed: ${(e as Error).message}`);
  }
}

// Cache session_start handler output per sessionID so non-idempotent
// handlers (setup, telemetry, file-mutating scripts) run once per session
// instead of on every LLM request (the V2 `context` hook fires per model
// request). Evicted on session.deleted.
const sessionStartCache = new Map<string, string>();

function _session_start(input: any, output: any): string {
    const errors: string[] = [];
    const contexts: string[] = [];
    try { const ctx = runEvent("speckit.agent-context.update", "session_start", input, output, 60); if (ctx) contexts.push(ctx); } catch (e) { errors.push((e as Error).message); }
    if (errors.length > 0) { throw new Error(errors.join('; ')); }
    return contexts.join("\n\n");
  }

export default Plugin.define({
  id: "speckit-events",
  async setup(ctx) {
    resolveDispatcher(ctx.location.directory);

    // V1 `experimental.chat.system.transform` -> V2 `ctx.session.hook("context")`.
    // The callback receives one mutable event; push the captured dispatcher
    // stdout as a text system part.
    await ctx.session.hook("context", async (event) => {
      if (!event.sessionID) return;
      let contexts = sessionStartCache.get(event.sessionID);
      if (contexts === undefined) {
        // The dispatcher payload keeps the V1 `{ input, output }` envelope so
        // `.specify/events.py` and its command handlers are unchanged.
        const input = { sessionID: event.sessionID, agent: event.agent, model: event.model };
        const output = { system: event.system, messages: event.messages };
        contexts = _session_start(input, output);
        sessionStartCache.set(event.sessionID, contexts ?? "");
      }
      if (contexts) event.system.push({ type: "text", text: contexts });
    });

    // Evict a session's cached context when that session is deleted, so the
    // cache doesn't retain entries for the lifetime of the long-running server.
    // The global event stream outlives any single session, so pump it in the
    // background; the cleanup returned below aborts the pump on plugin dispose.
    const events = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: events.signal })) {
          if (event.type === "session.deleted") {
            sessionStartCache.delete(event.data.sessionID);
          }
        }
      } catch {
        // Aborted on dispose, or the event transport closed; the pump is done.
      }
    })();

    return () => events.abort();
  },
});
