#!/bin/bash

# Task Meta Utilities for Agentic SDLC
# Handles task classification, delegation, and status tracking
# CLI usage: tasks-meta-utils.sh <subcommand> [args...]
#
# Subcommands:
#   init <feature_dir>
#   add-task <tasks_meta.json> <task_id> <description> <files> <mode>
#   start-task <tasks_meta.json> <task_id>
#   complete-task <tasks_meta.json> <task_id> [result_summary]
#   fail-task <tasks_meta.json> <task_id> <reason>
#   review-micro <tasks_meta.json> <task_id>
#   quality-gate <tasks_meta.json> <task_id>
#   summary <tasks_meta.json>
#   dispatch-async <task_id> <agent_type> <description> <context> <requirements> <instructions> <feature_dir>
#   check-status <task_id> [feature_dir]
#   rollback-task <tasks_meta.json> <task_id>
#   rollback-feature <feature_dir>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

_log_info()  { echo "[INFO]  $*" >&2; }
_log_warn()  { echo "[WARN]  $*" >&2; }
_log_error() { echo "[ERROR] $*" >&2; }

_safe_json_update() {
    local file="$1"
    shift
    if command -v jq >/dev/null 2>&1; then
        jq "$@" "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
    else
        _log_error "jq is required for JSON updates"
        return 1
    fi
}

_ensure_jq() {
    if ! command -v jq >/dev/null 2>&1; then
        _log_error "This command requires jq. Please install jq."
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Feature-scoped async state directories (replaces global repo-relative dirs)
# ---------------------------------------------------------------------------

_feature_async_dirs() {
    local feature_dir="$1"
    echo "${feature_dir}/.async_state"
}

_ensure_async_dirs() {
    local feature_dir="$1"
    local dir
    dir="$(_feature_async_dirs "$feature_dir")"
    mkdir -p "$dir/delegation_prompts" "$dir/delegation_completed" "$dir/delegation_errors"
}

# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

# Initialize tasks_meta.json for a feature
init_tasks_meta() {
    local feature_dir="$1"
    local tasks_meta_file="$feature_dir/tasks_meta.json"

    cat > "$tasks_meta_file" << EOF
{
    "feature": "$(basename "$feature_dir")",
    "created": "$(date -Iseconds)",
    "tasks": {}
}
EOF

    _ensure_async_dirs "$feature_dir"
    echo "Initialized tasks_meta.json at $tasks_meta_file"
}

# Classify task execution mode (SYNC/ASYNC)
# Falls back to heuristic only when explicit markers are absent.
classify_task_execution_mode() {
    local description="$1"
    local files="$2"

    # Heuristic fallback
    if echo "$description" | grep -qiE "research|analyze|design|plan|review|test|investigate|explore|prototype"; then
        echo "ASYNC"
    elif [[ $(echo "$files" | wc -w) -gt 2 ]]; then
        echo "ASYNC"
    else
        echo "SYNC"
    fi
}

# Add task to tasks_meta.json
add_task() {
    local tasks_meta_file="$1"
    local task_id="$2"
    local description="$3"
    local files="$4"
    local execution_mode="$5"

    _ensure_jq || return 1

    jq --arg task_id "$task_id" \
       --arg desc "$description" \
       --arg files "$files" \
       --arg mode "$execution_mode" \
       '.tasks[$task_id] = {
           "description": $desc,
           "files": $files,
           "execution_mode": $mode,
           "status": "pending",
           "agent_type": "general",
           "started_at": null,
           "completed_at": null,
           "result_summary": null
       }' "$tasks_meta_file" > "${tasks_meta_file}.tmp" && mv "${tasks_meta_file}.tmp" "$tasks_meta_file"

    echo "Added task $task_id ($execution_mode) to $tasks_meta_file"
}

# Mark task as started
start_task() {
    local tasks_meta_file="$1"
    local task_id="$2"

    _ensure_jq || return 1

    local now
    now="$(date -Iseconds)"
    jq --arg task_id "$task_id" --arg now "$now" \
       '.tasks[$task_id].status = "in_progress" | .tasks[$task_id].started_at = $now' \
       "$tasks_meta_file" > "${tasks_meta_file}.tmp" && mv "${tasks_meta_file}.tmp" "$tasks_meta_file"

    echo "Task $task_id started"
}

# Mark task as completed
complete_task() {
    local tasks_meta_file="$1"
    local task_id="$2"
    local result_summary="${3:-}"

    _ensure_jq || return 1

    local now
    now="$(date -Iseconds)"
    jq --arg task_id "$task_id" --arg now "$now" --arg summary "$result_summary" \
       '.tasks[$task_id].status = "completed" | .tasks[$task_id].completed_at = $now | .tasks[$task_id].result_summary = $summary' \
       "$tasks_meta_file" > "${tasks_meta_file}.tmp" && mv "${tasks_meta_file}.tmp" "$tasks_meta_file"

    echo "Task $task_id completed"
}

# Mark task as failed
fail_task() {
    local tasks_meta_file="$1"
    local task_id="$2"
    local reason="$3"

    _ensure_jq || return 1

    local now
    now="$(date -Iseconds)"
    jq --arg task_id "$task_id" --arg now "$now" --arg reason "$reason" \
       '.tasks[$task_id].status = "failed" | .tasks[$task_id].completed_at = $now | .tasks[$task_id].failure_reason = $reason' \
       "$tasks_meta_file" > "${tasks_meta_file}.tmp" && mv "${tasks_meta_file}.tmp" "$tasks_meta_file"

    echo "Task $task_id failed: $reason"
}

# Micro-review for SYNC tasks
review_micro() {
    local tasks_meta_file="$1"
    local task_id="$2"

    _ensure_jq || return 1

    local status
    status="$(jq -r --arg tid "$task_id" '.tasks[$tid].status // "unknown"' "$tasks_meta_file")"
    local mode
    mode="$(jq -r --arg tid "$task_id" '.tasks[$tid].execution_mode // "unknown"' "$tasks_meta_file")"

    if [[ "$status" != "completed" ]]; then
        _log_warn "Task $task_id is not completed (status: $status); micro-review skipped"
        return 1
    fi

    if [[ "$mode" != "SYNC" ]]; then
        _log_warn "Task $task_id is not a SYNC task (mode: $mode); micro-review not required"
        return 0
    fi

    local now
    now="$(date -Iseconds)"
    jq --arg task_id "$task_id" --arg now "$now" \
       '.tasks[$task_id].micro_reviewed_at = $now | .tasks[$task_id].micro_review_passed = true' \
       "$tasks_meta_file" > "${tasks_meta_file}.tmp" && mv "${tasks_meta_file}.tmp" "$tasks_meta_file"

    echo "Micro-review passed for task $task_id"
}

# Quality gate for any task
quality_gate() {
    local tasks_meta_file="$1"
    local task_id="$2"

    _ensure_jq || return 1

    local status
    status="$(jq -r --arg tid "$task_id" '.tasks[$tid].status // "unknown"' "$tasks_meta_file")"
    local mode
    mode="$(jq -r --arg tid "$task_id" '.tasks[$tid].execution_mode // "unknown"' "$tasks_meta_file")"

    if [[ "$status" != "completed" ]]; then
        _log_warn "Task $task_id is not completed (status: $status); quality gate skipped"
        return 1
    fi

    local now
    now="$(date -Iseconds)"
    local gate_passed=true

    # For SYNC tasks, require micro-review
    if [[ "$mode" == "SYNC" ]]; then
        local reviewed
        reviewed="$(jq -r --arg tid "$task_id" '.tasks[$tid].micro_review_passed // false' "$tasks_meta_file")"
        if [[ "$reviewed" != "true" ]]; then
            gate_passed=false
            _log_warn "Quality gate FAILED for $task_id: SYNC task missing micro-review"
        fi
    fi

    jq --arg task_id "$task_id" --arg now "$now" --argjson passed "$gate_passed" \
       '.tasks[$task_id].quality_gate_passed = $passed | .tasks[$task_id].quality_gate_at = $now' \
       "$tasks_meta_file" > "${tasks_meta_file}.tmp" && mv "${tasks_meta_file}.tmp" "$tasks_meta_file"

    if [[ "$gate_passed" == "true" ]]; then
        echo "Quality gate passed for task $task_id"
    else
        echo "Quality gate failed for task $task_id"
        return 1
    fi
}

# Summary of tasks
summary() {
    local tasks_meta_file="$1"

    _ensure_jq || return 1

    local total pending in_progress completed failed
    total="$(jq '[.tasks[]] | length' "$tasks_meta_file")"
    pending="$(jq '[.tasks[] | select(.status == "pending")] | length' "$tasks_meta_file")"
    in_progress="$(jq '[.tasks[] | select(.status == "in_progress")] | length' "$tasks_meta_file")"
    completed="$(jq '[.tasks[] | select(.status == "completed")] | length' "$tasks_meta_file")"
    failed="$(jq '[.tasks[] | select(.status == "failed")] | length' "$tasks_meta_file")"

    local sync_total async_total
    sync_total="$(jq '[.tasks[] | select(.execution_mode == "SYNC")] | length' "$tasks_meta_file")"
    async_total="$(jq '[.tasks[] | select(.execution_mode == "ASYNC")] | length' "$tasks_meta_file")"

    jq -cn \
        --argjson total "$total" \
        --argjson pending "$pending" \
        --argjson in_progress "$in_progress" \
        --argjson completed "$completed" \
        --argjson failed "$failed" \
        --argjson sync_total "$sync_total" \
        --argjson async_total "$async_total" \
        '{
            total_tasks: $total,
            pending: $pending,
            in_progress: $in_progress,
            completed: $completed,
            failed: $failed,
            sync_tasks: $sync_total,
            async_tasks: $async_total,
            all_done: ($pending == 0 and $in_progress == 0 and $failed == 0 and $total > 0)
        }'
}

# ---------------------------------------------------------------------------
# Feature-scoped async delegation (replaces global repo-relative dirs)
# ---------------------------------------------------------------------------

generate_delegation_prompt() {
    local task_id="$1"
    local agent_type="$2"
    local task_description="$3"
    local task_context="$4"
    local task_requirements="$5"
    local execution_instructions="$6"
    local feature_dir="$7"

    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    source "$script_dir/common.sh" 2>/dev/null || true
    local repo_root
    repo_root="$(cd "$script_dir/../.." && pwd)"
    local template_file
    template_file=$(resolve_template "delegation-template" "$repo_root") || {
        # Fallback: use an inline default template when no preset or core
        # template is installed (e.g. bare test environments).
        template_file=""
    }

    local template_content
    if [ -n "$template_file" ] && [ -f "$template_file" ]; then
        template_content=$(cat "$template_file")
    else
        template_content='# Delegation Request

**Task ID:** {TASK_ID}
**Agent Type:** {AGENT_TYPE}
**Timestamp:** {TIMESTAMP}

## Description
{TASK_DESCRIPTION}

## Context
{TASK_CONTEXT}

## Requirements
{TASK_REQUIREMENTS}

## Execution Instructions
{EXECUTION_INSTRUCTIONS}'
    fi

    local agent_context
    agent_context=$(generate_agent_context "$feature_dir")

    local full_context="${task_context}

${agent_context}"

    local prompt
    prompt=$(awk -v agent_type="$agent_type" \
                 -v task_description="$task_description" \
                 -v full_context="$full_context" \
                 -v task_requirements="$task_requirements" \
                 -v execution_instructions="$execution_instructions" \
                 -v task_id="$task_id" \
                 -v timestamp="$(date)" '
    {
        gsub(/{AGENT_TYPE}/, agent_type);
        gsub(/{TASK_DESCRIPTION}/, task_description);
        gsub(/{TASK_CONTEXT}/, full_context);
        gsub(/{TASK_REQUIREMENTS}/, task_requirements);
        gsub(/{EXECUTION_INSTRUCTIONS}/, execution_instructions);
        gsub(/{TASK_ID}/, task_id);
        gsub(/{TIMESTAMP}/, timestamp);
        print;
    }' <<< "$template_content")

    echo "$prompt"
}

generate_agent_context() {
    local feature_dir="$1"

    local context="## Project Context

"

    if [[ -f "$feature_dir/spec.md" ]]; then
        context="${context}### Feature Specification
$(cat "$feature_dir/spec.md")

"
    fi

    if [[ -f "$feature_dir/plan.md" ]]; then
        context="${context}### Technical Plan
$(cat "$feature_dir/plan.md")

"
    fi

    if [[ -f "$feature_dir/data-model.md" ]]; then
        context="${context}### Data Model
$(cat "$feature_dir/data-model.md")

"
    fi

    if [[ -f "$feature_dir/research.md" ]]; then
        context="${context}### Research & Decisions
$(cat "$feature_dir/research.md")

"
    fi

    if [[ -d "$feature_dir/contracts" ]]; then
        context="${context}### API Contracts
"
        for contract_file in "$feature_dir/contracts"/*.md; do
            if [[ -f "$contract_file" ]]; then
                context="${context}#### $(basename "$contract_file" .md)
$(cat "$contract_file")

"
            fi
        done
    fi

    if [[ -f "constitution.md" ]]; then
        context="${context}### Team Constitution
$(head -50 constitution.md)

"
    fi

    echo "$context"
}

# Dispatch async task using natural language delegation with rich context
# Stores prompt under feature_dir/.async_state/ for feature-scoped isolation.
dispatch_async_task() {
    local task_id="$1"
    local agent_type="$2"
    local task_description="$3"
    local task_context="$4"
    local task_requirements="$5"
    local execution_instructions="$6"
    local feature_dir="$7"

    _ensure_async_dirs "$feature_dir"

    local prompt
    prompt=$(generate_delegation_prompt "$task_id" "$agent_type" "$task_description" "$task_context" "$task_requirements" "$execution_instructions" "$feature_dir")

    if [[ $? -ne 0 ]]; then
        _log_error "Failed to generate delegation prompt" >&2
        return 1
    fi

    local async_dir
    async_dir="$(_feature_async_dirs "$feature_dir")"
    local prompt_file="$async_dir/delegation_prompts/${task_id}.md"
    echo "$prompt" > "$prompt_file"

    echo "Task $task_id delegated successfully - prompt saved for AI assistant"
}

# Check delegation status
# Reads from feature_dir/.async_state/ for feature-scoped isolation.
check_delegation_status() {
    local task_id="$1"
    local feature_dir="${2:-}"

    local async_dir
    if [[ -n "$feature_dir" ]]; then
        async_dir="$(_feature_async_dirs "$feature_dir")"
    else
        # Legacy fallback: repo-relative global dirs
        async_dir="."
    fi

    local prompt_file="$async_dir/delegation_prompts/${task_id}.md"
    if [[ ! -f "$prompt_file" ]]; then
        echo "no_job"
        return 0
    fi

    local completion_file="$async_dir/delegation_completed/${task_id}.txt"
    if [[ -f "$completion_file" ]]; then
        echo "completed"
        return 0
    fi

    local error_file="$async_dir/delegation_errors/${task_id}.txt"
    if [[ -f "$error_file" ]]; then
        echo "failed"
        return 0
    fi

    echo "running"
}

# ---------------------------------------------------------------------------
# Rollback helpers
# ---------------------------------------------------------------------------

rollback_task() {
    local tasks_meta_file="$1"
    local task_id="$2"
    local preserve_docs="${3:-true}"

    _log_warn "Rolling back task: $task_id"

    local task_description=""
    local task_files=""
    if command -v jq >/dev/null 2>&1; then
        task_description=$(jq -r ".tasks[\"$task_id\"].description // empty" "$tasks_meta_file")
        task_files=$(jq -r ".tasks[\"$task_id\"].files // empty" "$tasks_meta_file")
    fi

    if command -v jq >/dev/null 2>&1; then
        jq --arg task_id "$task_id" '.tasks[$task_id].status = "rolled_back"' "$tasks_meta_file" > "${tasks_meta_file}.tmp" && \
        mv "${tasks_meta_file}.tmp" "$tasks_meta_file"
    fi

    if [[ -n "$task_files" ]]; then
        _log_info "Note: Manual code reversion may be required for files: $task_files"
    fi

    local feature_dir
    feature_dir=$(dirname "$tasks_meta_file")
    echo "## Task Rollback - $(date)" >> "$feature_dir/rollback.log"
    echo "Task ID: $task_id" >> "$feature_dir/rollback.log"
    echo "Description: $task_description" >> "$feature_dir/rollback.log"
    echo "Files: $task_files" >> "$feature_dir/rollback.log"
    echo "Documentation Preserved: $preserve_docs" >> "$feature_dir/rollback.log"
    echo "" >> "$feature_dir/rollback.log"

    echo "Task $task_id rolled back successfully"
}

rollback_feature() {
    local feature_dir="$1"
    local preserve_docs="${2:-true}"

    _log_warn "Rolling back entire feature: $(basename "$feature_dir")"

    local tasks_meta_file="$feature_dir/tasks_meta.json"

    if [[ -f "$tasks_meta_file" ]]; then
        if command -v jq >/dev/null 2>&1; then
            jq '.tasks |= map_values(.status = "rolled_back")' "$tasks_meta_file" > "${tasks_meta_file}.tmp" && \
            mv "${tasks_meta_file}.tmp" "$tasks_meta_file"
        fi
    fi

    rm -f "$feature_dir/implementation.log"
    rm -rf "$feature_dir/checklists"

    echo "## Feature Rollback - $(date)" >> "$feature_dir/rollback.log"
    echo "Feature: $(basename "$feature_dir")" >> "$feature_dir/rollback.log"
    echo "All tasks marked as rolled back" >> "$feature_dir/rollback.log"
    echo "Implementation artifacts removed" >> "$feature_dir/rollback.log"
    echo "Documentation Preserved: $preserve_docs" >> "$feature_dir/rollback.log"
    echo "" >> "$feature_dir/rollback.log"

    echo "Feature $(basename "$feature_dir") implementation rolled back"
}

# ---------------------------------------------------------------------------
# CLI dispatcher
# ---------------------------------------------------------------------------

_usage() {
    cat <<'EOF'
Usage: tasks-meta-utils.sh <subcommand> [args...]

Subcommands:
  init <feature_dir>
  add-task <tasks_meta.json> <task_id> <description> <files> <mode>
  start-task <tasks_meta.json> <task_id>
  complete-task <tasks_meta.json> <task_id> [result_summary]
  fail-task <tasks_meta.json> <task_id> <reason>
  review-micro <tasks_meta.json> <task_id>
  quality-gate <tasks_meta.json> <task_id>
  summary <tasks_meta.json>
  dispatch-async <task_id> <agent_type> <description> <context> <requirements> <instructions> <feature_dir>
  check-status <task_id> [feature_dir]
  rollback-task <tasks_meta.json> <task_id>
  rollback-feature <feature_dir>

Run `tasks-meta-utils.sh <subcommand> --help` for subcommand-specific options.
EOF
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    SUBCOMMAND="${1:-}"
    if [[ -z "$SUBCOMMAND" ]]; then
        _usage
        exit 1
    fi
    shift

    case "$SUBCOMMAND" in
        init)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh init <feature_dir>"
                exit 0
            fi
            init_tasks_meta "$1"
            ;;
        add-task)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh add-task <tasks_meta.json> <task_id> <description> <files> <mode>"
                exit 0
            fi
            add_task "$1" "$2" "$3" "$4" "$5"
            ;;
        start-task)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh start-task <tasks_meta.json> <task_id>"
                exit 0
            fi
            start_task "$1" "$2"
            ;;
        complete-task)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh complete-task <tasks_meta.json> <task_id> [result_summary]"
                exit 0
            fi
            complete_task "$1" "$2" "${3:-}"
            ;;
        fail-task)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh fail-task <tasks_meta.json> <task_id> <reason>"
                exit 0
            fi
            fail_task "$1" "$2" "$3"
            ;;
        review-micro)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh review-micro <tasks_meta.json> <task_id>"
                exit 0
            fi
            review_micro "$1" "$2"
            ;;
        quality-gate)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh quality-gate <tasks_meta.json> <task_id>"
                exit 0
            fi
            quality_gate "$1" "$2"
            ;;
        summary)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh summary <tasks_meta.json>"
                exit 0
            fi
            summary "$1"
            ;;
        dispatch-async)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh dispatch-async <task_id> <agent_type> <description> <context> <requirements> <instructions> <feature_dir>"
                exit 0
            fi
            dispatch_async_task "$1" "$2" "$3" "$4" "$5" "$6" "$7"
            ;;
        check-status)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh check-status <task_id> [feature_dir]"
                exit 0
            fi
            check_delegation_status "$1" "${2:-}"
            ;;
        rollback-task)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh rollback-task <tasks_meta.json> <task_id>"
                exit 0
            fi
            rollback_task "$1" "$2"
            ;;
        rollback-feature)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh rollback-feature <feature_dir>"
                exit 0
            fi
            rollback_feature "$1"
            ;;
        generate_delegation_prompt)
            shift
            generate_delegation_prompt "$@"
            ;;
        analyze_implementation_changes)
            shift
            analyze_implementation_changes "$@"
            ;;
        propose_documentation_updates)
            shift
            propose_documentation_updates "$@"
            ;;
        apply_documentation_updates)
            shift
            apply_documentation_updates "$@"
            ;;
        regenerate_tasks_after_rollback)
            shift
            regenerate_tasks_after_rollback "$@"
            ;;
        regenerate_plan)
            shift
            regenerate_plan "$@"
            ;;
        ensure_documentation_consistency)
            shift
            ensure_documentation_consistency "$@"
            ;;
        execute_rollback)
            shift
            execute_rollback "$@"
            ;;
        classify)
            if [[ -z "${1:-}" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
                echo "Usage: tasks-meta-utils.sh classify <description> [files]"
                exit 0
            fi
            classify_task_execution_mode "$1" "${2:-}"
            ;;
        -h|--help|help)
            _usage
            exit 0
            ;;
        *)
            _log_error "Unknown subcommand: $SUBCOMMAND"
            _usage
            exit 1
            ;;
    esac
fi
