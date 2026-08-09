#!/usr/bin/env bash

set -e

JSON_MODE=false
SUGGESTIONS_MODE=false

for arg in "$@"; do
    case "$arg" in
        --json)
            JSON_MODE=true
            ;;
        --suggestions)
            SUGGESTIONS_MODE=true
            ;;
        --help|-h)
            echo "Usage: $0 [--json] [--suggestions]"
            echo "  --json         Output results in JSON format"
            echo "  --suggestions  Generate constitution suggestions based on scan"
            echo "  --help         Show this help message"
            exit 0
            ;;
    esac
done

# Get script directory and load common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

eval $(get_feature_paths)

# Function to scan for testing patterns
scan_testing_patterns() {
    local repo_root="$1"

    local test_patterns=(
        "test_*.py" "*Test.java" "*.spec.js" "*.test.js" "*_test.go"
        "spec/**/*.rb" "test/**/*.rs" "__tests__/**/*.js"
    )

    local test_frameworks_found=()
    local test_files_count=0

    # Count test files
    for pattern in "${test_patterns[@]}"; do
        count=$(find "$repo_root" -name "$pattern" -type f 2>/dev/null | wc -l)
        test_files_count=$((test_files_count + count))
    done

    # Detect testing frameworks
    if find "$repo_root" -name "package.json" -exec grep -l '"jest"' {} \; 2>/dev/null | grep -q .; then
        test_frameworks_found+=("Jest")
    fi
    if find "$repo_root" -name "pytest.ini" -o -name "setup.cfg" -exec grep -l "pytest" {} \; 2>/dev/null | grep -q .; then
        test_frameworks_found+=("pytest")
    fi
    if find "$repo_root" -name "Cargo.toml" -exec grep -l "testing" {} \; 2>/dev/null | grep -q .; then
        test_frameworks_found+=("Rust testing")
    fi
    if find "$repo_root" -name "*.go" -exec grep -l "testing" {} \; 2>/dev/null | grep -q .; then
        test_frameworks_found+=("Go testing")
    fi

    echo "$test_files_count|${test_frameworks_found[*]}"
}

# Function to scan for security patterns
scan_security_patterns() {
    local repo_root="$1"

    local security_indicators=0
    local auth_patterns=0
    local input_validation=0

    # Check for authentication patterns
    if grep -r "jwt\|oauth\|bearer\|token" "$repo_root" --include="*.py" --include="*.js" --include="*.java" --include="*.go" --include="*.rs" 2>/dev/null | grep -q .; then
        auth_patterns=$((auth_patterns + 1))
    fi

    # Check for input validation
    if grep -r "sanitize\|validate\|escape" "$repo_root" --include="*.py" --include="*.js" --include="*.java" --include="*.go" --include="*.rs" 2>/dev/null | grep -q .; then
        input_validation=$((input_validation + 1))
    fi

    # Check for security-related files
    if find "$repo_root" -name "*security*" -o -name "*auth*" -o -name "*crypto*" 2>/dev/null | grep -q .; then
        security_indicators=$((security_indicators + 1))
    fi

    echo "$auth_patterns|$input_validation|$security_indicators"
}

# Function to scan for documentation patterns
scan_documentation_patterns() {
    local repo_root="$1"

    local readme_count=0
    local api_docs=0
    local inline_comments=0

    # Count README files
    readme_count=$(find "$repo_root" -iname "readme*" -type f 2>/dev/null | wc -l)

    # Check for API documentation
    if find "$repo_root" -name "*api*" -o -name "*docs*" -type d 2>/dev/null | grep -q .; then
        api_docs=1
    fi

    # Sample code files for comment analysis
    local code_files=""
    code_files=$(find "$repo_root" -name "*.py" -o -name "*.js" -o -name "*.java" -o -name "*.go" -o -name "*.rs" | head -10)

    if [[ -n "$code_files" ]]; then
        # Count comment lines in sample files
        local total_lines=0
        local comment_lines=0

        for file in $code_files; do
            if [[ -f "$file" ]]; then
                lines_in_file=$(wc -l < "$file")
                total_lines=$((total_lines + lines_in_file))

                case "${file##*.}" in
                    py)
                        comments_in_file=$(grep -c "^[[:space:]]*#" "$file" 2>/dev/null || echo 0)
                        ;;
                    js)
                        comments_in_file=$(grep -c "^[[:space:]]*//\|/\*" "$file" 2>/dev/null || echo 0)
                        ;;
                    java)
                        comments_in_file=$(grep -c "^[[:space:]]*//\|/\*" "$file" 2>/dev/null || echo 0)
                        ;;
                    go)
                        comments_in_file=$(grep -c "^[[:space:]]*//" "$file" 2>/dev/null || echo 0)
                        ;;
                    rs)
                        comments_in_file=$(grep -c "^[[:space:]]*//\|/\*" "$file" 2>/dev/null || echo 0)
                        ;;
                    *)
                        comments_in_file=0
                        ;;
                esac
                comment_lines=$((comment_lines + comments_in_file))
            fi
        done

        if [[ $total_lines -gt 0 ]]; then
            inline_comments=$((comment_lines * 100 / total_lines))
        fi
    fi

    echo "$readme_count|$api_docs|$inline_comments"
}

# Function to scan for architecture patterns
scan_architecture_patterns() {
    local repo_root="$1"

    local layered_architecture=0
    local modular_structure=0
    local config_management=0

    # Check for layered architecture (common folders)
    if find "$repo_root" -type d \( -name "controllers" -o -name "services" -o -name "models" -o -name "views" \) 2>/dev/null | grep -q .; then
        layered_architecture=1
    fi

    # Check for modular structure
    local dir_count=$(find "$repo_root" -maxdepth 2 -type d | wc -l)
    if [[ $dir_count -gt 10 ]]; then
        modular_structure=1
    fi

    # Check for configuration management
    if find "$repo_root" -name "*.env*" -o -name "config*" -o -name "settings*" 2>/dev/null | grep -q .; then
        config_management=1
    fi

    echo "$layered_architecture|$modular_structure|$config_management"
}

# Function to generate constitution suggestions
generate_constitution_suggestions() {
    local testing_data="$1"
    local security_data="$2"
    local docs_data="$3"
    local arch_data="$4"

    local suggestions=()

    # Parse testing data
    local test_files=""
    local test_frameworks=""
    IFS='|' read -r test_files test_frameworks <<< "$testing_data"

    if [[ $test_files -gt 0 ]]; then
        suggestions+=("**Testing Standards**: Project has $test_files test files using $test_frameworks. Consider mandating test coverage requirements and framework consistency.")
    fi

    # Parse security data
    local auth_patterns=""
    local input_validation=""
    local security_indicators=""
    IFS='|' read -r auth_patterns input_validation security_indicators <<< "$security_data"

    if [[ $auth_patterns -gt 0 || $security_indicators -gt 0 ]]; then
        suggestions+=("**Security by Default**: Project shows security practices. Consider requiring security reviews and input validation standards.")
    fi

    # Parse documentation data
    local readme_count=""
    local api_docs=""
    local comment_percentage=""
    IFS='|' read -r readme_count api_docs comment_percentage <<< "$docs_data"

    if [[ $readme_count -gt 0 ]]; then
        suggestions+=("**Documentation Matters**: Project has $readme_count README files. Consider mandating documentation for APIs and complex logic.")
    fi

    if [[ $comment_percentage -gt 10 ]]; then
        suggestions+=("**Code Comments**: Project shows $comment_percentage% comment density. Consider requiring meaningful comments for complex algorithms.")
    fi

    # Parse architecture data
    local layered=""
    local modular=""
    local config=""
    IFS='|' read -r layered modular config <<< "$arch_data"

    if [[ $layered -gt 0 ]]; then
        suggestions+=("**Architecture Consistency**: Project uses layered architecture. Consider documenting architectural patterns and separation of concerns.")
    fi

    if [[ $modular -gt 0 ]]; then
        suggestions+=("**Modular Design**: Project shows modular organization. Consider requiring modular design principles and dependency management.")
    fi

    if [[ $config -gt 0 ]]; then
        suggestions+=("**Configuration Management**: Project uses configuration files. Consider requiring environment-specific configuration and secrets management.")
    fi

    # Output suggestions
    if [[ ${#suggestions[@]} -gt 0 ]]; then
        echo "Constitution Suggestions Based on Codebase Analysis:"
        echo "=================================================="
        for suggestion in "${suggestions[@]}"; do
            echo "- $suggestion"
        done
    else
        echo "No specific constitution suggestions generated from codebase analysis."
        echo "Consider adding general development principles to your constitution."
    fi
}

# Main logic
if $JSON_MODE; then
    testing=$(scan_testing_patterns "$REPO_ROOT")
    security=$(scan_security_patterns "$REPO_ROOT")
    docs=$(scan_documentation_patterns "$REPO_ROOT")
    arch=$(scan_architecture_patterns "$REPO_ROOT")

    printf '{"testing":"%s","security":"%s","documentation":"%s","architecture":"%s"}\n' \
        "$testing" "$security" "$docs" "$arch"
else
    echo "Scanning project artifacts for constitution patterns..."
    echo ""

    testing=$(scan_testing_patterns "$REPO_ROOT")
    security=$(scan_security_patterns "$REPO_ROOT")
    docs=$(scan_documentation_patterns "$REPO_ROOT")
    arch=$(scan_architecture_patterns "$REPO_ROOT")

    echo "Testing Patterns: $testing"
    echo "Security Patterns: $security"
    echo "Documentation Patterns: $docs"
    echo "Architecture Patterns: $arch"
    echo ""

    if $SUGGESTIONS_MODE; then
        generate_constitution_suggestions "$testing" "$security" "$docs" "$arch"
    fi
fi