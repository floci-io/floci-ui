---
description: Browse and install team skills from team-ai-directives knowledge base
model-invocation: true
scripts:
  sh: .specify/extensions/team-ai-directives/scripts/bash/setup-team.sh --json
  ps: .specify/extensions/team-ai-directives/scripts/powershell/setup-team.ps1 -Json
---


<!-- Extension: team-ai-directives -->
<!-- Config: .specify/extensions/team-ai-directives/ -->
## User Input

```text
$ARGUMENTS
```

## Goal

Browse available skills from the team-ai-directives knowledge base and install selected ones to the current agent's skills directory.

## Setup

Read the file `.specify/init-options.json` directly. Do NOT use glob, find,
or any file-search tool to locate it — search tools may silently skip
dotfile-prefixed path segments. Read the file at the exact relative path
`.specify/init-options.json` from the current working directory.

If that read fails (file not found), walk up parent directories by reading
`../.specify/init-options.json`, then `../../.specify/init-options.json`,
and so on — up to 4 levels. Stop at the first successful read.

From the JSON, extract the `team_ai_directives` field:

```json
{
  "team_ai_directives": "/path/to/team-ai-directives"
}
```

If `team_ai_directives` is not set, STOP:
```
Team AI directives not configured.
Run: specify init --team-ai-directives <path-or-url>
```

## Execution

### Step 1: Read Skills Manifest

Read `<project_root>/.skills.json` (project-root manifest) and `{TEAM_AI_DIRECTIVES}/.skills.json` (team-ai-directives manifest). Merge both, with project-root entries taking precedence. Parse the `skills` section. Group by category:

| Category | Description | Auto-installed? |
|----------|-------------|-----------------|
| `required` | Must be installed | Yes (during init) |
| `recommended` | Suggested for the team | No |
| `internal` | Team-specific local skills | No |
| `blocked` | Rejected on install | N/A |

### Step 2: Show Available Skills

Present skills grouped by category. For each skill show:
- Name (the key, e.g. `local:./skills/github-actions`)
- Description
- Categories/tags
- Whether it's already installed (check agent skills directory)

Format:

```
Team Skills from {TEAM_AI_DIRECTIVES}

Required (auto-installed):
  [installed] team-dbt-template - DBT project templates and best practices

Recommended:
  [available] github-actions - GitHub Actions CI/CD pipeline patterns
  [available] helm-charts - Helm chart patterns for Kubernetes
  [available] crossplane - Crossplane Composition and XRD patterns
  [available] external-secrets - External Secrets Operator patterns
  [available] gke-workload-identity - GKE Workload Identity patterns

  Remote:
  [available] react-best-practices (vercel-labs) - React performance optimization
  [available] web-design-guidelines (vercel-labs) - Web interface best practices

Internal:
  [installed] team-dbt-template - DBT project templates
  [available] github-actions - GitHub Actions patterns
```

### Step 3: Install Selected Skills

If the user provided a skill name as input, install that skill directly.

If no input provided, ask the user which skills to install.

For **local skills** (`local:./skills/{name}`):
1. Locate `{TEAM_AI_DIRECTIVES}/skills/{name}/SKILL.md`
2. Determine the agent's skills directory:
   - Read `.specify/integration.json` to get the current agent
   - Use `{agent_folder}/skills/` as the destination
3. Copy `SKILL.md` to `{skills_dir}/team-{name}/SKILL.md`
4. Update the `name` field in SKILL.md frontmatter to `team-{name}`

For **remote skills** (GitHub URLs):
1. Download SKILL.md from the `url` field in `.skills.json`
2. Save to `{skills_dir}/{name}/SKILL.md`

### Step 4: Confirm

```
Installed: team-github-actions
Location: .opencode/skills/team-github-actions/SKILL.md
Source: local:./skills/github-actions
```

## Notes

- Required skills are installed automatically during `specify init --team-ai-directives`
- This command is for installing recommended/internal/remote skills on demand
- Skills are prefixed with `team-` to distinguish from other skills
- Blocked skills from `.skills.json` are never installed