#!/bin/bash
# implement.sh - Execute the implementation plan
# Usage: implement.sh <feature_dir> [--worktree]
#
# Branch mode (default): sequential execution of tasks from tasks.md
# Worktree mode (--worktree): wave-based execution from tasks_dag.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source tasks-meta-utils for metadata operations
source "$SCRIPT_DIR/tasks-meta-utils.sh"

_log_info()  { echo "[INFO]  $*" >&2; }
_log_warn()  { echo "[WARN]  $*" >&2; }
_log_error() { echo "[ERROR] $*" >&2; }
_log_success() { echo "[OK]    $*" >&2; }

FEATURE_DIR=""
WORKTREE_MODE=false
FEATURE_NAME=""
TASKS_FILE=""
TASKS_META_FILE=""
DAG_FILE=""

# ---------------------------------------------------------------------------
# Parse CLI
# ---------------------------------------------------------------------------

_parse_args() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: implement.sh <feature_dir> [--worktree]" >&2
        exit 1
    fi
    FEATURE_DIR="$1"
    shift
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --worktree) WORKTREE_MODE=true; shift ;;
            -h|--help)
                echo "Usage: implement.sh <feature_dir> [--worktree]"
                exit 0
                ;;
            *) _log_error "Unknown arg: $1"; exit 1 ;;
        esac
    done

    FEATURE_DIR="$(cd "$FEATURE_DIR" 2>/dev/null && pwd)" || {
        _log_error "Feature directory not found: $FEATURE_DIR"
        exit 1
    }
    FEATURE_NAME="$(basename "$FEATURE_DIR")"
    TASKS_FILE="$FEATURE_DIR/tasks.md"
    TASKS_META_FILE="$FEATURE_DIR/tasks_meta.json"
    DAG_FILE="$FEATURE_DIR/tasks_dag.json"
}

# ---------------------------------------------------------------------------
# Task parsing from tasks.md
# ---------------------------------------------------------------------------

_parse_tasks_from_md() {
    local tasks_md="$1"
    if [[ ! -f "$tasks_md" ]]; then
        _log_error "Tasks file not found: $tasks_md"
        exit 1
    fi

    local line
    while IFS= read -r line; do
        # Match: - [ ] TNNN [P] [SYNC|ASYNC] [USn] Description
        if [[ "$line" =~ ^-[[:space:]]\[[[:space:]]\][[:space:]]+(T[0-9]+)[[:space:]]+(.*)$ ]]; then
            local id="${BASH_REMATCH[1]}"
            local rest="${BASH_REMATCH[2]}"
            local is_parallel=""
            local exec_mode=""
            local story=""
            local desc="$rest"

            if [[ "$rest" =~ ^\[P\][[:space:]]+(.*)$ ]]; then
                is_parallel="P"
                rest="${BASH_REMATCH[1]}"
            fi
            if [[ "$rest" =~ ^\[(SYNC|ASYNC)\][[:space:]]+(.*)$ ]]; then
                exec_mode="${BASH_REMATCH[1]}"
                rest="${BASH_REMATCH[2]}"
            fi
            if [[ "$rest" =~ ^\[(US[0-9]+)\][[:space:]]+(.*)$ ]]; then
                story="${BASH_REMATCH[1]}"
                rest="${BASH_REMATCH[2]}"
            fi
            desc="$rest"
            desc="$(echo "$desc" | sed -E 's/[[:space:]]+$//')"

            # Extract files
            local files=""
            files="$(echo "$desc" | grep -oE '[a-zA-Z0-9_./-]+\.(py|sh|ps1|js|ts|tsx|jsx|go|rs|java|rb|php|c|cpp|h|hpp|cs|swift|kt|mjs|cjs)' 2>/dev/null | sort -u | tr '\n' ' ' || true)"
            files="$(echo "$files" | sed 's/ $//')"

            # Default to heuristic if no explicit marker
            if [[ -z "$exec_mode" ]]; then
                exec_mode="$(classify_task_execution_mode "$desc" "$files")"
            fi

            printf '%s|%s|%s|%s|%s|%s\n' "$id" "$is_parallel" "$exec_mode" "$story" "$desc" "$files"
        fi
    done < "$tasks_md"
}

# ---------------------------------------------------------------------------
# Mark task complete in tasks.md
# ---------------------------------------------------------------------------

_mark_task_complete() {
    local tasks_md="$1"
    local task_id="$2"
    sed -i -E "s/^(- \[ \] ${task_id}\b)/- [X] ${task_id}/" "$tasks_md"
}

# ---------------------------------------------------------------------------
# Branch mode: sequential execution
# ---------------------------------------------------------------------------

_execute_branch_mode() {
    _log_info "Branch mode: sequential execution"

    # Initialize metadata if missing
    if [[ ! -f "$TASKS_META_FILE" ]]; then
        init_tasks_meta "$FEATURE_DIR"
    fi

    # Parse and register tasks
    local parsed
    parsed="$(_parse_tasks_from_md "$TASKS_FILE")"

    local line
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        IFS='|' read -r task_id is_parallel exec_mode story desc files <<< "$line"

        # Skip already-completed tasks
        if grep -qE "^- \[[xX]\] ${task_id}\b" "$TASKS_FILE"; then
            _log_info "Task $task_id already completed, skipping"
            continue
        fi

        # Add to metadata if not present
        local existing
        existing="$(jq -r --arg tid "$task_id" '.tasks[$tid] // empty' "$TASKS_META_FILE" 2>/dev/null || true)"
        if [[ -z "$existing" ]]; then
            add_task "$TASKS_META_FILE" "$task_id" "$desc" "$files" "$exec_mode"
        fi

        _log_info "Executing task $task_id [$exec_mode]: $desc"
        start_task "$TASKS_META_FILE" "$task_id"

        # Execute task body
        local result=0
        if [[ "$exec_mode" == "ASYNC" ]]; then
            _execute_async_task "$task_id" "$desc" "$files"
        else
            _execute_sync_task "$task_id" "$desc" "$files"
        fi
        result=$?

        if [[ $result -eq 0 ]]; then
            complete_task "$TASKS_META_FILE" "$task_id" "Task completed successfully"
            _mark_task_complete "$TASKS_FILE" "$task_id"
            _log_success "Task $task_id completed"
        else
            fail_task "$TASKS_META_FILE" "$task_id" "Task execution failed"
            _log_error "Task $task_id failed"
            return 1
        fi

        # Quality gate
        quality_gate "$TASKS_META_FILE" "$task_id" || true
    done <<< "$parsed"

    # Final summary
    local summary_json
    summary_json="$(summary "$TASKS_META_FILE")"
    local all_done
    all_done="$(echo "$summary_json" | jq -r '.all_done')"
    if [[ "$all_done" == "true" ]]; then
        _log_success "All tasks completed for feature $FEATURE_NAME"
    else
        _log_warn "Some tasks remain incomplete for feature $FEATURE_NAME"
    fi
    echo "$summary_json"
}

_execute_sync_task() {
    local task_id="$1"
    local desc="$2"
    local files="$3"
    _log_info "SYNC task $task_id: executing inline"
    # In a real environment, this would invoke the agent or build system.
    # For the script backend, we return success and let the caller handle execution.
    return 0
}

_execute_async_task() {
    local task_id="$1"
    local desc="$2"
    local files="$3"
    _log_info "ASYNC task $task_id: dispatching to async agent"
    # Dispatch the async task
    dispatch_async_task "$task_id" "general" "$desc" "Files: $files" "Complete per spec" "Execute and commit" "$FEATURE_DIR"

    # Poll for completion (with timeout)
    local max_wait=300  # 5 minutes default
    local waited=0
    while true; do
        local status
        status="$(check_delegation_status "$task_id" "$FEATURE_DIR")"
        case "$status" in
            completed)
                _log_success "ASYNC task $task_id completed"
                return 0
                ;;
            failed)
                _log_error "ASYNC task $task_id failed"
                return 1
                ;;
            no_job)
                _log_warn "ASYNC task $task_id has no job record"
                return 1
                ;;
        esac
        sleep 2
        waited=$((waited + 2))
        if [[ $waited -ge $max_wait ]]; then
            _log_warn "ASYNC task $task_id timed out after ${max_wait}s"
            return 1
        fi
    done
}

# ---------------------------------------------------------------------------
# Worktree mode: wave-based execution
# ---------------------------------------------------------------------------

_execute_worktree_mode() {
    _log_info "Worktree mode: wave-based execution"

    if [[ ! -f "$DAG_FILE" ]]; then
        _log_warn "DAG file not found: $DAG_FILE. Falling back to branch mode."
        _execute_branch_mode
        return
    fi

    if ! command -v jq >/dev/null 2>&1; then
        _log_error "Worktree mode requires jq"
        exit 1
    fi

    # Initialize metadata if missing
    if [[ ! -f "$TASKS_META_FILE" ]]; then
        init_tasks_meta "$FEATURE_DIR"
    fi

    # Register all tasks from DAG
    local task_count
    task_count="$(jq '.tasks | length' "$DAG_FILE")"
    local i
    for i in $(seq 0 $((task_count - 1))); do
        local task_obj
        task_obj="$(jq -c ".tasks[$i]" "$DAG_FILE")"
        local task_id desc files exec_mode
        task_id="$(echo "$task_obj" | jq -r '.id')"
        desc="$(echo "$task_obj" | jq -r '.description')"
        files="$(echo "$task_obj" | jq -r '[.files[]?] | join(" ")')"
        exec_mode="$(echo "$task_obj" | jq -r '.execution_mode')"

        local existing
        existing="$(jq -r --arg tid "$task_id" '.tasks[$tid] // empty' "$TASKS_META_FILE" 2>/dev/null || true)"
        if [[ -z "$existing" ]]; then
            add_task "$TASKS_META_FILE" "$task_id" "$desc" "$files" "$exec_mode"
        fi
    done

    # Execute waves
    local wave_count
    wave_count="$(jq '.execution_waves | length' "$DAG_FILE")"
    local wave_idx
    for wave_idx in $(seq 0 $((wave_count - 1))); do
        local wave_tasks
        wave_tasks="$(jq -r ".execution_waves[$wave_idx][]" "$DAG_FILE")"

        if [[ -z "$wave_tasks" ]]; then
            continue
        fi

        _log_info "Wave $((wave_idx + 1))/$wave_count: $(echo "$wave_tasks" | tr '\n' ' ')"

        # For each task in the wave: create branch, start, execute
        local task_id
        while IFS= read -r task_id; do
            [[ -z "$task_id" ]] && continue

            # Skip already completed
            if grep -qE "^- \[[xX]\] ${task_id}\b" "$TASKS_FILE"; then
                _log_info "Task $task_id already completed, skipping"
                continue
            fi

            start_task "$TASKS_META_FILE" "$task_id"

            # In worktree mode, we assume the caller (agent) handles task branch
            # creation and actual implementation. This script orchestrates metadata.
            local exec_mode
            exec_mode="$(jq -r --arg tid "$task_id" '.tasks[$tid].execution_mode' "$TASKS_META_FILE")"

            if [[ "$exec_mode" == "ASYNC" ]]; then
                _execute_async_task "$task_id" "" ""
            else
                _execute_sync_task "$task_id" "" ""
            fi
        done <<< "$wave_tasks"

        # Wait for wave completion and mark successful tasks
        while IFS= read -r task_id; do
            [[ -z "$task_id" ]] && continue
            local status
            status="$(jq -r --arg tid "$task_id" '.tasks[$tid].status' "$TASKS_META_FILE")"
            if [[ "$status" == "completed" ]]; then
                _mark_task_complete "$TASKS_FILE" "$task_id"
            fi
        done <<< "$wave_tasks"
    done

    # Final summary
    local summary_json
    summary_json="$(summary "$TASKS_META_FILE")"
    echo "$summary_json"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    _parse_args "$@"

    if [[ ! -f "$TASKS_FILE" ]]; then
        _log_error "Tasks file not found: $TASKS_FILE"
        exit 1
    fi

    _log_info "Implementing feature: $FEATURE_NAME"
    _log_info "Tasks: $TASKS_FILE"
    _log_info "Mode: $([[ "$WORKTREE_MODE" == "true" ]] && echo "worktree" || echo "branch")"

    if [[ "$WORKTREE_MODE" == "true" ]]; then
        _execute_worktree_mode
    else
        _execute_branch_mode
    fi
}

main "$@"
