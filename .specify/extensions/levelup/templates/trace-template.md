# Session Trace: {FEATURE_NAME}

Generated: {TIMESTAMP}
Feature: {FEATURE_ID}
Branch: {BRANCH_NAME}

---

## Summary

### Problem

{PROBLEM_STATEMENT}

Brief description of the initial goal extracted from spec mission and all user stories. This should be 1-2 sentences summarizing what needed to be implemented.

**Example**:

- "Implement user authentication system with JWT tokens and refresh token rotation"
- "Implement blood coagulation cascade with Factor IX activation and proper enzyme sequencing"

### Key Decisions

{NUMBERED_DECISIONS_LIST}

Chronological list of significant decisions made during implementation. Includes architecture, technology, testing, process, and integration decisions.

**Example**:

1. Chose React with TypeScript for type-safe component development
2. Implemented TDD approach with 90%+ code coverage requirement
3. Applied dual execution loop with 5 SYNC (micro-reviewed) and 3 ASYNC (agent-delegated) tasks

### Final Solution

{OUTCOME_STATEMENT}

Brief description of what was accomplished with key metrics (quality gate pass rate, user story completion, evidence).

**Example**:

- "Delivered User Authentication implementation with 8/8 quality gates passed (100% pass rate). All 4 user stories implemented with comprehensive validation. Documented in commit a1b2c3d with 6 supporting issue tracker references."

---

## 1. Session Overview

{OVERVIEW_CONTENT}

Summary of AI agent approach for implementing this feature, including mission statement, key architectural decisions, and implementation strategy.

**Example**:

- Mission: Implement user authentication with JWT tokens
- Key Decisions: Use bcrypt for password hashing, implement refresh token rotation
- Approach: Test-driven development with comprehensive security testing

---

## 2. Decision Patterns

{DECISION_PATTERNS}

Documentation of problem-solving approaches, triage decisions, and technology choices made during implementation.

**Triage Classification**:

- SYNC (human-reviewed) tasks: {SYNC_COUNT}
- ASYNC (agent-delegated) tasks: {ASYNC_COUNT}
- Total tasks: {TOTAL_TASKS}

**Technology Choices**:

- List key technology decisions
- Framework selections and rationale
- Library choices and alternatives considered

**Problem-Solving Approaches**:

- Dual execution loop (SYNC/ASYNC) methodology
- Task decomposition strategy
- Integration patterns used

---

## 3. Execution Context

{EXECUTION_CONTEXT}

Detailed execution metadata including quality gates, review status, and MCP tracking results.

**Quality Gates**:

- Passed: {GATES_PASSED}
- Failed: {GATES_FAILED}
- Total: {GATES_TOTAL}
- Pass Rate: {PASS_RATE}%

**Execution Modes**:

- SYNC tasks (micro-reviewed): {SYNC_COUNT}
- ASYNC tasks (macro-reviewed): {ASYNC_COUNT}

**Review Status**:

- Micro-reviewed: {MICRO_REVIEWED}
- Macro-reviewed: {MACRO_REVIEWED}

**MCP Tracking** (if applicable):

- MCP job submissions: {MCP_JOBS}
- Completion status: {MCP_STATUS}

---

## 4. Reusable Patterns

{REUSABLE_PATTERNS}

Identification of effective methodologies and patterns applicable to similar contexts.

**Effective Methodologies**:

- ASYNC delegation: {ASYNC_SUCCESS} tasks successfully delegated and validated
- Micro-review workflow: {MICRO_SUCCESS} tasks validated through micro-reviews
- Testing approach: {TESTING_APPROACH}

**Pattern Examples**:

1. **Pattern Name**: Brief description of what worked well
   - Context: When to apply this pattern
   - Benefits: Why this approach was effective
   - Reusability: Similar scenarios where applicable

2. **Pattern Name**: Another successful approach
   - Context: Specific conditions
   - Benefits: Outcomes achieved
   - Reusability: Broader applicability

**Applicable Contexts**:

- Similar features requiring dual execution loop
- Projects with SYNC/ASYNC task classification
- Spec-driven development workflows
- {SPECIFIC_DOMAIN} implementations

---

## 5. Evidence Links

{EVIDENCE_LINKS}

References to implementation artifacts, commits, issues, and code paths for traceability.

**Implementation Commit**: {COMMIT_SHA}

- Message: {COMMIT_MESSAGE}
- Date: {COMMIT_DATE}

**Code Paths Modified**:

- {FILE_1}
- {FILE_2}
- {FILE_3}
- ... (from tasks_meta.json)

**Feature Artifacts**:

- Specification: specs/{FEATURE_ID}/spec.md
- Implementation Plan: specs/{FEATURE_ID}/plan.md
- Task List: specs/{FEATURE_ID}/tasks.md
- Execution Metadata: specs/{FEATURE_ID}/tasks_meta.json
- Session Trace: specs/{FEATURE_ID}/trace.md (this file)

**Additional Context**:

- Research documentation: specs/{FEATURE_ID}/research.md (if exists)
- Quickstart guide: specs/{FEATURE_ID}/quickstart.md (if exists)
- Contract definitions: specs/{FEATURE_ID}/contracts/ (if exists)

---

**Trace Generation**: This trace was automatically generated from execution metadata and feature artifacts by the `/trace` command. For detailed implementation information, refer to the linked artifacts above.

**Usage**: This trace can be consumed by `/levelup.specify` for extracting Context Decision Records (CDRs) and analyzing contributions to team-ai-directives (rules, constitution, personas, examples, skills).

**Reusability**: Patterns and approaches documented here can inform similar implementations in other projects or features with comparable requirements.
