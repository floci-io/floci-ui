# Team AI Directives Extension

Bundled governance extension for team-ai-directives.

This extension provides slash commands and agent skills for discovering, curating, evolving, repairing, verifying, and installing team AI directives. Governance commands and skills live here in the spec-kit extension; domain-specific skills remain in the external `agentic-sdlc-team-ai-directives` knowledge base.

## Commands

| Command | Alias | Purpose |
|---|---|---|
| `adlc.team-ai-directives.discover` | `team.discover` | Discover relevant team context for a feature |
| `adlc.team-ai-directives.curate` | `team.curate` | Scan traces and propose CDRs |
| `adlc.team-ai-directives.evolve` | `team.evolve` | Apply regression-gated CDRs |
| `adlc.team-ai-directives.repair` | `team.repair` | Re-index CDR.md, .skills.json, and AGENTS.md |
| `adlc.team-ai-directives.skills` | `team.skills` | Browse and install team skills |
| `adlc.team-ai-directives.verify` | `team.verify` | Health check the installation |

## Skills

The extension also ships static skills that are copied into the agent's skills directory during `specify init --team-ai-directives`:

- `team-discover`
- `team-curate`
- `team-evolve`
- `team-repair`
- `team-skills`
- `team-verify`

## Constitution

Constitution propagation is handled exclusively by the optional `agent-context` extension. This extension does not provide a `team.constitution` command or skill.
