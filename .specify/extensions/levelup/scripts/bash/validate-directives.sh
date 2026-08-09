#!/bin/bash

set -euo pipefail

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

REPO_ROOT="${REPO_ROOT:-$PROJECT_ROOT}"
OUTPUT_FORMAT="json"
SEVERITY_FILTER="info"

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Options:
    --json                  Output JSON format
    --markdown              Output Markdown format
    --severity LEVEL        Minimum severity (critical, error, warning, info)
    --rules-path PATH       Path to rules directory
    -h, --help              Show this help

EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            OUTPUT_FORMAT="json"
            shift
            ;;
        --markdown)
            OUTPUT_FORMAT="markdown"
            shift
            ;;
        --severity)
            SEVERITY_FILTER="$2"
            shift 2
            ;;
        --rules-path)
            RULES_PATH="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

validate_environment() {
    # Use centralized function to load team directives
    load_team_directives_config "$REPO_ROOT"
    TEAM_DIRECTIVES="${SPECIFY_TEAM_DIRECTIVES:-}"
    
    if [[ -z "$TEAM_DIRECTIVES" ]] || [[ ! -d "$TEAM_DIRECTIVES" ]]; then
        echo "Error: team-ai-directives not found. Run 'specify init --team-ai-directives <path>' to configure." >&2
        exit 1
    fi
}

load_constitution() {
    local constitution_path="$TEAM_DIRECTIVES/context_modules/constitution.md"
    
    if [[ ! -f "$constitution_path" ]]; then
        echo "Warning: Constitution not found at $constitution_path" >&2
        echo "[]"
        return
    fi
    
    jq -n '
        [inputs 
        | match("^###?\\s+(.+)$"; "gm") 
        | .captures[0].string 
        | trim 
        | select(length > 0)]
    ' "$constitution_path" 2>/dev/null || echo "[]"
}

extract_frontmatter_field() {
    local file="$1"
    local field="$2"
    awk -v field="$field" '
        NR == 1 && $0 != "---" { exit }
        NR > 1 && $0 == "---" { exit }
        $0 ~ "^" field ":" {
            sub(/^[^:]+:[[:space:]]*/, "");
            print;
            exit
        }
    ' "$file" 2>/dev/null || echo ""
}

load_rules() {
    local rules_dir="${RULES_PATH:-$TEAM_DIRECTIVES/context_modules/rules}"
    
    if [[ ! -d "$rules_dir" ]]; then
        echo "Warning: Rules directory not found at $rules_dir" >&2
        echo "[]"
        return
    fi
    
    local rules_json="[]"
    
    while IFS= read -r -d '' rule_file; do
        local file_path="$rule_file"
        local rule_id=$(basename "$rule_file" .md)
        local rule_type=$(extract_frontmatter_field "$rule_file" "type")
        
        local statements=$(jq -Rs '
            split("\n") 
            | .[] 
            | select(startswith("- ") or startswith("* ") or startswith("1. ") or startswith("2. "))
            | ltrimstr("- ")
            | ltrimstr("* ")
            | ltrimstr("1. ")
            | ltrimstr("2. ")
            | trim
            | select(length > 0)
        ' "$rule_file" 2>/dev/null || echo "")
        
        if [[ -n "$statements" ]]; then
            local statement
            statement=$(echo "$statements" | head -1)
            
            rules_json=$(echo "$rules_json" | jq \
                --arg id "$rule_id" \
                --arg path "$file_path" \
                --arg stmt "$statement" \
                --arg type "$rule_type" \
                '. + [{"id": $id, "file": $path, "statement": $stmt, "type": $type}]')
        fi
    done < <(find "$rules_dir" -name "*.md" -type f -print0)
    
    echo "$rules_json"
}

detect_conflicts() {
    local rules_json="$1"
    
    local conflicts="[]"
    local rule_count=$(echo "$rules_json" | jq 'length')
    
    for i in $(seq 0 $((rule_count - 1))); do
        for j in $(seq $((i + 1)) $((rule_count - 1))); do
            local rule_a=$(echo "$rules_json" | jq -r ".[$i].statement")
            local rule_b=$(echo "$rules_json" | jq -r ".[$j].statement")
            local file_a=$(echo "$rules_json" | jq -r ".[$i].file")
            local file_b=$(echo "$rules_json" | jq -r ".[$j].file")
            
            local conflict_type=""
            local severity="info"
            
            if echo "$rule_a" | grep -qiE "must|always|require"; then
                if echo "$rule_b" | grep -qiE "never|must not|prohibited|forbidden|disallow"; then
                    conflict_type="direct_contradiction"
                    severity="critical"
                fi
            fi
            
            if echo "$rule_a" | grep -qiE "never|must not|prohibited"; then
                if echo "$rule_b" | grep -qiE "must|always|require"; then
                    conflict_type="direct_contradiction"
                    severity="critical"
                fi
            fi
            
            if echo "$rule_a" | grep -qiE "cache" && echo "$rule_b" | grep -qiE "cache"; then
                if echo "$rule_a" | grep -qiE "must.*cache" && echo "$rule_b" | grep -qiE "never.*cache"; then
                    conflict_type="direct_contradiction"
                    severity="critical"
                fi
            fi
            
            if [[ -n "$conflict_type" ]]; then
                local conflict_id="conflict-$(date +%s)-$i-$j"
                
                conflicts=$(echo "$conflicts" | jq \
                    --arg id "$conflict_id" \
                    --arg type "$conflict_type" \
                    --arg sev "$severity" \
                    --arg file_a "$file_a" \
                    --arg stmt_a "$rule_a" \
                    --arg file_b "$file_b" \
                    --arg stmt_b "$rule_b" \
                    '. + [{
                        "id": $id,
                        "type": $type,
                        "severity": $sev,
                        "rule_a": $file_a + ": " + $stmt_a,
                        "rule_b": $file_b + ": " + $stmt_b
                    }]')
            fi
        done
    done
    
    echo "$conflicts"
}

check_constitution_conflicts() {
    local rules_json="$1"
    local constitution_json="$2"
    
    local conflicts="[]"
    
    if [[ "$(echo "$constitution_json" | jq 'length')" -eq 0 ]]; then
        echo "$conflicts"
        return
    fi
    
    local principle
    principle=$(echo "$constitution_json" | jq -r '.[0]' 2>/dev/null || echo "")
    
    if [[ -z "$principle" || "$principle" == "null" ]]; then
        echo "$conflicts"
        return
    fi
    
    local rule_count=$(echo "$rules_json" | jq 'length')
    
    for i in $(seq 0 $((rule_count - 1))); do
        local rule_stmt=$(echo "$rules_json" | jq -r ".[$i].statement")
        local rule_file=$(echo "$rules_json" | jq -r ".[$i].file")
        
        if echo "$rule_stmt" | grep -qiE "cache" && echo "$principle" | grep -qiE "no.*cache|cache.*none"; then
            local conflict_id="constitution-$(date +%s)-$i"
            
            conflicts=$(echo "$conflicts" | jq \
                --arg id "$conflict_id" \
                --arg type "constitution_conflict" \
                --arg sev "critical" \
                --arg file_a "$rule_file" \
                --arg stmt_a "$rule_stmt" \
                --arg principle "$principle" \
                '. + [{
                    "id": $id,
                    "type": $type,
                    "severity": $sev,
                    "rule_a": $file_a + ": " + $stmt_a,
                    "principle": $principle
                }]')
        fi
    done
    
    echo "$conflicts"
}

severity_to_number() {
    case "$1" in
        critical) echo 4 ;;
        error) echo 3 ;;
        warning) echo 2 ;;
        info) echo 1 ;;
        *) echo 0 ;;
    esac
}

filter_by_severity() {
    local conflicts="$1"
    local min_severity=$(severity_to_number "$SEVERITY_FILTER")
    
    local filtered="[]"
    
    local conflict_count=$(echo "$conflicts" | jq 'length')
    for i in $(seq 0 $((conflict_count - 1))); do
        local sev=$(echo "$conflicts" | jq -r ".[$i].severity")
        local sev_num=$(severity_to_number "$sev")
        
        if [[ "$sev_num" -ge "$min_severity" ]]; then
            local conflict_item=$(echo "$conflicts" | jq ".[$i]")
            filtered=$(echo "$filtered" | jq ". + [$conflict_item]")
        fi
    done
    
    echo "$filtered"
}

generate_json_report() {
    local conflicts="$1"
    local rule_count="$2"
    
    local status="ok"
    local conflict_count=$(echo "$conflicts" | jq 'length')
    
    if [[ "$conflict_count" -gt 0 ]]; then
        status="warn"
    fi
    
    local critical_count=0
    local error_count=0
    local warning_count=0
    local info_count=0
    
    for i in $(seq 0 $((conflict_count - 1))); do
        local sev=$(echo "$conflicts" | jq -r ".[$i].severity")
        case "$sev" in
            critical) critical_count=$((critical_count + 1)) ;;
            error) error_count=$((error_count + 1)) ;;
            warning) warning_count=$((warning_count + 1)) ;;
            info) info_count=$((info_count + 1)) ;;
        esac
    done
    
    cat <<EOF
{
  "overall_status": "$status",
  "total_rules": $rule_count,
  "conflicts_detected": $conflict_count,
  "conflicts": $conflicts,
  "severity_summary": {
    "critical": $critical_count,
    "error": $error_count,
    "warning": $warning_count,
    "info": $info_count
  },
  "team_directives": "$TEAM_DIRECTIVES"
}
EOF
}

generate_markdown_report() {
    local conflicts="$1"
    local rule_count="$2"
    local conflict_count=$(echo "$conflicts" | jq 'length')
    
    cat <<EOF
# Rule Conflict Report

**Date**: $(date +%Y-%m-%d)
**Team Directives**: $TEAM_DIRECTIVES

## Summary

| Metric | Count |
|--------|-------|
| Total Rules | $rule_count |
| Conflicts | $conflict_count |

## Conflicts

EOF
    
    if [[ "$conflict_count" -eq 0 ]]; then
        echo "No conflicts detected."
        return
    fi
    
    echo "### Critical"
    echo ""
    echo "| ID | Type | Rule A | Rule B |"
    echo "|----|------|--------|--------|"
    
    local critical_conflicts=$(echo "$conflicts" | jq '[.[] | select(.severity == "critical")]')
    local critical_count=$(echo "$critical_conflicts" | jq 'length')
    
    for i in $(seq 0 $((critical_count - 1))); do
        local id=$(echo "$critical_conflicts" | jq -r ".[$i].id")
        local type=$(echo "$critical_conflicts" | jq -r ".[$i].type")
        local rule_a=$(echo "$critical_conflicts" | jq -r ".[$i].rule_a")
        local rule_b=$(echo "$critical_conflicts" | jq -r ".[$i].rule_b")
        echo "| $id | $type | $rule_a | $rule_b |"
    done
    
    echo ""
    echo "### Errors"
    echo ""
    
    local error_conflicts=$(echo "$conflicts" | jq '[.[] | select(.severity == "error")]')
    local error_count=$(echo "$error_conflicts" | jq 'length')
    
    for i in $(seq 0 $((error_count - 1))); do
        local id=$(echo "$error_conflicts" | jq -r ".[$i].id")
        local type=$(echo "$error_conflicts" | jq -r ".[$i].type")
        local rule_a=$(echo "$error_conflicts" | jq -r ".[$i].rule_a")
        local rule_b=$(echo "$error_conflicts" | jq -r ".[$i].rule_b")
        echo "| $id | $type | $rule_a | $rule_b |"
    done
    
    echo ""
    echo "### Warnings"
    echo ""
    
    local warning_conflicts=$(echo "$conflicts" | jq '[.[] | select(.severity == "warning")]')
    local warning_count=$(echo "$warning_conflicts" | jq 'length')
    
    for i in $(seq 0 $((warning_count - 1))); do
        local id=$(echo "$warning_conflicts" | jq -r ".[$i].id")
        local type=$(echo "$warning_conflicts" | jq -r ".[$i].type")
        local rule_a=$(echo "$warning_conflicts" | jq -r ".[$i].rule_a")
        local rule_b=$(echo "$warning_conflicts" | jq -r ".[$i].rule_b")
        echo "| $id | $type | $rule_a | $rule_b |"
    done
    
    echo ""
    echo "### Info"
    echo ""
    
    local info_conflicts=$(echo "$conflicts" | jq '[.[] | select(.severity == "info")]')
    local info_count=$(echo "$info_conflicts" | jq 'length')
    
    for i in $(seq 0 $((info_count - 1))); do
        local id=$(echo "$info_conflicts" | jq -r ".[$i].id")
        local type=$(echo "$info_conflicts" | jq -r ".[$i].type")
        local rule_a=$(echo "$info_conflicts" | jq -r ".[$i].rule_a")
        local rule_b=$(echo "$info_conflicts" | jq -r ".[$i].rule_b")
        echo "| $id | $type | $rule_a | $rule_b |"
    done
}

main() {
    validate_environment
    
    local constitution_json
    constitution_json=$(load_constitution)
    
    local rules_json
    rules_json=$(load_rules)
    
    local rule_count
    rule_count=$(echo "$rules_json" | jq 'length')
    
    local conflicts
    conflicts=$(detect_conflicts "$rules_json")
    
    local constitution_conflicts
    constitution_conflicts=$(check_constitution_conflicts "$rules_json" "$constitution_json")
    
    local all_conflicts="[]"
    all_conflicts=$(echo "$conflicts $constitution_conflicts" | jq -s 'add')
    
    local filtered_conflicts
    filtered_conflicts=$(filter_by_severity "$all_conflicts")
    
    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        generate_json_report "$filtered_conflicts" "$rule_count"
    else
        generate_markdown_report "$filtered_conflicts" "$rule_count"
    fi
}

main "$@"
