#!/usr/bin/env bash

# Generate risk-based test tasks from extracted risks
#
# This script takes risk data (JSON) and generates corresponding test tasks
# based on risk severity and category.
#
# Usage: ./generate-risk-tests.sh <risks_json>
#
# Input: JSON array of risks [{"id": "...", "severity": "High", ...}]
# Output: Markdown-formatted test tasks

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Test case templates by severity and category
declare -A TEST_TEMPLATES

TEST_TEMPLATES[Critical,security]="
- [ ] **SECURITY TEST**: Implement authentication bypass prevention for {description}
- [ ] **SECURITY TEST**: Add input validation tests for {description}
- [ ] **SECURITY TEST**: Verify audit logging for {description}
- [ ] **INTEGRATION TEST**: Test security controls integration for {description}"

TEST_TEMPLATES[Critical,performance]="
- [ ] **PERFORMANCE TEST**: Implement load testing for {description}
- [ ] **PERFORMANCE TEST**: Add stress testing for {description}
- [ ] **PERFORMANCE TEST**: Verify performance benchmarks for {description}"

TEST_TEMPLATES[Critical,data]="
- [ ] **DATA INTEGRITY TEST**: Implement data validation for {description}
- [ ] **DATA INTEGRITY TEST**: Add rollback testing for {description}
- [ ] **DATA INTEGRITY TEST**: Verify data consistency for {description}"

TEST_TEMPLATES[High,security]="
- [ ] **SECURITY TEST**: Add authorization tests for {description}
- [ ] **INTEGRATION TEST**: Test secure API endpoints for {description}"

TEST_TEMPLATES[High,performance]="
- [ ] **PERFORMANCE TEST**: Add response time validation for {description}
- [ ] **PERFORMANCE TEST**: Implement concurrency testing for {description}"

TEST_TEMPLATES[High,data]="
- [ ] **DATA TEST**: Add data migration testing for {description}
- [ ] **DATA TEST**: Verify backup/restore for {description}"

TEST_TEMPLATES[Medium,security]="
- [ ] **SECURITY TEST**: Add basic access control tests for {description}"

TEST_TEMPLATES[Medium,performance]="
- [ ] **PERFORMANCE TEST**: Add basic load validation for {description}"

TEST_TEMPLATES[Medium,data]="
- [ ] **DATA TEST**: Add data integrity checks for {description}"

TEST_TEMPLATES[Low,ux]="
- [ ] **UI TEST**: Add accessibility testing for {description}
- [ ] **UI TEST**: Verify error handling UX for {description}"

TEST_TEMPLATES[Low,functional]="
- [ ] **FUNCTIONAL TEST**: Add edge case validation for {description}"

generate_test_tasks() {
    local risks_json="$1"

    # Parse risks and generate tasks
    python3 - "$risks_json" <<'PY'
import json
import sys
import re

risks_json = sys.argv[1]
risks = json.loads(risks_json)

# Test templates (embedded from bash)
templates = {
    "Critical,security": "\n- [ ] **SECURITY TEST**: Implement authentication bypass prevention for {description}\n- [ ] **SECURITY TEST**: Add input validation tests for {description}\n- [ ] **SECURITY TEST**: Verify audit logging for {description}\n- [ ] **INTEGRATION TEST**: Test security controls integration for {description}",
    "Critical,performance": "\n- [ ] **PERFORMANCE TEST**: Implement load testing for {description}\n- [ ] **PERFORMANCE TEST**: Add stress testing for {description}\n- [ ] **PERFORMANCE TEST**: Verify performance benchmarks for {description}",
    "Critical,data": "\n- [ ] **DATA INTEGRITY TEST**: Implement data validation for {description}\n- [ ] **DATA INTEGRITY TEST**: Add rollback testing for {description}\n- [ ] **DATA INTEGRITY TEST**: Verify data consistency for {description}",
    "High,security": "\n- [ ] **SECURITY TEST**: Add authorization tests for {description}\n- [ ] **INTEGRATION TEST**: Test secure API endpoints for {description}",
    "High,performance": "\n- [ ] **PERFORMANCE TEST**: Add response time validation for {description}\n- [ ] **PERFORMANCE TEST**: Implement concurrency testing for {description}",
    "High,data": "\n- [ ] **DATA TEST**: Add data migration testing for {description}\n- [ ] **DATA TEST**: Verify backup/restore for {description}",
    "Medium,security": "\n- [ ] **SECURITY TEST**: Add basic access control tests for {description}",
    "Medium,performance": "\n- [ ] **PERFORMANCE TEST**: Add basic load validation for {description}",
    "Medium,data": "\n- [ ] **DATA TEST**: Add data integrity checks for {description}",
    "Low,ux": "\n- [ ] **UI TEST**: Add accessibility testing for {description}\n- [ ] **UI TEST**: Verify error handling UX for {description}",
    "Low,functional": "\n- [ ] **FUNCTIONAL TEST**: Add edge case validation for {description}"
}

def get_category(description):
    desc = description.lower()
    if any(word in desc for word in ["security", "auth", "access", "vulnerability"]):
        return "security"
    elif any(word in desc for word in ["performance", "speed", "load", "latency"]):
        return "performance"
    elif any(word in desc for word in ["data", "database", "integrity", "consistency"]):
        return "data"
    elif any(word in desc for word in ["ui", "ux", "interface", "user"]):
        return "ux"
    else:
        return "functional"

print("## Risk-Based Test Tasks")
print()
print("Generated test tasks to mitigate identified risks:")
print()

for risk in risks:
    risk_id = risk.get("id", "unknown")
    severity = risk.get("severity", "Medium")
    description = risk.get("description", risk.get("risk", "Unknown risk"))
    category = get_category(description)

    key = f"{severity},{category}"
    template = templates.get(key, templates.get(f"{severity},functional", "\n- [ ] **FUNCTIONAL TEST**: Add validation test for {description}"))

    print(f"### Risk {risk_id} ({severity} - {category})")
    print(f"**Description**: {description}")
    print("**Test Tasks**:")
    print(template.format(description=description))
    print()

PY
}

if [[ $# -eq 1 ]]; then
    risks_json="$1"
elif [[ $# -eq 0 ]]; then
    # Read from stdin
    risks_json=$(cat)
else
    echo "Usage: $0 [risks_json]" >&2
    echo "If no argument provided, reads from stdin" >&2
    exit 1
fi

generate_test_tasks "$risks_json"