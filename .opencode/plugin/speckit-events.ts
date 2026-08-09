import { execFileSync } from 'child_process';
import * as path from 'path';

// The dispatcher + interpreter are resolved per-project at plugin load from
// the `directory` OpenCode passes to the plugin factory (C8), not
// process.cwd() — OpenCode may be launched from a parent directory or host
// another workspace, in which case process.cwd() points at the wrong project.
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
    (require('fs').existsSync(venvPy) && canImportSpecifyCli(venvPy) && venvPy) ||
    (require('fs').existsSync(venvWin) && canImportSpecifyCli(venvWin) && venvWin) ||
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
    // returned so context-injection hooks (experimental.chat.system.transform,
    // chat.message) can push it into their outputs; stderr stays inherited so
    // dispatcher errors remain visible (C11).
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
// instead of on every LLM request (experimental.chat.system.transform
// fires per LLM turn). Evicted on session.deleted.
const sessionStartCache = new Map<string, string>();

function _session_start(input: any, output: any): string {
    const errors: string[] = [];
    const contexts: string[] = [];
    try { const ctx = runEvent("speckit.agent-context.update", "session_start", input, output, 60); if (ctx) contexts.push(ctx); } catch (e) { errors.push((e as Error).message); }
    if (errors.length > 0) { throw new Error(errors.join('; ')); }
    return contexts.join("\n\n");
  }

export default (async ({ client, project, directory, $ }) => {
  resolveDispatcher(directory);
  return {
    "experimental.chat.system.transform": async (input: any, output: any) => {
      if (!input.sessionID) return;
      let ctx = sessionStartCache.get(input.sessionID);
      if (ctx === undefined) {
        ctx = _session_start(input, output);
        sessionStartCache.set(input.sessionID, ctx ?? "");
      }
      if (ctx) output.system.push(ctx);
    },
  };
});
