---
description: Bootstrap session with team-ai-directives context — invoke before any task or question
model-invocation: true
---


<!-- Extension: team-ai-directives -->
<!-- Config: .specify/extensions/team-ai-directives/ -->
## Goal

Bootstrap the session with team-ai-directives context before responding to any
user task or question. This command loads the team constitution and runs
discovery to surface relevant rules, personas, and examples.

<EXTREMELY_IMPORTANT>
You MUST invoke this skill BEFORE responding to any user task or question.
This is not optional and applies to EVERY interaction — not just spec workflow
commands. If you think this does not apply to your current task, read the
anti-pattern table below before deciding to skip it.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
This is not negotiable. You cannot rationalize your way out of this.
</EXTREMELY_IMPORTANT>

## Anti-Pattern Table

Do NOT rationalize skipping the skill check. Every thought below is wrong:

| Thought (rationalization) | Reality (counter) |
|---|---|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |
| "This is a plain message, not a /spec command" | Skill check applies to EVERY interaction, not just commands. |
| "The spec command hooks handle discovery" | Hooks only fire for spec commands. Plain messages need skill check too. |
| "I'll check after understanding the request" | Check BEFORE understanding — skills may tell you what questions to ask. |

## Bootstrap Process

### Step 1: Locate Knowledge Base

Read the file `.specify/init-options.json` directly. Do NOT use glob, find,
or any file-search tool to locate it — search tools may silently skip
dotfile-prefixed path segments. Read the file at the exact relative path
`.specify/init-options.json` from the current working directory.

If that read fails (file not found), walk up parent directories by reading
`../.specify/init-options.json`, then `../../.specify/init-options.json`,
and so on — up to 4 levels. Stop at the first successful read.

From the JSON, extract the `team_ai_directives` field.

- If present and the path exists: use it as the knowledge base root.
- If not found or path doesn't exist: output empty results and exit.

In subsequent steps, `{TEAM_AI_DIRECTIVES}` refers to this value, resolved
as a path relative to the current working directory. Read files at this
path directly — do NOT use glob, find, or any file-search tool to locate
them.

### Step 2: Load Team Constitution

Using the `team_ai_directives` value from Step 1, read
`{TEAM_AI_DIRECTIVES}/context_modules/constitution.md` directly. Construct
the path from the value resolved in Step 1 and read the file — do NOT use
glob, find, or any file-search tool to locate it.

Read the constitution in full.

The team constitution is the foundational principles document. It governs
agent behavior and team interactions. Internalize its principles before
proceeding — they apply to every task you will work on in this session.

### Step 3: Run Discovery

Invoke the `team-discover` skill (or `/team.discover` command) to scan the CDR
index and match personas, rules, examples, and skills against the current
task context.

If the user's message describes a specific feature or task, extract:
- **Domain**: What business area is this?
- **Technology**: What tech stack?
- **Patterns**: What architectural patterns?
- **Actions**: What is the feature doing?

Use these to drive the discovery matching. If the user's message is vague
("I need to add a login modal"), still run discovery — the team knowledge base
may contain relevant rules (e.g., security patterns, testing standards) that
apply broadly.

### Step 4: Acknowledge Context

After loading the constitution and running discovery, briefly acknowledge what
team context was loaded before proceeding to respond to the user's request.
This confirms the bootstrap completed and makes the skill check visible.

## When to Invoke

Invoke this skill:

- At the start of any new session or conversation
- Before responding to any user task or question
- Before any spec workflow command (/spec.constitution, /spec.specify,
  /spec.plan, /spec.implement, etc.)
- Before making code changes
- Before answering questions about the project

You do NOT need to re-invoke if:
- You already ran `/team.boot` in the current session AND
- The user's follow-up is a direct continuation of the same task

## Failure Handling

If team-ai-directives is not configured or files cannot be read:
1. Skip silently — do not block the user's request
2. Proceed with the task using only AGENTS.md and project-level context
3. Exit successfully (the bootstrap is best-effort)
