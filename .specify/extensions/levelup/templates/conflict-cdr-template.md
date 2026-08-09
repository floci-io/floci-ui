# Conflict CDR Template

This template is used for creating Context Directive Records to resolve rule conflicts detected by `/levelup.validate`.

## CDR-{ID}: Resolve Rule Conflict: {title}

### Status

**Discovered** | Proposed | Accepted | Rejected | Implemented

### Date

YYYY-MM-DD

### Source

Rule conflict detection via `/levelup.validate`

### Target Module

`context_modules/rules/{domain}/{file}.md`

### Context Type

Rule

### Conflict Details

| Field | Value |
|-------|-------|
| **Conflict ID** | {conflict-id} |
| **Level** | {critical|error|warning|info} |
| **Type** | {direct_contradiction|implicit_contradiction|exception_conflict|scope_overlap|constitution_conflict} |

#### Rule A

- **File**: {path/to/rule-a.md}
- **Statement**: "{rule statement}"

#### Rule B

- **File**: {path/to/rule-b.md}
- **Statement**: "{rule statement}"

#### Contradiction

{Description of how the rules conflict}

### Constitution Alignment

| Principle | Alignment | Notes |
|-----------|-----------|-------|
| {Principle from constitution} | Conflict / Compliant | {Explanation} |

### Remediation Options

1. **Add Exception**: Modify rule to document exception for specific cases
2. **Edit Rule**: Reword rule to avoid conflict
3. **Mark Intentional**: Document overlap as intentional with rationale
4. **Deprecate Rule**: Remove one of the conflicting rules

### Proposed Resolution

**Option Selected**: {1|2|3|4}

**Rationale**:

{Why this resolution was chosen}

**Changes Required**:

```markdown
{If editing a rule, show the proposed changes here}
```

### Evidence

- {Link to rule A}
- {Link to rule B}
- {Link to relevant discussions}

### Consequences

#### Positive

- {Benefit 1}
- {Benefit 2}

#### Negative

- {Trade-off 1}
- {Trade-off 2}

### Related CDRs

- {CDR-XXX: Related conflict}
- {CDR-YYY: Related rule}

---

## Conflict Levels Reference

| Level | Pattern | Example | Severity |
|-------|---------|---------|----------|
| 1: Direct Contradiction | `must X` vs `never X` | "Must cache" vs "Never cache" | CRITICAL |
| 2: Implicit Contradiction | Logical impossibility | "Cache <50ms" vs "Cache >100ms" | ERROR |
| 3: Exception Conflict | Base vs exception | "No secrets in logs" vs "Log for debug" | WARNING |
| 4: Scope Overlap | Overlapping rules | "All services stateless" vs "DB service stateful" | INFO |
| 5: Constitution Conflict | Rule vs principle | "Must cache" vs Principle: "No caching" | CRITICAL |

---

*Template Version: 1.0*
*Used by /levelup.validate for conflict resolution CDRs*
