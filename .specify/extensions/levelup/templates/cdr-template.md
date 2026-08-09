# Context Directive Records

Context Directive Records (CDRs) track decisions about contributing context modules (rules, personas, examples, skills) to team-ai-directives. Similar to Architecture Decision Records (ADRs), CDRs provide a formal record of what, why, and how context is being contributed.

## CDR Index

| ID | Target Module | Context Type | Cross-System | Priority | Status | Date | Source |
|----|---------------|--------------|--------------|----------|--------|------|--------|
| CDR-001 | [target path] | [type] | ✓ | [Critical/Standard/Preference] | Proposed | YYYY-MM-DD | [source] |
| CDR-002 | [target path] | [type] | | [Critical/Standard/Preference] | Proposed | YYYY-MM-DD | [source] |
| CDR-INC-001 | (Inconsistency) | Inconsistency | ✓ | High | Proposed | YYYY-MM-DD | Multi-agent synthesis |

---

## CDR-001: [Decision Title]

### Status

**Discovered** | Proposed | Accepted | Rejected | Implemented

### Date

YYYY-MM-DD

### Source

[How this CDR was discovered: codebase scan, feature spec, manual identification]

### Cross-System Metadata
> Populated automatically when pattern is detected across multiple sub-systems during multi-agent analysis

- **Appears in**: [List of sub-system IDs where pattern was found - e.g., auth, payments, users]
- **Cross-system score**: [0.0-1.0 - percentage of sub-systems with this pattern]
- **Consistency**: [Consistent | Inconsistent | Partial | N/A (single sub-system)]
  - **Consistent**: Same implementation across all sub-systems
  - **Inconsistent**: Different implementations for same concern
  - **Partial**: Some sub-systems have pattern, others don't
- **Reuse score**: [0.0-1.0 calculated by Pattern Agent]
- **Team-directives match**: [None | Partial | Exact]
  - **Similar patterns**: [List of similar existing TD patterns with similarity scores]

### Cross-System Analysis

Analysis of pattern across sub-systems:

| Sub-System | Implementation | Confidence | Evidence | Notes |
|------------|----------------|------------|----------|-------|
| auth | [Pattern details or "Not implemented"] | High/Medium/Low | [File:line refs] | [Any notes] |
| payments | [Pattern details or "Not implemented"] | High/Medium/Low | [File:line refs] | [Any notes] |
| users | [Pattern details or "Not implemented"] | High/Medium/Low | [File:line refs] | [Any notes] |

**Cross-system findings**:
- **Sub-systems with pattern**: [N] of [Total]
- **Implementations consistent**: [Yes/No]
- **Variance noted**: [Description of differences if inconsistent]

### Team-Directives Comparison

Comparison against existing team-ai-directives content:

- **Exact match**: [Yes/No - is this already in TD?]
- **Similar existing patterns**: 
  - `[rules/framework/python_error_handling.md]` - Similarity: 0.65 - [Brief description of similarity/difference]
- **Gap identified**: [Yes/No - should this be added to TD?]
- **Potential conflict**: [Any existing rules that might conflict]
- **Enhancement opportunity**: [Could enhance existing TD pattern]

### Target Module

**Use functional categories (NOT technology folders):**

- **Rules**: `context_modules/rules/{category}/{technology}_{pattern}.md`
  - Categories: `style-guides/`, `framework/`, `security/`, `testing/`, `devops/`, `data/`
  - Examples: `rules/style-guides/python_pydantic_patterns.md`, `rules/security/typescript_auth_middleware.md`

- **Personas**: `context_modules/personas/{file}.md`

- **Examples**: `context_modules/examples/{technology}/{file}.md` (technology-based)
  - Examples: `examples/python/typed_api_client.md`, `examples/typescript/react_hooks.md`

- **Skills**: `skills/{skill-name}/`

### Context Type

Rule | Persona | Example | Constitution Creation | Constitution Amendment | Skill | Inconsistency

> **Constitution Creation**: Used when no team constitution exists. Derives principles from cross-cutting patterns discovered in codebase.
>
> **Constitution Amendment**: Used when enhancing existing constitution with new principles derived from codebase patterns.
>
> **Inconsistency**: Used when the same pattern/concern has different implementations across sub-systems. Requires team decision to standardize.

### Skill Type

**Required if Context Type = Skill** (based on Anthropic's Skill Types Taxonomy from "Lessons from Building Claude Code: How We Use Skills")

| Type | Purpose | Example Triggers |
|------|---------|------------------|
| **Library & API Reference** | Documentation and API usage guidance | "how do I use X library", "API for Y service" |
| **Product Verification** | Testing and validation of product behavior | "verify product", "check behavior", "validate output" |
| **Data Fetching & Analysis** | Data retrieval and processing | "fetch data", "analyze logs", "query database" |
| **Business Process Automation** | Workflow and business process automation | "automate process", "workflow", "orchestrate" |
| **Code Scaffolding & Templates** | Project and code generation | "create project", "scaffold", "generate boilerplate" |
| **Code Quality & Review** | Code review and quality improvement | "review code", "quality check", "refactor" |
| **CI/CD & Deployment** | Build, test, and deployment pipelines | "deploy", "CI/CD pipeline", "build artifact" |
| **Runbooks** | Operational procedures and troubleshooting | "troubleshoot", "runbook", "incident response" |
| **Infrastructure Operations** | Infrastructure as Code and provisioning | "provision", "infrastructure", "terraform", "kubernetes" |

### Instruction Type

**Required if Context Type = Skill** (based on "Encoding Team Standards" article)

| Instruction Type | Purpose | Example Trigger Phrases |
|------------------|---------|-------------------------|
| **Generation** | How team generates new code | "create a new service", "implement feature", "write a function" |
| **Review** | How team reviews code | "review this PR", "check quality", "audit code" |
| **Refactor** | How team improves existing code | "clean up", "simplify", "optimize", "refactor" |
| **Security** | How team checks for vulnerabilities | "check security", "audit", "vulnerability" |
| **General Capability** | Self-contained capability | Any other reusable skill |

### Priority Structure

**Optional - for executable standards** (follows "Encoding Team Standards" article)

| Priority | Meaning | Action |
|----------|---------|--------|
| **Critical** | Must follow | Block merge if violated |
| **Standard** | Should follow | Require in code review |
| **Preference** | Nice to have | Suggest but don't require |

When applying to skills, prioritize:

1. **Critical**: Non-negotiable patterns, security requirements, architectural constraints
2. **Standard**: Conventions most commonly corrected in review
3. **Preference**: Style variations, minor optimizations

### Categorized Standards

> **Note:** Required if Instruction Type = Generation/Review/Refactor/Security

Following the "Encoding Team Standards" article's approach:

```markdown
### Critical (Must Follow)
- {Non-negotiable pattern 1}
- {Security requirement}

### Standard (Should Follow)
- {Convention 1}
- {Convention 2}

### Preference (Nice to Have)
- {Style preference 1}
- {Optimization suggestion}
```

### Context

Describe the problem being solved or the pattern being captured. Why does this context module need to exist?

**Discovery Evidence:**

- [Code path, pattern, or feature that revealed this need]
- [Specific examples from the codebase]

**Problem Statement:**

[Clear description of what gap this fills in team-ai-directives]

**Forces:**

- [Force 1 - technical, business, or team factor]
- [Force 2 - competing concern or constraint]
- [Force 3 - quality attribute requirement]

### Decision

State what context module will be added or modified. Use active voice: "We will add..." or "The team-ai-directives will include..."

**Decision:**

[Clear statement of what will be contributed]

**Proposed Content:**

```markdown
[The actual content to add to team-ai-directives]
[This is what will be placed in the target module]
```

**Rationale:**

[Why this content was chosen, how it benefits other projects]

### Evidence

Links to code, commits, or discussions that support this CDR:

- [Link to code file demonstrating the pattern]
- [Link to commit where pattern was established]
- [Link to discussion or issue that motivated this]

### Constitution Alignment

| Principle | Alignment | Notes |
|-----------|-----------|-------|
| [Principle from team constitution] | Compliant / Deviation / Enhancement | [Explanation] |

**Constitution References:**

- [Link to relevant constitutional principles in team-ai-directives]

### Consequences

#### Positive

- [Benefit 1 - how other projects will benefit]
- [Benefit 2 - consistency improvement]

#### Negative

- [Trade-off 1 - potential maintenance burden]
- [Trade-off 2 - learning curve]

#### Risks

- [Risk 1 with mitigation strategy]
- [Risk 2 with monitoring approach]

### Related CDRs

- [CDR-XXX: Related decision]
- [ADR-XXX: Related architecture decision (if applicable)]

### Inconsistency Resolution
> **Only for CDRs with Context Type = "Inconsistency"**

Track resolution of cross-sub-system inconsistencies:

#### Inconsistency Details
- **Type**: [Implementation divergence | Naming conflict | Scope gap]
- **Severity**: [High | Medium | Low]
- **Sub-systems involved**: [List of sub-system IDs]
- **Concern**: [What is inconsistent - e.g., "Authentication approach"]

#### Conflicting Implementations
| Sub-System | Implementation | Evidence | Rationale (if known) |
|------------|----------------|----------|---------------------|
| auth | JWT tokens | src/auth/jwt.py | Historical choice |
| payments | OAuth2 with PKCE | src/payments/oauth.py | Security requirement |

#### Options Considered
1. **Option A**: [Description]
   - **Pros**: [Benefits]
   - **Cons**: [Drawbacks]
2. **Option B**: [Description]
   - **Pros**: [Benefits]
   - **Cons**: [Drawbacks]

#### Resolution
- **Decision**: [Which option was chosen]
- **Rationale**: [Why this option]
- **Resolved by**: [@username or "Pending"]
- **Resolution date**: [YYYY-MM-DD or "Pending"]
- **Status**: [Unresolved | Resolved | Won't Fix]

#### Implementation Plan
- [ ] Update sub-system A to use chosen approach
- [ ] Update sub-system B to use chosen approach
- [ ] Create/update context module in team-directives
- [ ] Mark this CDR as Resolved

### Constitution Strategy
> **Only for CDRs with Context Type = "Constitution Creation" or "Constitution Amendment"**

Track constitution generation/enhancement strategy:

#### Constitution Status
- **Current constitution**: [Exists | Missing]
- **Action**: [Create new | Append section | Enhance existing]
- **Derived principles count**: [N principles derived from patterns]

#### Derived Principles
| Principle Name | Source | Evidence | Action |
|----------------|--------|----------|--------|
| [Principle 1] | Cross-cutting pattern | [file paths] | [New/Enhances existing/Skipped] |
| [Principle 2] | Inconsistency resolution | [INC-XXX] | [New] |

#### Principle Derivation
- **Cross-cutting patterns analyzed**: [N patterns across M sub-systems]
- **Inconsistencies resolved**: [N inconsistencies that became principles]
- **High-value patterns**: [Patterns with reuse_score > 0.7]
- **Existing principles preserved**: [N principles unchanged]

#### Version Strategy
- **Current version**: [X.Y.Z or "None" for new constitution]
- **Version bump**: [MAJOR/MINOR/PATCH]
- **Rationale**: [Why this version bump type]

#### Ratification Plan
- [ ] Team review of derived principles
- [ ] Approval of each principle
- [ ] Version ratification
- [ ] Update governance dates

### Implementation Notes

**Target Repository:** team-ai-directives

**Branch:** `levelup/{project-slug}`

**PR Status:** [Not created | Draft | Ready | Merged]

---

## CDR Status Reference

| Status | Description |
|--------|-------------|
| **Discovered** | Inferred from existing codebase during brownfield analysis |
| **Proposed** | Suggested for review, awaiting team validation |
| **Accepted** | Approved for implementation in team-ai-directives |
| **Rejected** | Not accepted (reason documented in CDR) |
| **Implemented** | PR created/merged to team-ai-directives |

## CDR Best Practices

1. **One contribution per CDR** - Keep CDRs focused on a single context module
2. **Include concrete examples** - Show actual code/content, not abstract descriptions
3. **Link to evidence** - Always reference the code/commits that motivated the CDR
4. **Consider reusability** - Ask "Would this help other projects?"
5. **Align with constitution** - Verify the contribution aligns with team principles
6. **Document trade-offs** - Be honest about maintenance burden and learning curve

## Context Type Guidelines

### Rules

- Coding patterns, error handling approaches, testing strategies
- Should be actionable and verifiable
- Include both the rule and examples of compliance

### Personas

- Role-specific guidance for AI agents
- Define expertise areas, communication style, decision-making approach
- Include example prompts and responses

### Examples

- Code snippets, prompt patterns, test cases
- Must be working, tested examples
- Include context for when to use

### Constitution Creation

- Used when team-ai-directives has no constitution
- Derives principles from cross-cutting patterns discovered in codebase
- Principles MUST be based on evidence from multiple sub-systems
- Include both the principle and the codebase evidence that supports it
- Start with template from `.specify/templates/constitution-template.md`

**Required sections:**
- Core Principles (derived from patterns)
- Governance (ratification process)
- Version tracking

### Constitution Amendment

- Used to enhance existing constitution with new principles
- Based on newly discovered patterns or resolved inconsistencies
- Should be fundamental principles, not specific rules
- Require broader team consensus
- Preserve existing content, append new section

**Amendment types:**
- **New principle**: Add as new section
- **Enhancement**: Extend existing principle description
- **Reinforcement**: Add evidence to existing principle (no content change)

### Skills

- Self-contained capabilities with trigger keywords
- Include SKILL.md with clear activation criteria
- Provide references and supporting content
- **Skill Type**: Classify using 9-category taxonomy (see Skill Type section above)

---

*Template Version: 1.0*
*Compatible with team-ai-directives structure*
