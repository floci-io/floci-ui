# Changelog

## 4.3.1 - 2026-07-15

- Version bump; no functional changes from `4.3.0`.

## 4.3.0 - 2026-07-15

- **Add `team.boot` command**: New bootstrap command (`adlc.team-ai-directives.boot`, alias `team.boot`) with `model-invocation: true` frontmatter. The CLI auto-generates a `team-boot` skill from this command during install, so it appears in the agent's available skills list and can be self-triggered by the model on any interaction — not just spec workflow commands.
- **Anti-pattern table**: The boot command includes an anti-pattern table (adapted from the superpowers framework) that explicitly counters every rationalization the model might use to skip the skill check (e.g., "Let me explore the codebase first" → "Skills tell you HOW to explore. Check first."). This addresses the observed failure where agents skipped team-discover on plain user messages because the AGENTS.md directive was ambient context overridden by procedural command outlines.
- **Handoff to team.discover**: `team.boot` hands off to `team.discover` for the actual CDR/personas/rules scanning.
- **Strengthened AGENTS.md injection**: The `update-agent-context.sh/.ps1/.py` scripts now inject anti-pattern counter-rationalizations inline alongside the "Strict Compliance" directive, and tell the model to invoke the `team-boot` skill before responding.

## 4.2.0 - 2026-07-15

- **Register discovery hooks**: Add `hooks:` block to `extension.yml` declaring `before_specify` and `before_plan` hooks (both mandatory, `optional: false`) pointing at `adlc.team-ai-directives.discover`. This makes `register_hooks(manifest)` populate `extensions.yml` during install/update, so the spec workflow's pre-execution hook checks auto-invoke team-discover before `/spec.specify` and `/spec.plan`. Previously the `team.discover.md` command file documented these hooks but the manifest never declared them — a documentation/reality gap that left team context (personas, rules, examples, skills) undiscovered.
- **Migration**: Existing workspaces should run `specify extension update team-ai-directives` to write the new hooks to `.specify/extensions.yml`.

## 4.0.0 - 2026-07-09

- Repackage team-ai-directives as a bundled spec-kit extension with governance commands and skills.
- Move governance skills (`team-discover`, `team-curate`, `team-evolve`, `team-repair`, `team-skills`, `team-verify`) from the upstream KB repo into this extension.
- Remove `team.constitution` command; constitution handling is now owned by the `agent-context` extension bootstrap.
- Add handoff links between `team.discover`, `team.curate`, and `team.evolve`.
- Modernize command aliases to `team.<verb>` form.
