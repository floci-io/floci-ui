#!/usr/bin/env bash

# Generate AI session execution trace from tasks_meta.json and feature artifacts
# This script creates a comprehensive trace of the AI agent's session including
# decisions, patterns, execution context, and evidence links.

set -e

JSON_MODE=false

for arg in "$@"; do
    case "$arg" in
        --json)
            JSON_MODE=true
            ;;
        --help|-h)
            echo "Usage: $0 [--json]"
            echo "  --json    Output results in JSON format"
            echo "  --help    Show this help message"
            exit 0
            ;;
        *)
            ;;
    esac
done

# Get script directory for common.sh sourcing
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find project root by walking up from script location
_find_project_root() {
    local dir="$SCRIPT_DIR"
    while [ "$dir" != "/" ]; do
        if [ -d "$dir/.specify" ] || [ -d "$dir/.git" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

PROJECT_ROOT="$(_find_project_root)" || PROJECT_ROOT="$SCRIPT_DIR"

# Load common functions - use absolute path from project root
if [[ -n "$PROJECT_ROOT" && -f "$PROJECT_ROOT/.specify/scripts/bash/common.sh" ]]; then
    source "$PROJECT_ROOT/.specify/scripts/bash/common.sh"
elif [[ -f "$SCRIPT_DIR/common.sh" ]]; then
    source "$SCRIPT_DIR/common.sh"
fi

eval $(get_feature_paths)

check_feature_branch "$CURRENT_BRANCH" "$HAS_GIT" || exit 1

# Define paths
TRACE_FILE="$FEATURE_DIR/trace.md"
TASKS_META_FILE="$FEATURE_DIR/tasks_meta.json"
TRACE_TEMPLATE="$REPO_ROOT/.specify/templates/trace-template.md"

# Check prerequisites
if [[ ! -f "$FEATURE_SPEC" ]]; then
    echo "ERROR: spec.md not found at $FEATURE_SPEC" >&2
    exit 1
fi

if [[ ! -f "$IMPL_PLAN" ]]; then
    echo "ERROR: plan.md not found at $IMPL_PLAN" >&2
    exit 1
fi

if [[ ! -f "$TASKS" ]]; then
    echo "ERROR: tasks.md not found at $TASKS" >&2
    exit 1
fi

if [[ ! -f "$TASKS_META_FILE" ]]; then
    echo "ERROR: tasks_meta.json not found at $TASKS_META_FILE" >&2
    echo "Please run /implement before generating a trace." >&2
    exit 1
fi

# Validate tasks_meta.json
if ! jq empty "$TASKS_META_FILE" 2>/dev/null; then
    echo "ERROR: tasks_meta.json is not valid JSON" >&2
    exit 1
fi

# Extract feature name
FEATURE_NAME=$(basename "$FEATURE_DIR")

# NEW: Extract problem statement for Summary section
# Synthesizes problem from spec mission + all user stories
extract_problem_statement() {
    local problem=""
    
    # Get feature title from spec
    local feature_title=$(grep -m1 "^# " "$FEATURE_SPEC" | sed 's/^# //' || echo "$FEATURE_NAME")
    
    # Get mission from plan if exists (prioritize plan mission)
    local mission=""
    if [[ -f "$IMPL_PLAN" ]]; then
        mission=$(sed -n '/## Mission/,/^## /p' "$IMPL_PLAN" | grep -v "^## " | sed '/^$/d' | head -3 | tr '\n' ' ' | sed 's/  */ /g')
    fi
    
    # Get all user stories from spec
    local user_stories=$(grep -i "As a user\|User story\|As an\|As a" "$FEATURE_SPEC" | cut -d'@' -f1 | sed 's/^[- ]*//' | head -5)
    
    # Build problem statement
    if [[ -n "$mission" ]]; then
        problem="$mission"
    elif [[ -n "$user_stories" ]]; then
        # Synthesize from user stories
        local story_count=$(echo "$user_stories" | wc -l)
        if [[ $story_count -eq 1 ]]; then
            problem="$user_stories"
        else
            # Multiple stories - create synthesis
            local first_story=$(echo "$user_stories" | head -1)
            problem="Implement $feature_title with multiple user stories including: $first_story and $((story_count - 1)) more."
        fi
    else
        # Fallback to feature title
        problem="Implement $feature_title feature."
    fi
    
    echo "$problem"
}

# NEW: Extract key decisions chronologically for Summary section
# Extracts significant decisions from tasks and plan in execution order
extract_key_decisions() {
    local decisions=()
    local decision_count=0
    
    # Get task names in execution order from tasks_meta.json
    local task_names=$(jq -r '.tasks[] | .name' "$TASKS_META_FILE" 2>/dev/null)
    
    # Extract decisions from plan sections
    # 1. Architecture decisions
    if grep -qi "architecture\|framework\|design" "$IMPL_PLAN" 2>/dev/null; then
        local arch_decision=$(sed -n '/## Architecture\|## Technical Approach/,/^## /p' "$IMPL_PLAN" | grep -E "^-|^\*|^[0-9]" | head -1 | sed 's/^[- *0-9.]*//' | head -c 120)
        if [[ -n "$arch_decision" ]]; then
            decisions+=("$arch_decision")
            decision_count=$((decision_count + 1))
        fi
    fi
    
    # 2. Technology choices
    if grep -qi "technology\|library\|tool\|framework" "$IMPL_PLAN" 2>/dev/null; then
        local tech_decision=$(sed -n '/## Technology Stack\|## Technology\|## Tools/,/^## /p' "$IMPL_PLAN" | grep -E "^-|^\*|^[0-9]" | head -1 | sed 's/^[- *0-9.]*//' | head -c 120)
        if [[ -n "$tech_decision" && "$tech_decision" != "${decisions[0]}" ]]; then
            decisions+=("$tech_decision")
            decision_count=$((decision_count + 1))
        fi
    fi
    
    # 3. Testing strategy
    if grep -qi "TDD\|test.*driven\|testing strategy" "$IMPL_PLAN" 2>/dev/null; then
        decisions+=("Adopted test-driven development (TDD) approach")
        decision_count=$((decision_count + 1))
    elif grep -qi "risk.*based.*test" "$IMPL_PLAN" 2>/dev/null; then
        decisions+=("Used risk-based testing strategy")
        decision_count=$((decision_count + 1))
    fi
    
    # 4. Process decisions (SYNC/ASYNC)
    local sync_count=$(jq -r '[.tasks[] | select(.execution_mode == "SYNC")] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local async_count=$(jq -r '[.tasks[] | select(.execution_mode == "ASYNC")] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    if [[ $sync_count -gt 0 || $async_count -gt 0 ]]; then
        decisions+=("Applied dual execution loop with $sync_count SYNC (micro-reviewed) and $async_count ASYNC (agent-delegated) tasks")
        decision_count=$((decision_count + 1))
    fi
    
    # 5. Integration decisions
    if grep -qi "integration\|API\|external" "$IMPL_PLAN" 2>/dev/null; then
        local integration_decision=$(sed -n '/## Integration\|## API/,/^## /p' "$IMPL_PLAN" | grep -E "^-|^\*|^[0-9]" | head -1 | sed 's/^[- *0-9.]*//' | head -c 120)
        if [[ -n "$integration_decision" ]]; then
            decisions+=("$integration_decision")
            decision_count=$((decision_count + 1))
        fi
    fi
    
    # Format as numbered list (dynamic count based on what we found)
    local output=""
    for i in "${!decisions[@]}"; do
        output+="$((i + 1)). ${decisions[$i]}\n"
    done
    
    # If no decisions found, provide default
    if [[ $decision_count -eq 0 ]]; then
        output="1. Followed spec-driven development workflow\n"
        output+="2. Implemented feature according to specification\n"
        output+="3. Validated against quality gates\n"
    fi
    
    echo -e "$output"
}

# NEW: Extract final solution for Summary section
# Creates outcome statement with key metrics
extract_final_solution() {
    local solution=""
    
    # Get quality gate statistics
    local gates_passed=$(jq -r '[.tasks[] | select(.quality_gates_passed == true)] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local gates_total=$(jq -r '.tasks | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local pass_rate=0
    if [[ $gates_total -gt 0 ]]; then
        pass_rate=$((gates_passed * 100 / gates_total))
    fi
    
    # Get feature title
    local feature_title=$(grep -m1 "^# " "$FEATURE_SPEC" | sed 's/^# //' || echo "$FEATURE_NAME")
    
    # Build outcome statement
    solution="Delivered $feature_title implementation with $gates_passed/$gates_total quality gates passed (${pass_rate}% pass rate)."
    
    # Add user story completion if available
    local user_story_count=$(grep -ci "As a user\|User story" "$FEATURE_SPEC" 2>/dev/null || echo "0")
    if [[ $user_story_count -gt 0 ]]; then
        solution+=" All $user_story_count user stories implemented"
        if [[ $pass_rate -eq 100 ]]; then
            solution+=" with comprehensive validation."
        else
            solution+="."
        fi
    fi
    
    # Add evidence reference
    if [[ "$HAS_GIT" == "true" ]]; then
        local commit_sha=$(git log -1 --format="%h" 2>/dev/null || echo "")
        if [[ -n "$commit_sha" ]]; then
            solution+=" Documented in commit $commit_sha"
        fi
    fi
    
    echo "$solution"
}

# Extract session overview from spec and plan
extract_session_overview() {
    local overview=""
    
    # Get feature title from spec
    local feature_title=$(grep -m1 "^# " "$FEATURE_SPEC" | sed 's/^# //' || echo "$FEATURE_NAME")
    
    # Get mission from plan if exists
    local mission=""
    if [[ -f "$IMPL_PLAN" ]]; then
        mission=$(sed -n '/## Mission/,/^## /p' "$IMPL_PLAN" | grep -v "^## " | head -10 | sed '/^$/d' | head -5)
    fi
    
    # Get key decisions from plan
    local key_decisions=""
    if [[ -f "$IMPL_PLAN" ]]; then
        key_decisions=$(sed -n '/## Technical Approach/,/^## /p' "$IMPL_PLAN" | grep -v "^## " | head -10 | sed '/^$/d' | head -5)
    fi
    
    overview="Summary of AI agent approach for implementing \"$feature_title\".\n\n"
    
    if [[ -n "$mission" ]]; then
        overview+="**Mission**: $mission\n\n"
    fi
    
    if [[ -n "$key_decisions" ]]; then
        overview+="**Key Architectural Decisions**:\n$key_decisions\n"
    else
        overview+="Implementation approach documented in plan.md.\n"
    fi
    
    echo -e "$overview"
}

# Extract decision patterns from plan and tasks
extract_decision_patterns() {
    local patterns=""
    
    # Get triage decisions from tasks_meta.json
    local sync_count=$(jq -r '[.tasks[] | select(.execution_mode == "SYNC")] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local async_count=$(jq -r '[.tasks[] | select(.execution_mode == "ASYNC")] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local total_count=$(jq -r '.tasks | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    
    patterns+="**Triage Classification**:\n"
    patterns+="- SYNC (human-reviewed) tasks: $sync_count\n"
    patterns+="- ASYNC (agent-delegated) tasks: $async_count\n"
    patterns+="- Total tasks: $total_count\n\n"
    
    # Extract technology choices from plan
    if [[ -f "$IMPL_PLAN" ]]; then
        local tech_stack=$(sed -n '/## Technology Stack/,/^## /p' "$IMPL_PLAN" | grep -v "^## " | head -10 | sed '/^$/d')
        if [[ -n "$tech_stack" ]]; then
            patterns+="**Technology Choices**:\n$tech_stack\n\n"
        fi
    fi
    
    patterns+="**Problem-Solving Approaches**:\n"
    patterns+="- Dual execution loop (SYNC/ASYNC) applied\n"
    patterns+="- Task-based decomposition from spec → plan → tasks\n"
    
    echo -e "$patterns"
}

# Extract execution context from tasks_meta.json
extract_execution_context() {
    local context=""
    
    # Quality gate statistics
    local gates_passed=$(jq -r '[.tasks[] | select(.quality_gates_passed == true)] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local gates_failed=$(jq -r '[.tasks[] | select(.quality_gates_passed == false)] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local total_tasks=$(jq -r '.tasks | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    
    context+="**Quality Gates**:\n"
    context+="- Passed: $gates_passed\n"
    context+="- Failed: $gates_failed\n"
    context+="- Total: $total_tasks\n\n"
    
    # Execution modes breakdown
    local sync_count=$(jq -r '[.tasks[] | select(.execution_mode == "SYNC")] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local async_count=$(jq -r '[.tasks[] | select(.execution_mode == "ASYNC")] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    
    context+="**Execution Modes**:\n"
    context+="- SYNC tasks (micro-reviewed): $sync_count\n"
    context+="- ASYNC tasks (macro-reviewed): $async_count\n\n"
    
    # Review status
    local micro_reviewed=$(jq -r '[.tasks[] | select(.micro_reviewed == true)] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    local macro_reviewed=$(jq -r '[.tasks[] | select(.macro_reviewed == true)] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    
    context+="**Review Status**:\n"
    context+="- Micro-reviewed: $micro_reviewed\n"
    context+="- Macro-reviewed: $macro_reviewed\n\n"
    
    # MCP tracking (if exists)
    local mcp_jobs=$(jq -r '[.tasks[] | select(.mcp_job_id != null)] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    if [[ "$mcp_jobs" -gt 0 ]]; then
        context+="**MCP Tracking**: $mcp_jobs tasks with MCP job tracking\n"
    fi
    
    echo -e "$context"
}

# Extract reusable patterns from successful executions
extract_reusable_patterns() {
    local patterns=""
    
    patterns+="**Effective Methodologies**:\n"
    
    # Check for successful ASYNC delegations
    local async_success=$(jq -r '[.tasks[] | select(.execution_mode == "ASYNC" and .quality_gates_passed == true)] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    if [[ "$async_success" -gt 0 ]]; then
        patterns+="- ASYNC delegation: $async_success tasks successfully delegated and validated\n"
    fi
    
    # Check for micro-review patterns
    local micro_success=$(jq -r '[.tasks[] | select(.micro_reviewed == true and .quality_gates_passed == true)] | length' "$TASKS_META_FILE" 2>/dev/null || echo "0")
    if [[ "$micro_success" -gt 0 ]]; then
        patterns+="- Micro-review workflow: $micro_success tasks validated through micro-reviews\n"
    fi
    
    # Extract testing approach from plan
    if grep -qi "TDD\|test.driven" "$IMPL_PLAN" 2>/dev/null; then
        patterns+="- Test-driven development applied\n"
    fi
    
    if grep -qi "risk.based.testing" "$IMPL_PLAN" 2>/dev/null; then
        patterns+="- Risk-based testing strategy used\n"
    fi
    
    patterns+="\n**Applicable Contexts**:\n"
    patterns+="- Similar features requiring dual execution loop\n"
    patterns+="- Projects with SYNC/ASYNC task classification\n"
    patterns+="- Spec-driven development workflows\n"
    
    echo -e "$patterns"
}

# Extract evidence links
extract_evidence_links() {
    local evidence=""
    
    # Get latest commit if git available
    if [[ "$HAS_GIT" == "true" ]]; then
        local latest_commit=$(git log -1 --format="%H" 2>/dev/null || echo "")
        local commit_message=$(git log -1 --format="%s" 2>/dev/null || echo "")
        if [[ -n "$latest_commit" ]]; then
            evidence+="**Implementation Commit**: $latest_commit\n"
            evidence+="- Message: $commit_message\n\n"
        fi
    fi
    
    # List modified files from tasks_meta.json
    local file_list=$(jq -r '.tasks[] | .files[]?' "$TASKS_META_FILE" 2>/dev/null | sort -u | head -10)
    if [[ -n "$file_list" ]]; then
        evidence+="**Code Paths Modified**:\n"
        while IFS= read -r file; do
            if [[ -n "$file" ]]; then
                evidence+="- $file\n"
            fi
        done <<< "$file_list"
    fi
    
    # Feature artifacts
    evidence+="\n**Feature Artifacts**:\n"
    evidence+="- Specification: specs/$FEATURE_NAME/spec.md\n"
    evidence+="- Implementation Plan: specs/$FEATURE_NAME/plan.md\n"
    evidence+="- Task List: specs/$FEATURE_NAME/tasks.md\n"
    evidence+="- Execution Metadata: specs/$FEATURE_NAME/tasks_meta.json\n"
    
    echo -e "$evidence"
}

# Generate the trace file
generate_trace() {
    local feature_title=$(grep -m1 "^# " "$FEATURE_SPEC" | sed 's/^# //' || echo "$FEATURE_NAME")
    
    cat > "$TRACE_FILE" << EOF
# Session Trace: $feature_title

Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
Feature: $FEATURE_NAME
Branch: $CURRENT_BRANCH

---

## Summary

### Problem
$(extract_problem_statement)

### Key Decisions
$(extract_key_decisions)

### Final Solution
$(extract_final_solution)

---

## 1. Session Overview

$(extract_session_overview)

---

## 2. Decision Patterns

$(extract_decision_patterns)

---

## 3. Execution Context

$(extract_execution_context)

---

## 4. Reusable Patterns

$(extract_reusable_patterns)

---

## 5. Evidence Links

$(extract_evidence_links)

---

**Trace Generation**: This trace was automatically generated from execution metadata and feature artifacts. For detailed implementation information, refer to the linked artifacts above.
EOF
    
    echo "Generated trace at $TRACE_FILE"
}

# Calculate section completeness
calculate_completeness() {
    local sections_complete=0
    local total_sections=6  # Updated to include Summary
    
    # Check Summary section
    if grep -q "## Summary" "$TRACE_FILE" && [[ $(sed -n '/## Summary/,/^## 1/p' "$TRACE_FILE" | wc -l) -gt 5 ]]; then
        sections_complete=$((sections_complete + 1))
    fi
    
    if grep -q "## 1. Session Overview" "$TRACE_FILE" && [[ $(sed -n '/## 1. Session Overview/,/^## 2/p' "$TRACE_FILE" | wc -l) -gt 5 ]]; then
        sections_complete=$((sections_complete + 1))
    fi
    
    if grep -q "## 2. Decision Patterns" "$TRACE_FILE" && [[ $(sed -n '/## 2. Decision Patterns/,/^## 3/p' "$TRACE_FILE" | wc -l) -gt 5 ]]; then
        sections_complete=$((sections_complete + 1))
    fi
    
    if grep -q "## 3. Execution Context" "$TRACE_FILE" && [[ $(sed -n '/## 3. Execution Context/,/^## 4/p' "$TRACE_FILE" | wc -l) -gt 5 ]]; then
        sections_complete=$((sections_complete + 1))
    fi
    
    if grep -q "## 4. Reusable Patterns" "$TRACE_FILE" && [[ $(sed -n '/## 4. Reusable Patterns/,/^## 5/p' "$TRACE_FILE" | wc -l) -gt 5 ]]; then
        sections_complete=$((sections_complete + 1))
    fi
    
    if grep -q "## 5. Evidence Links" "$TRACE_FILE" && [[ $(sed -n '/## 5. Evidence Links/,/^---/p' "$TRACE_FILE" | wc -l) -gt 5 ]]; then
        sections_complete=$((sections_complete + 1))
    fi
    
    local coverage_pct=$((sections_complete * 100 / total_sections))
    
    echo "$sections_complete:$total_sections:$coverage_pct"
}

# Main execution
generate_trace

# Calculate completeness
IFS=':' read -r sections_complete total_sections coverage_pct <<< "$(calculate_completeness)"

# Output results
if $JSON_MODE; then
    printf '{"TRACE_FILE":"%s","SECTIONS_COMPLETE":%d,"TOTAL_SECTIONS":%d,"COVERAGE_PCT":%d,"BRANCH":"%s"}\n' \
        "$TRACE_FILE" "$sections_complete" "$total_sections" "$coverage_pct" "$CURRENT_BRANCH"
else
    echo ""
    echo "✅ Trace generation complete"
    echo "   File: $TRACE_FILE"
    echo "   Sections: $sections_complete/$total_sections"
    echo "   Coverage: $coverage_pct%"
    echo ""
fi
