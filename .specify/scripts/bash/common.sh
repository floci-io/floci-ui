#!/usr/bin/env bash
# Common functions and variables for all scripts

# Get the global config path using XDG Base Directory spec
# Platform-specific locations:
# - Linux: ~/.config/specify/config.json
# - macOS: ~/Library/Application Support/specify/config.json (but we use XDG for consistency)
get_global_config_path() {
    local config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
    echo "$config_home/specify/config.json"
}

# Get project-level config path (.specify/config.json)
get_project_config_path() {
    local repo_root=$(get_repo_root)
    echo "$repo_root/.specify/config.json"
}

# Get config path with hierarchical resolution
# Priority: 1) Project config  2) User config  3) Default to project
get_config_path() {
    local project_config=$(get_project_config_path)
    local user_config=$(get_global_config_path)
    
    if [[ -f "$project_config" ]]; then
        echo "$project_config"
    elif [[ -f "$user_config" ]]; then
        echo "$user_config"
    else
        # Default to project-level config
        echo "$project_config"
    fi
}

# Get architecture diagram format from config (mermaid or ascii)
# Defaults to "mermaid" if config doesn't exist or format is invalid
get_architecture_diagram_format() {
    local config_file
    config_file=$(get_config_path)
    
    # Default to mermaid if no config exists or jq not available
    if [[ ! -f "$config_file" ]] || ! command -v jq >/dev/null 2>&1; then
        echo "mermaid"
        return
    fi
    
    # Read diagram format from config, default to mermaid
    local format
    format=$(jq -r '.architecture.diagram_format // "mermaid"' "$config_file" 2>/dev/null)
    
    # Validate format (only mermaid or ascii allowed)
    if [[ "$format" == "mermaid" || "$format" == "ascii" ]]; then
        echo "$format"
    else
        echo "mermaid"  # Fallback for invalid values
    fi
}

# Validate Mermaid diagram syntax (lightweight regex validation)
# Returns 0 if valid, 1 if invalid
# Args: $1 - Mermaid code string
validate_mermaid_syntax() {
    local mermaid_code="$1"
    
    # Check if empty
    if [[ -z "$mermaid_code" ]]; then
        return 1
    fi
    
    # Check for basic Mermaid diagram types
    if ! echo "$mermaid_code" | grep -qE '^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline)'; then
        return 1
    fi
    
    # Check for balanced brackets/parentheses (simplified)
    local open_brackets=$(echo "$mermaid_code" | grep -o '\[' | wc -l)
    local close_brackets=$(echo "$mermaid_code" | grep -o '\]' | wc -l)
    local open_parens=$(echo "$mermaid_code" | grep -o '(' | wc -l)
    local close_parens=$(echo "$mermaid_code" | grep -o ')' | wc -l)
    
    if [[ $open_brackets -ne $close_brackets ]] || [[ $open_parens -ne $close_parens ]]; then
        return 1
    fi
    
    # Basic syntax passed
    return 0
}

# Get repository root, with fallback for non-git repositories
# Find repository root by searching upward for .specify directory
# This is the primary marker for spec-kit projects
find_specify_root() {
    local dir="${1:-$(pwd)}"
    # Normalize to absolute path to prevent infinite loop with relative paths
    # Use -- to handle paths starting with - (e.g., -P, -L)
    dir="$(cd -- "$dir" 2>/dev/null && pwd)" || return 1
    local prev_dir=""
    while true; do
        if [ -d "$dir/.specify" ]; then
            echo "$dir"
            return 0
        fi

        # Stop if we've reached filesystem root or dirname stops changing
        if [ "$dir" = "/" ] || [ "$dir" = "$prev_dir" ]; then
            break
        fi
        prev_dir="$dir"
        dir="$(dirname "$dir")"
    done
    return 1
}

# Resolve an explicit SPECIFY_INIT_DIR project override (the directory that
# *contains* .specify/), for non-interactive / CI use — e.g. running a Spec Kit
# command against a member project from a monorepo root without cd.
#
# Precondition: SPECIFY_INIT_DIR is non-empty. Echoes the validated absolute
# project root, or prints an error and returns 1. Strict by design: the path
# must exist and contain .specify/, with no silent fallback to cwd or the
# script-location default (which would silently write to the wrong project).
#
# This is the single resolver: bundled extensions inherit it by sourcing core
# (e.g. the git extension's create-new-feature-branch) rather than duplicating it.
resolve_specify_init_dir() {
    local init_root
    # Normalize: relative paths resolve against $(pwd); a trailing slash collapses.
    # CDPATH="" so a relative value cannot be resolved against the caller's CDPATH
    # (which would also echo to stdout and corrupt the captured path).
    if ! init_root="$(CDPATH="" cd -- "$SPECIFY_INIT_DIR" 2>/dev/null && pwd)"; then
        echo "ERROR: SPECIFY_INIT_DIR does not point to an existing directory: $SPECIFY_INIT_DIR" >&2
        return 1
    fi
    if [[ ! -d "$init_root/.specify" ]]; then
        echo "ERROR: SPECIFY_INIT_DIR is not a Spec Kit project (no .specify/ directory): $init_root" >&2
        return 1
    fi
    printf '%s\n' "$init_root"
}

# Get repository root, prioritizing .specify directory
# This prevents using a parent repository when spec-kit is initialized in a subdirectory
get_repo_root() {
    # Explicit project override wins (see resolve_specify_init_dir).
    if [[ -n "${SPECIFY_INIT_DIR:-}" ]]; then
        resolve_specify_init_dir
        return
    fi

    # First, look for .specify directory (spec-kit's own marker)
    local specify_root
    if specify_root=$(find_specify_root); then
        echo "$specify_root"
        return
    fi

    # Final fallback to script location
    local script_dir="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    (cd "$script_dir/../../.." && pwd)
}

# Get current feature name from explicit state only.
# Returns the feature identifier or empty string if none is set.
# Feature state is set by SPECIFY_FEATURE (from create-new-feature or
# the git extension) or implicitly via .specify/feature.json.
get_current_branch() {
    if [[ -n "${SPECIFY_FEATURE:-}" ]]; then
        echo "$SPECIFY_FEATURE"
        return
    fi

    # No explicit feature — caller must handle this via feature.json
    # in get_feature_paths(). Return empty to signal "unknown".
    echo ""
}

spec_kit_branch_pattern_config_path() {
    local repo_root="${1:-$(get_repo_root)}"
    printf '%s\n' "$repo_root/.specify/extensions/git/git-config.yml"
}

spec_kit_branch_pattern_get_scalar() {
    local repo_root="$1"
    local key_path="$2"
    local cfg
    cfg="$(spec_kit_branch_pattern_config_path "$repo_root")"
    [ -f "$cfg" ] || return 1

    if command -v python3 >/dev/null 2>&1; then
        local value
        value=$(python3 - "$cfg" "$key_path" <<'PY' 2>/dev/null || true
import sys

path, key_path = sys.argv[1], sys.argv[2].split('.')
try:
    import yaml
except Exception:
    sys.exit(0)

try:
    with open(path, encoding='utf-8') as fh:
        data = yaml.safe_load(fh) or {}
    cur = data
    for key in key_path:
        if not isinstance(cur, dict) or key not in cur:
            cur = None
            break
        cur = cur[key]
    if cur is None or isinstance(cur, (dict, list)):
        sys.exit(0)
    if isinstance(cur, bool):
        print('true' if cur else 'false')
    else:
        print(str(cur))
except Exception:
    sys.exit(0)
PY
)
        if [ -n "$value" ]; then
            printf '%s\n' "$value"
            return 0
        fi
    fi

    case "$key_path" in
        branch_pattern.enabled)
            grep -E '^[[:space:]]*enabled[[:space:]]*:' "$cfg" 2>/dev/null | tail -1 | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]*#.*//; s/[[:space:]]+$//'
            ;;
        branch_pattern.template)
            grep -E '^[[:space:]]*template[[:space:]]*:' "$cfg" 2>/dev/null | tail -1 | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]*#.*//; s/^['"'"']|['"'"']$//g; s/[[:space:]]+$//'
            ;;
        branch_pattern.number_padding)
            grep -E '^[[:space:]]*number_padding[[:space:]]*:' "$cfg" 2>/dev/null | tail -1 | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]*#.*//; s/[[:space:]]+$//'
            ;;
        branch_pattern.issue_format)
            grep -E '^[[:space:]]*issue_format[[:space:]]*:' "$cfg" 2>/dev/null | tail -1 | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]*#.*//; s/^['"'"']|['"'"']$//g; s/[[:space:]]+$//'
            ;;
        *)
            return 1
            ;;
    esac
}

spec_kit_branch_pattern_allowed_prefixes() {
    local repo_root="$1"
    local cfg
    cfg="$(spec_kit_branch_pattern_config_path "$repo_root")"
    [ -f "$cfg" ] || return 1

    if command -v python3 >/dev/null 2>&1; then
        local values
        values=$(python3 - "$cfg" <<'PY' 2>/dev/null || true
import sys
try:
    import yaml
except Exception:
    sys.exit(0)

try:
    with open(sys.argv[1], encoding='utf-8') as fh:
        data = yaml.safe_load(fh) or {}
    vals = (((data or {}).get('branch_pattern') or {}).get('allowed_prefixes') or [])
    if isinstance(vals, list):
        for item in vals:
            if item is not None:
                print(str(item))
except Exception:
    sys.exit(0)
PY
)
        if [ -n "$values" ]; then
            printf '%s\n' "$values"
            return 0
        fi
    fi

    python3 - "$cfg" <<'PY' 2>/dev/null || true
import re
import sys

path = sys.argv[1]
in_branch_pattern = False
in_allowed_prefixes = False

with open(path, encoding='utf-8') as fh:
    for raw_line in fh:
        line = raw_line.rstrip('\n')
        if re.match(r'^\S', line):
            in_branch_pattern = False
            in_allowed_prefixes = False
        if re.match(r'^\s*branch_pattern\s*:', line):
            in_branch_pattern = True
            continue
        if not in_branch_pattern:
            continue
        if re.match(r'^\s*allowed_prefixes\s*:', line):
            in_allowed_prefixes = True
            continue
        if in_allowed_prefixes:
            match = re.match(r'^\s*-\s*(.+?)\s*(#.*)?$', line)
            if match:
                value = match.group(1).strip().strip('"\'')
                if value:
                    print(value)
                continue
            if re.match(r'^\s*[A-Za-z_]+\s*:', line):
                in_allowed_prefixes = False
PY
}

spec_kit_branch_pattern_enabled() {
    local repo_root="${1:-$(get_repo_root)}"
    local enabled
    enabled="$(spec_kit_branch_pattern_get_scalar "$repo_root" branch_pattern.enabled 2>/dev/null || true)"
    [[ "$enabled" == "true" || "$enabled" == "True" || "$enabled" == "yes" || "$enabled" == "1" ]]
}

spec_kit_issue_key_regex() {
    printf '%s\n' '^[A-Z][A-Z0-9]+-[0-9]+$'
}

spec_kit_normalize_issue_key() {
    local issue="$1"
    printf '%s\n' "$issue" | tr '[:lower:]' '[:upper:]'
}

spec_kit_validate_issue_key() {
    local issue="$1"
    [[ "$issue" =~ $(spec_kit_issue_key_regex) ]]
}

spec_kit_branch_pattern_validation_message() {
    local repo_root="${1:-$(get_repo_root)}"
    local template
    template="$(spec_kit_branch_pattern_get_scalar "$repo_root" branch_pattern.template 2>/dev/null || true)"
    if [ -n "$template" ]; then
        printf 'Feature branches should match configured template: %s\n' "$template"
    else
        printf 'Feature branches should be named like: 001-feature-name, 1234-feature-name, or 20260319-143022-feature-name\n'
    fi
}

spec_kit_extract_feature_identity() {
    local branch_name="$1"
    if [[ "$branch_name" =~ ^([0-9]{8}-[0-9]{6})- ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi
    if [[ "$branch_name" =~ ^([0-9]{3,})- ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi
    if [[ "$branch_name" =~ /([0-9]{8}-[0-9]{6})- ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi
    if [[ "$branch_name" =~ /([0-9]{3,})- ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

spec_kit_branch_matches_configured_pattern() {
    local raw="$1"
    local repo_root="${2:-$(get_repo_root)}"
    local branch template has_prefix has_issue issue_key prefix identity rest prefixes_found=false

    branch="$(spec_kit_effective_branch_name "$raw")"
    template="$(spec_kit_branch_pattern_get_scalar "$repo_root" branch_pattern.template 2>/dev/null || true)"
    [ -n "$template" ] || return 1

    has_prefix=false
    has_issue=false
    [[ "$template" == *"{prefix}"* ]] && has_prefix=true
    [[ "$template" == *"{issue}"* ]] && has_issue=true

    if [ "$has_prefix" = true ]; then
        local prefix_line
        while IFS= read -r prefix_line; do
            [ -n "$prefix_line" ] || continue
            prefixes_found=true
            if [[ "$raw" == "$prefix_line/"* ]]; then
                prefix="$prefix_line"
                break
            fi
        done < <(spec_kit_branch_pattern_allowed_prefixes "$repo_root" 2>/dev/null || true)
        [ "$prefixes_found" = true ] || return 1
        [ -n "$prefix" ] || return 1
    fi

    identity="$(spec_kit_extract_feature_identity "$raw" 2>/dev/null || true)"
    [ -n "$identity" ] || return 1

    if [[ "$branch" == "$identity"-* ]]; then
        rest="${branch#${identity}-}"
    else
        return 1
    fi

    if [ "$has_issue" = true ]; then
        if [[ "$rest" =~ ^([A-Z][A-Z0-9]+-[0-9]+)-(.+)$ ]]; then
            issue_key="${BASH_REMATCH[1]}"
            rest="${BASH_REMATCH[2]}"
        else
            return 1
        fi
        spec_kit_validate_issue_key "$issue_key" || return 1
        [ -n "$rest" ] || return 1
    fi

    [[ "$rest" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]
}

# Strip a single optional path segment (e.g. gitflow "feat/004-name" -> "004-name").
# Only when the full name is exactly two slash-free segments; otherwise returns the raw name.
spec_kit_effective_branch_name() {
    local raw="$1"
    if [[ "$raw" =~ ^([^/]+)/([^/]+)$ ]]; then
        printf '%s\n' "${BASH_REMATCH[2]}"
    else
        printf '%s\n' "$raw"
    fi
}

# Safely read .specify/feature.json's "feature_directory" value.
# Prints the raw value (possibly relative) to stdout, or empty string if the file
# is missing, unparseable, or does not contain the key. Always returns 0 so callers
# under `set -e` cannot be aborted by parser failure.
# Parser order mirrors the historical get_feature_paths behavior: jq -> python3 -> grep/sed.
read_feature_json_feature_directory() {
    local repo_root="$1"
    local fj="$repo_root/.specify/feature.json"
    [[ -f "$fj" ]] || { printf '%s' ''; return 0; }

    # Try parsers in order (jq -> python3 -> grep/sed), falling through on
    # failure. Selection is by *parse success*, not mere availability: on
    # Windows `python3` commonly resolves to the Microsoft Store App Execution
    # Alias stub, which passes `command -v` but fails at runtime (exit 49), so
    # an availability-gated `elif` would pick python3, swallow its failure, and
    # never reach the grep/sed fallback -- leaving feature.json unreadable even
    # though it is valid (issue #3304).
    local _fd=''
    if command -v jq >/dev/null 2>&1; then
        if ! _fd=$(jq -r '.feature_directory // empty' "$fj" 2>/dev/null); then
            _fd=''
        fi
    fi
    if [[ -z "$_fd" ]] && command -v python3 >/dev/null 2>&1; then
        # Use Python so pretty-printed/multi-line JSON still parses correctly.
        if ! _fd=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); v=d.get('feature_directory'); print(v if v else '')" "$fj" 2>/dev/null); then
            _fd=''
        fi
    fi
    if [[ -z "$_fd" ]]; then
        # Last-resort single-line grep/sed fallback. The `|| true` guards against
        # grep returning 1 (no match) aborting under `set -e` / `pipefail`.
        _fd=$( { grep -E '"feature_directory"[[:space:]]*:' "$fj" 2>/dev/null || true; } \
            | head -n 1 \
            | sed -E 's/^[^:]*:[[:space:]]*"([^"]*)".*$/\1/' )
    fi

    printf '%s' "$_fd"
    return 0
}

# Persist a feature_directory value to .specify/feature.json.
# Writes only when the file is missing or the value differs from what's stored.
# Accepts the raw (possibly relative) path — callers should pass the original
# user-supplied value, not the normalized absolute path.
_persist_feature_json() {
    local repo_root="$1"
    local feature_dir_value="$2"
    local fj="$repo_root/.specify/feature.json"

    # Strip repo_root prefix if the value is absolute and under repo_root
    if [[ "$feature_dir_value" == "$repo_root/"* ]]; then
        feature_dir_value="${feature_dir_value#"$repo_root/"}"
    fi

    # Read current value (if any) and skip write when unchanged
    local current_val
    current_val=$(read_feature_json_feature_directory "$repo_root")
    if [[ "$current_val" == "$feature_dir_value" ]]; then
        return 0
    fi

    # Ensure .specify/ directory exists
    mkdir -p "$repo_root/.specify"

    # Write feature.json — prefer jq for safe JSON, fall back to printf
    if command -v jq >/dev/null 2>&1; then
        jq -cn --arg fd "$feature_dir_value" '{feature_directory:$fd}' > "$fj"
    else
        printf '{"feature_directory":"%s"}\n' "$(json_escape "$feature_dir_value")" > "$fj"
    fi
}

get_feature_paths() {
    # Read-only callers (e.g. check-prerequisites.sh --paths-only) pass
    # --no-persist so pure path resolution never writes .specify/feature.json,
    # which would dirty the working tree or overwrite a pinned value (issue #3025).
    local no_persist=false
    if [[ "${1:-}" == "--no-persist" ]]; then
        no_persist=true
        shift
    fi

    # Split decl/assignment so a SPECIFY_INIT_DIR validation failure in
    # get_repo_root propagates as a hard error instead of being masked by `local`.
    local repo_root
    repo_root=$(get_repo_root) || return 1
    local current_branch
    current_branch=$(get_current_branch)

    # Resolve feature directory.  Priority:
    #   1. SPECIFY_FEATURE_DIRECTORY env var (explicit override)
    #   2. .specify/feature.json "feature_directory" key (persisted by specify command)
    #   3. Error — no feature context available
    local feature_dir
    if [[ -n "${SPECIFY_FEATURE_DIRECTORY:-}" ]]; then
        feature_dir="$SPECIFY_FEATURE_DIRECTORY"
        # Normalize relative paths to absolute under repo root
        [[ "$feature_dir" != /* ]] && feature_dir="$repo_root/$feature_dir"
        # Persist to feature.json so future sessions without the env var still
        # work — unless the caller opted out for read-only resolution (#3025).
        if [[ "$no_persist" != true ]]; then
            _persist_feature_json "$repo_root" "$SPECIFY_FEATURE_DIRECTORY"
        fi
    elif [[ -f "$repo_root/.specify/feature.json" ]]; then
        local _fd
        _fd=$(read_feature_json_feature_directory "$repo_root")
        if [[ -n "$_fd" ]]; then
            feature_dir="$_fd"
            # Normalize relative paths to absolute under repo root
            [[ "$feature_dir" != /* ]] && feature_dir="$repo_root/$feature_dir"
        else
            echo "ERROR: Feature directory not found. Set SPECIFY_FEATURE_DIRECTORY or ensure .specify/feature.json contains feature_directory." >&2
            return 1
        fi
    else
        echo "ERROR: Feature directory not found. Set SPECIFY_FEATURE_DIRECTORY or run the specify command to create .specify/feature.json." >&2
        return 1
    fi

    # When no branch context exists (no SPECIFY_FEATURE, feature resolved via
    # SPECIFY_FEATURE_DIRECTORY or feature.json), fall back to the feature
    # directory basename so CURRENT_BRANCH is a usable identifier rather than
    # an empty, misleading value (issue #3026).
    if [[ -z "$current_branch" ]]; then
        local feature_dir_trimmed="${feature_dir%/}"
        current_branch="${feature_dir_trimmed##*/}"
    fi

    # Project-level governance documents
    local memory_dir="$repo_root/.specify/memory"
    local constitution_file="$memory_dir/constitution.md"

    # Use printf '%q' to safely quote values, preventing shell injection
    # via crafted branch names or paths containing special characters
    printf 'REPO_ROOT=%q\n' "$repo_root"
    printf 'CURRENT_BRANCH=%q\n' "$current_branch"
    printf 'FEATURE_DIR=%q\n' "$feature_dir"
    printf 'FEATURE_SPEC=%q\n' "$feature_dir/spec.md"
    printf 'IMPL_PLAN=%q\n' "$feature_dir/plan.md"
    printf 'TASKS=%q\n' "$feature_dir/tasks.md"
    printf 'RESEARCH=%q\n' "$feature_dir/research.md"
    printf 'DATA_MODEL=%q\n' "$feature_dir/data-model.md"
    printf 'QUICKSTART=%q\n' "$feature_dir/quickstart.md"
    printf 'CONTRACTS_DIR=%q\n' "$feature_dir/contracts"
    printf 'TEAM_DIRECTIVES=%q\n' "${SPECIFY_TEAM_DIRECTIVES:-}"
    printf 'CONSTITUTION=%q\n' "$constitution_file"
}

# Check if jq is available for safe JSON construction
has_jq() {
    command -v jq >/dev/null 2>&1
}

get_invoke_separator() {
    local repo_root="${1:-$(get_repo_root)}"
    if [[ "${_SPECIFY_INVOKE_SEPARATOR_CACHE_REPO_ROOT:-}" == "$repo_root" && -n "${_SPECIFY_INVOKE_SEPARATOR_CACHE_VALUE:-}" ]]; then
        printf '%s\n' "$_SPECIFY_INVOKE_SEPARATOR_CACHE_VALUE"
        return 0
    fi

    local integration_json="$repo_root/.specify/integration.json"
    local separator="."
    local parsed=0

    if [[ -f "$integration_json" ]]; then
        # Try parsers in order (jq -> python3 -> awk), falling through on
        # failure. Selection is by *parse success*, not mere availability: on
        # Windows `python3` commonly resolves to the Microsoft Store App
        # Execution Alias stub, which passes `command -v` but fails at runtime
        # (exit 49). An availability-gated branch would pick python3, swallow
        # its failure, and — because this function historically had no text
        # fallback — silently return "." even for `-`-separator integrations
        # (e.g. forge, cline), yielding wrong command hints (issue #3304).
        if command -v jq >/dev/null 2>&1; then
            local jq_separator
            if jq_separator=$(jq -r '(.default_integration // .integration // "") as $k | if $k == "" then "." else (.integration_settings[$k].invoke_separator // ".") end' "$integration_json" 2>/dev/null); then
                case "$jq_separator" in
                    "."|"-") separator="$jq_separator"; parsed=1 ;;
                esac
            fi
        fi

        if [[ "$parsed" -eq 0 ]] && command -v python3 >/dev/null 2>&1; then
            local py_separator
            if py_separator=$(python3 - "$integration_json" <<'PY' 2>/dev/null
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        state = json.load(fh)
    key = state.get("default_integration") or state.get("integration") or ""
    settings = state.get("integration_settings")
    separator = "."
    if isinstance(key, str) and isinstance(settings, dict):
        entry = settings.get(key)
        if isinstance(entry, dict) and entry.get("invoke_separator") in {".", "-"}:
            separator = entry["invoke_separator"]
    print(separator)
except Exception:
    sys.exit(1)
PY
); then
                case "$py_separator" in
                    "."|"-") separator="$py_separator"; parsed=1 ;;
                esac
            fi
        fi

        if [[ "$parsed" -eq 0 ]]; then
            # Last-resort text fallback for environments with neither jq nor a
            # working python3 (e.g. stock Windows + Git Bash). Reads the active
            # integration key (default_integration, else integration) and its
            # invoke_separator from within the integration_settings object.
            # Handles both pretty-printed (the written form) and compact JSON.
            # Accumulate all lines into one buffer in END rather than using
            # gawk-only whole-file slurp (RS="^$"), so this stays portable to
            # the BSD awk on macOS.
            local awk_separator
            awk_separator=$(awk '
                function keyval(d, name,   v) {
                    if (match(d, "\"" name "\"[ \t\r\n]*:[ \t\r\n]*\"[^\"]*\"")) {
                        v=substr(d,RSTART,RLENGTH); sub(/^.*:[ \t\r\n]*"/,"",v); sub(/"$/,"",v); return v
                    }
                    return ""
                }
                { doc = doc $0 "\n" }
                END {
                    key=keyval(doc,"default_integration"); if (key=="") key=keyval(doc,"integration")
                    sep="."
                    if (key!="") {
                        settings=doc
                        if (match(doc, /"integration_settings"[ \t\r\n]*:[ \t\r\n]*[{]/)) {
                            settings=substr(doc, RSTART+RLENGTH-1)
                        }
                        if (match(settings, "\"" key "\"[ \t\r\n]*:[ \t\r\n]*[{]")) {
                            start=RSTART+RLENGTH-1
                            depth=0
                            obj=""
                            for (i=start; i<=length(settings); i++) {
                                c=substr(settings,i,1)
                                obj=obj c
                                if (c=="{") depth++
                                else if (c=="}") { depth--; if (depth==0) break }
                            }
                            if (match(obj, /"invoke_separator"[ \t\r\n]*:[ \t\r\n]*"[-.]"/)) {
                                tok=substr(obj,RSTART,RLENGTH); s=substr(tok,length(tok)-1,1)
                                if (s=="." || s=="-") sep=s
                            }
                        }
                    }
                    print sep
                }
            ' "$integration_json" 2>/dev/null)
            case "$awk_separator" in
                "."|"-") separator="$awk_separator" ;;
            esac
        fi
    fi

    _SPECIFY_INVOKE_SEPARATOR_CACHE_REPO_ROOT="$repo_root"
    _SPECIFY_INVOKE_SEPARATOR_CACHE_VALUE="$separator"
    printf '%s\n' "$separator"
}

format_speckit_command() {
    local command_name="$1"
    local repo_root="${2:-$(get_repo_root)}"
    local separator
    if [[ "${_SPECIFY_INVOKE_SEPARATOR_CACHE_REPO_ROOT:-}" == "$repo_root" && -n "${_SPECIFY_INVOKE_SEPARATOR_CACHE_VALUE:-}" ]]; then
        separator="$_SPECIFY_INVOKE_SEPARATOR_CACHE_VALUE"
    else
        separator=$(get_invoke_separator "$repo_root")
        _SPECIFY_INVOKE_SEPARATOR_CACHE_REPO_ROOT="$repo_root"
        _SPECIFY_INVOKE_SEPARATOR_CACHE_VALUE="$separator"
    fi

    command_name="${command_name#/}"
    command_name="${command_name#speckit.}"
    command_name="${command_name#speckit-}"
    command_name="${command_name//./$separator}"

    printf '/speckit%s%s\n' "$separator" "$command_name"
}

# Escape a string for safe embedding in a JSON value (fallback when jq is unavailable).
# Handles backslash, double-quote, and JSON-required control character escapes (RFC 8259).
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\b'/\\b}"
    s="${s//$'\f'/\\f}"
    # Escape any remaining U+0001-U+001F control characters as \uXXXX.
    # (U+0000/NUL cannot appear in bash strings and is excluded.)
    # LC_ALL=C ensures ${#s} counts bytes and ${s:$i:1} yields single bytes,
    # so multi-byte UTF-8 sequences (first byte >= 0xC0) pass through intact.
    local LC_ALL=C
    local i char code
    for (( i=0; i<${#s}; i++ )); do
        char="${s:$i:1}"
        printf -v code '%d' "'$char" 2>/dev/null || code=256
        if (( code >= 1 && code <= 31 )); then
            printf '\\u%04x' "$code"
        else
            printf '%s' "$char"
        fi
    done
}

check_file() { [[ -f "$1" ]] && echo "  ✓ $2" || echo "  ✗ $2"; }
check_dir() { [[ -d "$1" && -n $(ls -A "$1" 2>/dev/null) ]] && echo "  ✓ $2" || echo "  ✗ $2"; }

# Extract constitution principles and constraints
# Returns JSON array of rules
extract_constitution_rules() {
    local constitution_file="$1"
    
    if [[ ! -f "$constitution_file" ]]; then
        echo "[]"
        return
    fi
    
    python3 - "$constitution_file" <<'PY'
import json
import sys
from pathlib import Path

constitution_file = Path(sys.argv[1])
rules = []

try:
    content = constitution_file.read_text()
    
    # Extract principles (lines starting with "- **Principle")
    for line in content.split('\n'):
        if line.strip().startswith('- **Principle') or line.strip().startswith('- **PRINCIPLE'):
            rules.append({
                'type': 'principle',
                'text': line.strip()
            })
        elif line.strip().startswith('- **Constraint') or line.strip().startswith('- **CONSTRAINT'):
            rules.append({
                'type': 'constraint',
                'text': line.strip()
            })
        elif line.strip().startswith('- **Pattern') or line.strip().startswith('- **PATTERN'):
            rules.append({
                'type': 'pattern',
                'text': line.strip()
            })
    
    print(json.dumps(rules, ensure_ascii=False))
except Exception as e:
    print('[]')
PY
}

# Extract architecture viewpoints from architecture.md
# Returns JSON with view names and component counts
extract_architecture_views() {
    local architecture_file="$1"
    
    if [[ ! -f "$architecture_file" ]]; then
        echo "{}"
        return
    fi
    
    python3 - "$architecture_file" <<'PY'
import json
import sys
from pathlib import Path
import re

architecture_file = Path(sys.argv[1])
views = {}

try:
    content = architecture_file.read_text()
    
    # Track which views are present
    view_patterns = {
        'context': r'###\s+3\.1\s+Context\s+View',
        'functional': r'###\s+3\.2\s+Functional\s+View',
        'information': r'###\s+3\.3\s+Information\s+View',
        'concurrency': r'###\s+3\.4\s+Concurrency\s+View',
        'development': r'###\s+3\.5\s+Development\s+View',
        'deployment': r'###\s+3\.6\s+Deployment\s+View',
        'operational': r'###\s+3\.7\s+Operational\s+View'
    }
    
    for view_name, pattern in view_patterns.items():
        if re.search(pattern, content, re.IGNORECASE):
            views[view_name] = {'present': True}
        else:
            views[view_name] = {'present': False}
    
    print(json.dumps(views, ensure_ascii=False))
except Exception as e:
    print('[]')
PY
}

# Extract diagram blocks from architecture.md
# Returns JSON array of diagrams with type and format
extract_architecture_diagrams() {
    local architecture_file="$1"
    
    if [[ ! -f "$architecture_file" ]]; then
        echo "[]"
        return
    fi
    
    python3 - "$architecture_file" <<'PY'
import json
import sys
from pathlib import Path
import re

architecture_file = Path(sys.argv[1])
diagrams = []

try:
    content = architecture_file.read_text()
    
    # Find all code blocks (mermaid or text)
    code_block_pattern = r'```(mermaid|text)\n(.*?)\n```'
    
    for match in re.finditer(code_block_pattern, content, re.DOTALL):
        diagram_format = match.group(1)
        diagram_content = match.group(2)
        
        # Try to determine which view this diagram belongs to by context
        start_pos = match.start()
        preceding_text = content[:start_pos]
        
        # Find the most recent view heading
        view_match = None
        for view_pattern in [
            r'###\s+3\.1\s+Context\s+View',
            r'###\s+3\.2\s+Functional\s+View',
            r'###\s+3\.3\s+Information\s+View',
            r'###\s+3\.4\s+Concurrency\s+View',
            r'###\s+3\.5\s+Development\s+View',
            r'###\s+3\.6\s+Deployment\s+View',
            r'###\s+3\.7\s+Operational\s+View'
        ]:
            matches = list(re.finditer(view_pattern, preceding_text, re.IGNORECASE))
            if matches:
                view_match = matches[-1].group()
                break
        
        view_name = 'unknown'
        if view_match:
            if 'Context' in view_match:
                view_name = 'context'
            elif 'Functional' in view_match:
                view_name = 'functional'
            elif 'Information' in view_match:
                view_name = 'information'
            elif 'Concurrency' in view_match:
                view_name = 'concurrency'
            elif 'Development' in view_match:
                view_name = 'development'
            elif 'Deployment' in view_match:
                view_name = 'deployment'
            elif 'Operational' in view_match:
                view_name = 'operational'
        
        diagrams.append({
            'view': view_name,
            'format': diagram_format,
            'line_count': len(diagram_content.split('\n'))
        })
    
    print(json.dumps(diagrams, ensure_ascii=False))
except Exception as e:
    print('[]')
PY
}


# Resolve a template name to a file path using the priority stack:
#   1. .specify/templates/overrides/
#   2. .specify/presets/<preset-id>/templates/ (sorted by priority from .registry)
#   3. .specify/extensions/<ext-id>/templates/
#   4. .specify/templates/ (core)
resolve_template() {
    local template_name="$1"
    local repo_root="$2"
    local base="$repo_root/.specify/templates"

    # Priority 1: Project overrides
    local override="$base/overrides/${template_name}.md"
    [ -f "$override" ] && echo "$override" && return 0

    # Priority 2: Installed presets (sorted by priority from .registry)
    local presets_dir="$repo_root/.specify/presets"
    if [ -d "$presets_dir" ]; then
        local registry_file="$presets_dir/.registry"
        if [ -f "$registry_file" ] && command -v python3 >/dev/null 2>&1; then
            # Read preset IDs sorted by priority (lower number = higher precedence).
            # The python3 call is wrapped in an if-condition so that set -e does not
            # abort the function when python3 exits non-zero (e.g. invalid JSON).
            local sorted_presets=""
            if sorted_presets=$(SPECKIT_REGISTRY="$registry_file" python3 -c "
import json, sys, os
try:
    with open(os.environ['SPECKIT_REGISTRY']) as f:
        data = json.load(f)
    presets = data.get('presets', {})
    for pid, meta in sorted(presets.items(), key=lambda x: x[1].get('priority', 10) if isinstance(x[1], dict) else 10):
        if isinstance(meta, dict) and meta.get('enabled', True) is not False:
            print(pid)
except Exception:
    sys.exit(1)
" 2>/dev/null); then
                if [ -n "$sorted_presets" ]; then
                    # python3 succeeded and returned preset IDs — search in priority order
                    while IFS= read -r preset_id; do
                        local candidate="$presets_dir/$preset_id/templates/${template_name}.md"
                        [ -f "$candidate" ] && echo "$candidate" && return 0
                    done <<< "$sorted_presets"
                fi
                # python3 succeeded but registry has no presets — nothing to search
            else
                # python3 failed (missing, or registry parse error) — fall back to unordered directory scan
                for preset in "$presets_dir"/*/; do
                    [ -d "$preset" ] || continue
                    local candidate="$preset/templates/${template_name}.md"
                    [ -f "$candidate" ] && echo "$candidate" && return 0
                done
            fi
        else
            # Fallback: alphabetical directory order (no python3 available)
            for preset in "$presets_dir"/*/; do
                [ -d "$preset" ] || continue
                local candidate="$preset/templates/${template_name}.md"
                [ -f "$candidate" ] && echo "$candidate" && return 0
            done
        fi
    fi

    # Priority 3: Extension-provided templates
    local ext_dir="$repo_root/.specify/extensions"
    if [ -d "$ext_dir" ]; then
        for ext in "$ext_dir"/*/; do
            [ -d "$ext" ] || continue
            # Skip hidden directories (e.g. .backup, .cache)
            case "$(basename "$ext")" in .*) continue;; esac
            local candidate="$ext/templates/${template_name}.md"
            [ -f "$candidate" ] && echo "$candidate" && return 0
        done
    fi

    # Priority 4: Core templates (initialized projects)
    local core="$base/${template_name}.md"
    [ -f "$core" ] && echo "$core" && return 0

    # Priority 5: Repo-root templates (source repo / development fallback)
    local repo_templates="$repo_root/templates/${template_name}.md"
    [ -f "$repo_templates" ] && echo "$repo_templates" && return 0

    # Template not found in any location.
    # Return 1 so callers can distinguish "not found" from "found".
    # Callers running under set -e should use: TEMPLATE=$(resolve_template ...) || true
    return 1
}

# Resolve team-ai-directives path for extensions like levelup
# Priority:
#   1. SPECIFY_TEAM_DIRECTIVES environment variable (manual override)
#   2. .specify/init-options.json → team_ai_directives (from specify init)
#   3. .specify/extensions/team-ai-directives (installed extension)
load_team_directives_config() {
    local repo_root="${1:-$(get_repo_root)}"
    
    # 1. Environment variable (manual override)
    if [[ -n "${SPECIFY_TEAM_DIRECTIVES:-}" ]]; then
        return 0
    fi
    
    # 2. init-options.json (from specify init --team-ai-directives)
    local init_opts="$repo_root/.specify/init-options.json"
    if [[ -f "$init_opts" ]] && command -v python3 >/dev/null 2>&1; then
        local path
        path=$(python3 -c "import json, sys; print(json.load(open('$init_opts')).get('team_ai_directives', ''))" 2>/dev/null)
        if [[ -n "$path" && -d "$path" ]]; then
            export SPECIFY_TEAM_DIRECTIVES="$path"
            return 0
        fi
    fi
    
    # 3. Installed extension (default location)
    if [[ -d "$repo_root/.specify/extensions/team-ai-directives" ]]; then
        export SPECIFY_TEAM_DIRECTIVES="$repo_root/.specify/extensions/team-ai-directives"
    fi
}
