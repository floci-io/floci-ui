# LevelUp Extension Quick Start

Discover and contribute context modules (rules, personas, examples, skills) to team-ai-directives using Context Directive Records (CDRs).

## Overview

The LevelUp extension helps brownfield projects analyze their codebase and contribute reusable patterns back to the team's shared AI directives:

- **CDRs (Context Directive Records)** - Track *what*, *why*, and *how* of context contributions
- **Skills** - Self-contained capabilities that AI agents can load
- **Team AI Directives** - Shared repository of team knowledge

## Quick Start

### Initial Brownfield Discovery - Run Once

> **Note**: Use `.init` only once for initial codebase scan. For ongoing feature work, use `.specify`.

```bash
# 1. Initial codebase scan for patterns (ONE-TIME setup)
/levelup.init

# 2. Review and accept/reject CDRs
/levelup.clarify

# 3. (Optional) Build skill
/levelup.skill python-error-handling

# 4. Create PR to team-ai-directives
/levelup.implement
```

### After Feature Implementation (Ongoing)

For capturing patterns after implementing a feature:

```bash
# 1. Extract CDRs from feature context
/levelup.specify "Describe the patterns from this feature"

# 2. Review and accept CDRs
/levelup.clarify

# 3. Build skill from accepted CDRs
/levelup.skill {pattern-name}

# 4. Create PR
/levelup.implement
```

### With Session Trace (Optional)

To document the AI session before extracting patterns:

```bash
# 1. Generate trace from feature implementation
/spec.trace

# 2. Extract CDRs enriched with trace context
/levelup.specify

# 3-5. Continue with clarify → skills → implement
```

## Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/levelup.init` | Initial codebase scan for CDRs | **One-time** brownfield setup |
| `/levelup.specify` | Extract CDRs from feature context | **Ongoing** - after feature implementation |
| `/levelup.clarify` | Resolve ambiguities in CDRs | After init/specify |
| `/levelup.skill` | Build one skill from CDRs | Create reusable skills |
| `/levelup.implement` | Compile CDRs into PR | Ready to contribute |
| `/spec.trace` | Generate session execution trace | Document AI session (optional) |
| `/levelup.validate` | Scan for rule conflicts | Check for inconsistencies |

## Key Files

| File | Location | Purpose |
|------|----------|---------|
| CDRs (local) | `.specify/drafts/cdr.md` | Working CDRs during discovery |
| CDRs (team) | `{TEAM_DIRECTIVES}/CDR.md` | Approved contributions |
| Skills | `.specify/drafts/skills/` | Draft skills |
| Traces | `specs/{BRANCH}/trace.md` | Session execution traces |

## CDR Format

```markdown
### CDR-001: Python Error Handling Pattern

#### Status
Accepted

#### Target Module
`context_modules/rules/python/error-handling.md`

#### Context Type
Rule

#### Discovery Date
2024-01-15

#### Context
Our codebase consistently uses custom exception hierarchies.

#### Content
```python
class ApplicationError(Exception):
    def __init__(self, message, context=None):
        super().__init__(message)
        self.context = context or {}
```

#### Rationale
- Consistent error handling across services
- Better observability with structured context

#### Files Referenced
- `src/auth/exceptions.py`
```

## CDR Status Values

| Status | Description |
|--------|-------------|
| **Discovered** | Inferred from codebase during brownfield analysis |
| **Proposed** | Suggested for review, awaiting validation |
| **Accepted** | Approved for implementation |
| **Rejected** | Not approved (reason documented in CDR) |

## levelup.skill Command

Build a **single skill** from accepted CDRs for your team to use.

### Usage

```bash
/levelup.skill <skill-identifier>
```

**Skill identifier can be:**
- **Skill name** (kebab-case): `python-error-handling`
- **CDR ID**: `CDR-005`
- **Topic phrase**: `testing patterns`

### Examples

```bash
/levelup.skill python-error-handling
/levelup.skill CDR-005
/levelup.skill "API authentication patterns"
```

### Instruction Types

Skills are classified by how they'll be used:

| Type | Purpose | Example Triggers |
|------|---------|------------------|
| **Generation** | Generate new code | "create service", "implement feature" |
| **Review** | Review code quality | "review this PR", "check quality" |
| **Refactor** | Improve existing code | "clean up", "simplify", "optimize" |
| **Security** | Check vulnerabilities | "check security", "audit" |
| **General Capability** | Self-contained capability | Other reusable skills |

### Four-Part Anatomy

For **Generation**, **Review**, **Refactor**, and **Security** skills, the command applies this structure:

**Part 1: Role Definition**
```markdown
Role: Senior engineer following team patterns for code generation
```

**Part 2: Context Requirements**
```markdown
## Context Requirements

- **Required**: Code context, project architecture, team conventions
- **Optional**: Additional constraints
```

**Part 3: Categorized Standards**
```markdown
## Categorized Standards

### Critical (Must Follow)
- Non-negotiable patterns, security requirements

### Standard (Should Follow)
- Conventions that are most commonly corrected

### Preference (Nice to Have)
- Style variations, minor optimizations
```

**Part 4: Output Format**
```markdown
## Output Format

- **Summary**: Brief overview of what was done
- **Categorized Findings**: Critical/Standard/Preference structure
- **Next Steps**: Action items
```

### Output Structure

```bash
.specify/drafts/skills/{skill-name}/
├── SKILL.md              # Main skill definition
├── .skills-entry.json    # Entry for team-ai-directives
└── references/           # Supporting content
    ├── examples/
    └── patterns/
```

### SKILL.md Example

```markdown
# Python Error Handling

Handle errors consistently using custom exception hierarchies.

**Instruction Type**: Generation

## Part 1: Role Definition

Role: Senior engineer following team patterns for error handling

## Part 2: Context Requirements

- **Required**: Code context, existing exception patterns
- **Optional**: Specific domain requirements

## Part 3: Categorized Standards

### Critical (Must Follow)
- Always inherit from ApplicationError base class
- Include structured context in all exceptions

### Standard (Should Follow)
- Create specific exception types for different errors
- Log exceptions with full context

### Preference (Nice to Have)
- Use typed context dictionaries
- Add error codes for tracking

## Part 4: Output Format

- **Summary**: Overview of error handling approach
- **Categorized Findings**: Critical/Standard/Preference
- **Next Steps**: Implementation tasks

## Source

Built from CDRs:
- CDR-001: Python Error Handling Pattern
```

### Important Notes

- **Only uses CDRs with status "Accepted"** - Run `/levelup.clarify` first
- **Builds ONE skill at a time** - User specifies which skill
- **Auto-detects instruction type** - Based on skill name and content
- **Creates .skills-entry.json** - Used by `/levelup.implement`
- **Can be edited before implementing** - Review and refine before PR

## Skill Types Taxonomy

Classify skills using these categories:

| Type | Purpose | Example Triggers |
|------|---------|------------------|
| **Library & API Reference** | Documentation and API guidance | "how do I use X library" |
| **Product Verification** | Testing and validation | "verify product behavior" |
| **Data Fetching & Analysis** | Data retrieval and processing | "fetch data", "analyze logs" |
| **Business Process Automation** | Workflow automation | "automate process" |
| **Code Scaffolding & Templates** | Project generation | "create project", "scaffold" |
| **Code Quality & Review** | Code review and quality | "review code", "refactor" |
| **CI/CD & Deployment** | Build and deploy pipelines | "deploy", "CI/CD pipeline" |
| **Runbooks** | Operational procedures | "troubleshoot", "incident response" |
| **Infrastructure Operations** | IaC and provisioning | "provision", "terraform" |

## Configuration

```yaml
# .specify/extensions/levelup/levelup-config.yml
cdr:
  heuristic: "surprising"  # surprising | all | minimal
  location: ".specify/drafts/cdr.md"

skills:
  drafts_location: ".specify/drafts/skills"

discovery:
  rules: true
  personas: true
  examples: true
  constitution: true
  skills: true

pull_request:
  draft: true
  branch_prefix: "levelup/"
  target_branch: "main"
```

## Team AI Directives Path Resolution

The extension resolves the team-ai-directives path in this order:

1. `SPECIFY_TEAM_DIRECTIVES` environment variable
2. `.specify/team-ai-directives` (submodule - recommended)

## Integration with Other Extensions

### Product Extension

After product development, capture product patterns:

```bash
/product.implement     # Generate PRD
/levelup.specify      # Extract patterns from product work
/levelup.skill prd-format
/levelup.implement
```

### Architect Extension

After architecture work, capture architectural patterns:

```bash
/architect.implement   # Generate AD.md
/levelup.specify      # Extract patterns from architecture work
/levelup.skill adr-format
/levelup.implement
```

### Spec Extension

After feature implementation, generate trace and extract patterns:

```bash
/spec.implement        # Implement feature
/spec.trace            # Document session
/levelup.specify       # Refine CDRs with feature context
/levelup.skill {pattern}
/levelup.implement
```

## Workflow Summary

### Initial Setup (Run Once)

```
/levelup.init → /levelup.clarify → /levelup.skill (optional) → /levelup.implement
```

### Ongoing Feature Work

```
/spec.trace (optional) → /levelup.specify → /levelup.clarify → /levelup.skill → /levelup.implement
```

**Next Steps:**
1. **Initial setup**: Run `/levelup.init` once to scan existing codebase
2. **After features**: Run `/levelup.specify` to extract patterns from feature context
3. Run `/levelup.clarify` to accept CDRs
4. Run `/levelup.skill <name>` to build a specific skill
5. Run `/levelup.implement` to create PR

For team-ai-directives format compatibility, ensure your contribution follows the established structure.
