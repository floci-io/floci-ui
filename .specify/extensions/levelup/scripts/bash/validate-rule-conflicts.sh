#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

check_keyword_conflict() {
    local statement_a="$1"
    local statement_b="$2"
    
    local has_must_a=$(echo "$statement_a" | grep -qiE "must|always|require" && echo "yes" || echo "no")
    local has_never_a=$(echo "$statement_a" | grep -qiE "never|must not|prohibited|forbidden|disallow" && echo "yes" || echo "no")
    local has_must_b=$(echo "$statement_b" | grep -qiE "must|always|require" && echo "yes" || echo "no")
    local has_never_b=$(echo "$statement_b" | grep -qiE "never|must not|prohibited|forbidden|disallow" && echo "yes" || echo "no")
    
    if [[ "$has_must_a" == "yes" && "$has_never_b" == "yes" ]]; then
        echo "direct_contradiction"
        return
    fi
    
    if [[ "$has_never_a" == "yes" && "$has_must_b" == "yes" ]]; then
        echo "direct_contradiction"
        return
    fi
    
    echo ""
}

check_numeric_conflict() {
    local statement_a="$1"
    local statement_b="$2"
    
    local time_a=$(echo "$statement_a" | grep -oE "[0-9]+ *(ms|seconds?|minutes?)" || echo "")
    local time_b=$(echo "$statement_b" | grep -oE "[0-9]+ *(ms|seconds?|minutes?)" || echo "")
    
    if [[ -n "$time_a" && -n "$time_b" ]]; then
        local num_a=$(echo "$time_a" | grep -oE "[0-9]+")
        local num_b=$(echo "$time_b" | grep -oE "[0-9]+")
        
        if [[ "$num_a" -lt 50 && "$num_b" -gt 100 ]]; then
            echo "implicit_contradiction"
            return
        fi
    fi
    
    echo ""
}

check_scope_overlap() {
    local statement_a="$1"
    local statement_b="$2"
    
    local keywords_a=($(echo "$statement_a" | grep -oE "\b[a-z]+\b" | sort -u))
    local keywords_b=($(echo "$statement_b" | grep -oE "\b[a-z]+\b" | sort -u))
    
    local common=0
    for word in "${keywords_a[@]}"; do
        for word_b in "${keywords_b[@]}"; do
            if [[ "$word" == "$word_b" && ${#word} -gt 3 ]]; then
                common=$((common + 1))
            fi
        done
    done
    
    if [[ $common -ge 2 ]]; then
        echo "scope_overlap"
        return
    fi
    
    echo ""
}

detect_conflict() {
    local statement_a="$1"
    local statement_b="$2"
    
    local conflict_type
    conflict_type=$(check_keyword_conflict "$statement_a" "$statement_b")
    
    if [[ -n "$conflict_type" ]]; then
        echo "$conflict_type"
        return
    fi
    
    conflict_type=$(check_numeric_conflict "$statement_a" "$statement_b")
    if [[ -n "$conflict_type" ]]; then
        echo "$conflict_type"
        return
    fi
    
    conflict_type=$(check_scope_overlap "$statement_a" "$statement_b")
    echo "$conflict_type"
}

get_severity() {
    local conflict_type="$1"
    
    case "$conflict_type" in
        direct_contradition|constitution_conflict)
            echo "critical"
            ;;
        implicit_contradiction)
            echo "error"
            ;;
        exception_conflict)
            echo "warning"
            ;;
        scope_overlap)
            echo "info"
            ;;
        *)
            echo "info"
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ $# -lt 2 ]]; then
        echo "Usage: $0 <statement_a> <statement_b>" >&2
        exit 1
    fi
    
    detect_conflict "$1" "$2"
fi
