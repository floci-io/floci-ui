---
description: Verify team-ai-directives installation and health check
---


<!-- Extension: team-ai-directives -->
<!-- Config: .specify/extensions/team-ai-directives/ -->
## Goal

Verify that team-ai-directives is properly installed and healthy.

## Verification Checks

### Check 1: Extension Installed

1. Check `.specify/extensions/.registry` for `team-ai-directives` entry
2. Verify `.specify/extensions/team-ai-directives/extension.yml` exists
3. Extract version from extension.yml

Output: `[OK]` or `[FAIL]` with reason

### Check 2: Knowledge Base Configured

1. Read `.specify/init-options.json`
2. Verify `team_ai_directives` field exists and points to valid path
3. Check the knowledge base path exists

Output: `[OK]` or `[FAIL]` with reason

### Check 3: Context Modules exist

1. Read `.specify/init-options.json` → get knowledge base path
2. Verify:
   - `{TEAM_AI_DIRECTIVES}/context_modules/constitution.md`
   - `{TEAM_AI_DIRECTIVES}/context_modules/personas/`
   - `{TEAM_AI_DIRECTIVES}/context_modules/rules/`
   - `{TEAM_AI_DIRECTIVES}/context_modules/examples/`

Output: `[OK]` or `[FAIL]` with reason

### Check 4: Skills registry

- `{TEAM_AI_DIRECTIVES}/.skills.json` exists and is valid JSON

Output: `[OK]` or `[FAIL]` with reason

### Check 5: CDR tracking

- `{TEAM_AI_DIRECTIVES}/CDR.md` exists

Output: `[OK]` or `[FAIL]` with reason

### Check 6: Constitution Alignment

1. Read team constitution from `{TEAM_AI_DIRECTIVES}/context_modules/constitution.md`
2. Locate project constitution: `{REPO_ROOT}/.specify/memory/constitution.md`
3. If project constitution exists:
   - Check if it references team-ai-directives (e.g., "Based on team-ai-directives", "Inherits from")
   - Check if team principles are present in project constitution (compare principle titles)
   - Output:
     - `[OK]` - Project constitution exists and inherits team principles
     - `[WARN]` - Project constitution exists but missing team inheritance
4. If project constitution doesn't exist:
   - `[INFO]` - Project constitution doesn't exist yet (first-time setup)

### Check 7: OKF Type Field Presence

1. Scan all `.md` files in `context_modules/` (excluding `index.md`, `log.md`)
2. Parse YAML frontmatter from each file
3. Verify `type` field is present and has a valid value:
   - Valid types: `Constitution`, `Persona`, `Rule`, `Example`, `Skill`
4. Output:
   - `[OK]` - All concept files have valid `type` fields
   - `[WARN]` - Some files missing `type` field (list files)

## Output

Print verification status for each check:
- `[OK]` - Check passed
- `[FAIL]` - Check failed with reason
- `[WARN]` - Check passed with warnings (non-blocking)
- `[INFO]` - Informational only

**Exit codes:**
- 0 - All checks passed (including warnings)
- 1 - One or more checks failed