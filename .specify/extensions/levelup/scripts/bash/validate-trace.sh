#!/usr/bin/env bash

# Validate AI session trace completeness and quality
# This script checks trace.md for section completeness, quality gate statistics,
# and provides recommendations for improvement.

set -e

JSON_MODE=false
TRACE_FILE=""

for arg in "$@"; do
    case "$arg" in
        --json)
            JSON_MODE=true
            ;;
        --help|-h)
            echo "Usage: $0 [--json] [trace_file]"
            echo "  --json        Output results in JSON format"
            echo "  trace_file    Path to trace.md (default: current feature trace)"
            echo "  --help        Show this help message"
            exit 0
            ;;
        *)
            TRACE_FILE="$arg"
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

# If no trace file specified, use current feature trace
if [[ -z "$TRACE_FILE" ]]; then
    eval $(get_feature_paths)
    check_feature_branch "$CURRENT_BRANCH" "$HAS_GIT" || exit 1
    TRACE_FILE="$FEATURE_DIR/trace.md"
fi

# Check if trace exists
if [[ ! -f "$TRACE_FILE" ]]; then
    if $JSON_MODE; then
        printf '{"valid":false,"error":"Trace file not found: %s"}\n' "$TRACE_FILE"
    else
        echo "ERROR: Trace file not found: $TRACE_FILE" >&2
        echo "Run /spec.trace to generate a session trace." >&2
    fi
    exit 1
fi

# Validation functions
validate_section() {
    local section_name="$1"
    local section_pattern="$2"
    local min_lines="$3"
    
    if ! grep -q "$section_pattern" "$TRACE_FILE"; then
        echo "0"
        return
    fi
    
    local line_count=$(sed -n "/$section_pattern/,/^## /p" "$TRACE_FILE" | wc -l)
    if [[ $line_count -ge $min_lines ]]; then
        echo "1"
    else
        echo "0"
    fi
}

# Validate all 6 sections (including Summary)
summary_valid=$(validate_section "Summary" "## Summary" 5)
section1_valid=$(validate_section "Session Overview" "## 1\. Session Overview" 5)
section2_valid=$(validate_section "Decision Patterns" "## 2\. Decision Patterns" 5)
section3_valid=$(validate_section "Execution Context" "## 3\. Execution Context" 5)
section4_valid=$(validate_section "Reusable Patterns" "## 4\. Reusable Patterns" 5)
section5_valid=$(validate_section "Evidence Links" "## 5\. Evidence Links" 5)

sections_valid=$((summary_valid + section1_valid + section2_valid + section3_valid + section4_valid + section5_valid))
total_sections=6
coverage_pct=$((sections_valid * 100 / total_sections))

# Validate Summary subsections
problem_valid=0
decisions_valid=0
solution_valid=0

if grep -q "### Problem" "$TRACE_FILE"; then
    problem_lines=$(sed -n '/### Problem/,/### \|^## /p' "$TRACE_FILE" | wc -l)
    if [[ $problem_lines -ge 2 && $problem_lines -le 5 ]]; then
        problem_valid=1
    fi
fi

if grep -q "### Key Decisions" "$TRACE_FILE"; then
    decision_count=$(sed -n '/### Key Decisions/,/### \|^## /p' "$TRACE_FILE" | grep -c "^[0-9]\.")
    if [[ $decision_count -ge 3 ]]; then
        decisions_valid=1
    fi
fi

if grep -q "### Final Solution" "$TRACE_FILE"; then
    solution_text=$(sed -n '/### Final Solution/,/^---\|^## /p' "$TRACE_FILE")
    if echo "$solution_text" | grep -qi "pass\|coverage\|quality\|delivered"; then
        solution_valid=1
    fi
fi

# Extract quality gate info from trace
quality_gates_info=$(grep -A 3 "^\*\*Quality Gates\*\*:" "$TRACE_FILE" | tail -3 || echo "")
gates_passed=$(echo "$quality_gates_info" | grep "Passed:" | grep -o '[0-9]\+' || echo "0")
gates_failed=$(echo "$quality_gates_info" | grep "Failed:" | grep -o '[0-9]\+' || echo "0")
gates_total=$(echo "$quality_gates_info" | grep "Total:" | grep -o '[0-9]\+' || echo "0")

# Calculate quality gate pass rate
if [[ "$gates_total" -gt 0 ]]; then
    gate_pass_rate=$((gates_passed * 100 / gates_total))
else
    gate_pass_rate=0
fi

# Determine overall validity
is_valid="true"
if [[ $coverage_pct -lt 80 ]]; then
    is_valid="false"
fi

# Generate warnings and recommendations
warnings=()
recommendations=()

if [[ $summary_valid -eq 0 ]]; then
    warnings+=("Summary section missing or incomplete")
    recommendations+=("Add Summary section with Problem, Key Decisions, and Final Solution")
fi

if [[ $problem_valid -eq 0 ]]; then
    warnings+=("Problem statement missing or not concise (should be 1-2 sentences)")
    recommendations+=("Extract problem from spec mission and user stories")
fi

if [[ $decisions_valid -eq 0 ]]; then
    warnings+=("Key Decisions missing or insufficient (need at least 3)")
    recommendations+=("Document architecture, technology, testing, and process decisions")
fi

if [[ $solution_valid -eq 0 ]]; then
    warnings+=("Final Solution missing or lacks metrics")
    recommendations+=("Include outcome statement with quality gate pass rate")
fi

if [[ $section1_valid -eq 0 ]]; then
    warnings+=("Session Overview section missing or incomplete")
    recommendations+=("Add session overview with feature context and key decisions")
fi

if [[ $section2_valid -eq 0 ]]; then
    warnings+=("Decision Patterns section missing or incomplete")
    recommendations+=("Document triage decisions and technology choices")
fi

if [[ $section3_valid -eq 0 ]]; then
    warnings+=("Execution Context section missing or incomplete")
    recommendations+=("Include quality gate statistics and execution mode breakdown")
fi

if [[ $section4_valid -eq 0 ]]; then
    warnings+=("Reusable Patterns section missing or incomplete")
    recommendations+=("Identify effective methodologies and applicable contexts")
fi

if [[ $section5_valid -eq 0 ]]; then
    warnings+=("Evidence Links section missing or incomplete")
    recommendations+=("Add commit references, issue links, and code paths")
fi

if [[ $gate_pass_rate -lt 80 ]] && [[ $gates_total -gt 0 ]]; then
    warnings+=("Low quality gate pass rate: ${gate_pass_rate}%")
    recommendations+=("Review failed quality gates and address test failures")
fi

# Output results
if $JSON_MODE; then
    # Build warnings array
    warnings_json="["
    for i in "${!warnings[@]}"; do
        if [[ $i -gt 0 ]]; then
            warnings_json+=","
        fi
        warnings_json+="\"${warnings[$i]}\""
    done
    warnings_json+="]"
    
    # Build recommendations array
    recommendations_json="["
    for i in "${!recommendations[@]}"; do
        if [[ $i -gt 0 ]]; then
            recommendations_json+=","
        fi
        recommendations_json+="\"${recommendations[$i]}\""
    done
    recommendations_json+="]"
    
    printf '{"valid":%s,"trace_file":"%s","sections_valid":%d,"total_sections":%d,"coverage_pct":%d,"quality_gates":{"passed":%d,"failed":%d,"total":%d,"pass_rate":%d},"warnings":%s,"recommendations":%s}\n' \
        "$is_valid" "$TRACE_FILE" "$sections_valid" "$total_sections" "$coverage_pct" \
        "$gates_passed" "$gates_failed" "$gates_total" "$gate_pass_rate" \
        "$warnings_json" "$recommendations_json"
else
    echo ""
    echo "==================================="
    echo "Trace Validation Report"
    echo "==================================="
    echo ""
    echo "File: $TRACE_FILE"
    echo ""
    echo "Section Completeness:"
    echo "  ✓ Summary:             $([ $summary_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo "    - Problem:          $([ $problem_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo "    - Key Decisions:    $([ $decisions_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo "    - Final Solution:   $([ $solution_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo "  ✓ Session Overview:    $([ $section1_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo "  ✓ Decision Patterns:   $([ $section2_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo "  ✓ Execution Context:   $([ $section3_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo "  ✓ Reusable Patterns:   $([ $section4_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo "  ✓ Evidence Links:      $([ $section5_valid -eq 1 ] && echo '✅' || echo '❌')"
    echo ""
    echo "Coverage: $sections_valid/$total_sections sections ($coverage_pct%)"
    echo ""
    
    if [[ $gates_total -gt 0 ]]; then
        echo "Quality Gates:"
        echo "  Passed: $gates_passed"
        echo "  Failed: $gates_failed"
        echo "  Total:  $gates_total"
        echo "  Pass Rate: $gate_pass_rate%"
        echo ""
    fi
    
    if [[ ${#warnings[@]} -gt 0 ]]; then
        echo "⚠️  Warnings:"
        for warning in "${warnings[@]}"; do
            echo "  - $warning"
        done
        echo ""
    fi
    
    if [[ ${#recommendations[@]} -gt 0 ]]; then
        echo "💡 Recommendations:"
        for rec in "${recommendations[@]}"; do
            echo "  - $rec"
        done
        echo ""
    fi
    
    if [[ "$is_valid" == "true" ]]; then
        echo "✅ Trace validation passed"
    else
        echo "❌ Trace validation failed (coverage < 80%)"
    fi
    echo ""
fi

# Exit with appropriate code
if [[ "$is_valid" == "true" ]]; then
    exit 0
else
    exit 1
fi
