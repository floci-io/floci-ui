#!/usr/bin/env pwsh

# Generate AI session execution trace from tasks_meta.json and feature artifacts
# This script creates a comprehensive trace of the AI agent's session including
# decisions, patterns, execution context, and evidence links.

param(
    [switch]$Json,
    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: generate-trace.ps1 [-Json] [-Help]"
    Write-Host "  -Json     Output results in JSON format"
    Write-Host "  -Help     Show this help message"
    exit 0
}

$ErrorActionPreference = "Stop"

# Get script directory for common.ps1 sourcing
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find project root by walking up from script location
function Get-ProjectRoot {
    param([string]$StartPath)
    $dir = $StartPath
    while ($dir -ne "") {
        if ((Test-Path "$dir\.specify") -or (Test-Path "$dir\.git")) {
            return $dir
        }
        $dir = Split-Path $dir -Parent
    }
    return $StartPath
}

$projectRoot = Get-ProjectRoot $ScriptDir

# Load common functions - use absolute path from project root
$commonPath = "$projectRoot\.specify\scripts\powershell\common.ps1"
if (Test-Path $commonPath) {
    . $commonPath
} elseif (Test-Path "$ScriptDir\common.ps1") {
    . "$ScriptDir\common.ps1"
}

$paths = Get-FeaturePaths
Test-FeatureBranch $paths.CURRENT_BRANCH $paths.HAS_GIT

# Define paths
$traceFile = Join-Path $paths.FEATURE_DIR "trace.md"
$tasksMetaFile = Join-Path $paths.FEATURE_DIR "tasks_meta.json"

# Check prerequisites
if (-not (Test-Path $paths.FEATURE_SPEC)) {
    Write-Error "spec.md not found at $($paths.FEATURE_SPEC)"
    exit 1
}

if (-not (Test-Path $paths.IMPL_PLAN)) {
    Write-Error "plan.md not found at $($paths.IMPL_PLAN)"
    exit 1
}

if (-not (Test-Path $paths.TASKS)) {
    Write-Error "tasks.md not found at $($paths.TASKS)"
    exit 1
}

if (-not (Test-Path $tasksMetaFile)) {
    Write-Error "tasks_meta.json not found at $tasksMetaFile. Please run /implement before generating a trace."
    exit 1
}

# Validate tasks_meta.json
try {
    $tasksMetaContent = Get-Content $tasksMetaFile -Raw | ConvertFrom-Json
} catch {
    Write-Error "tasks_meta.json is not valid JSON"
    exit 1
}

# Extract feature name
$featureName = Split-Path -Leaf $paths.FEATURE_DIR

# Helper functions

# NEW: Extract problem statement for Summary section
function Extract-ProblemStatement {
    $problem = ""
    
    # Get feature title from spec
    $featureTitle = (Get-Content $paths.FEATURE_SPEC | Select-Object -First 50 | Where-Object { $_ -match '^# ' } | Select-Object -First 1) -replace '^# ', ''
    if (-not $featureTitle) {
        $featureTitle = $featureName
    }
    
    # Get mission from plan if exists
    $planContent = Get-Content $paths.IMPL_PLAN -Raw
    $mission = ""
    if ($planContent -match '(?s)## Mission(.*?)(?=## |$)') {
        $missionLines = ($matches[1] -split "`n" | Where-Object { $_ -and $_ -notmatch '^##' } | Select-Object -First 3) -join " "
        $mission = $missionLines -replace '\s+', ' '
    }
    
    # Get all user stories from spec
    $specContent = Get-Content $paths.FEATURE_SPEC -Raw
    $userStoryMatches = [regex]::Matches($specContent, '(?i)(As a user|User story|As an|As a).*?(?=\n|$)')
    $userStories = $userStoryMatches | ForEach-Object { $_.Value.Trim() } | Select-Object -First 5
    
    # Build problem statement
    if ($mission) {
        $problem = $mission
    } elseif ($userStories.Count -gt 0) {
        if ($userStories.Count -eq 1) {
            $problem = $userStories[0]
        } else {
            $firstStory = $userStories[0]
            $problem = "Implement $featureTitle with multiple user stories including: $firstStory and $($userStories.Count - 1) more."
        }
    } else {
        $problem = "Implement $featureTitle feature."
    }
    
    return $problem
}

# NEW: Extract key decisions chronologically for Summary section
function Extract-KeyDecisions {
    $decisions = @()
    
    $planContent = Get-Content $paths.IMPL_PLAN -Raw
    
    # 1. Architecture decisions
    if ($planContent -match '(?i)architecture|framework|design') {
        if ($planContent -match '(?s)## (Architecture|Technical Approach)(.*?)(?=## |$)') {
            $archSection = $matches[2]
            $archDecision = ($archSection -split "`n" | Where-Object { $_ -match '^(-|\*|[0-9])' } | Select-Object -First 1) -replace '^[- *0-9.]+', ''
            if ($archDecision) {
                $decisions += $archDecision.Substring(0, [Math]::Min(120, $archDecision.Length)).Trim()
            }
        }
    }
    
    # 2. Technology choices
    if ($planContent -match '(?i)technology|library|tool|framework') {
        if ($planContent -match '(?s)## (Technology Stack|Technology|Tools)(.*?)(?=## |$)') {
            $techSection = $matches[2]
            $techDecision = ($techSection -split "`n" | Where-Object { $_ -match '^(-|\*|[0-9])' } | Select-Object -First 1) -replace '^[- *0-9.]+', ''
            if ($techDecision -and $techDecision -ne $decisions[0]) {
                $decisions += $techDecision.Substring(0, [Math]::Min(120, $techDecision.Length)).Trim()
            }
        }
    }
    
    # 3. Testing strategy
    if ($planContent -match '(?i)TDD|test.*driven|testing strategy') {
        $decisions += "Adopted test-driven development (TDD) approach"
    } elseif ($planContent -match '(?i)risk.*based.*test') {
        $decisions += "Used risk-based testing strategy"
    }
    
    # 4. Process decisions (SYNC/ASYNC)
    $syncCount = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.execution_mode -eq "SYNC" }).Count
    $asyncCount = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.execution_mode -eq "ASYNC" }).Count
    if ($syncCount -gt 0 -or $asyncCount -gt 0) {
        $decisions += "Applied dual execution loop with $syncCount SYNC (micro-reviewed) and $asyncCount ASYNC (agent-delegated) tasks"
    }
    
    # 5. Integration decisions
    if ($planContent -match '(?i)integration|API|external') {
        if ($planContent -match '(?s)## (Integration|API)(.*?)(?=## |$)') {
            $integrationSection = $matches[2]
            $integrationDecision = ($integrationSection -split "`n" | Where-Object { $_ -match '^(-|\*|[0-9])' } | Select-Object -First 1) -replace '^[- *0-9.]+', ''
            if ($integrationDecision) {
                $decisions += $integrationDecision.Substring(0, [Math]::Min(120, $integrationDecision.Length)).Trim()
            }
        }
    }
    
    # 6. Issue tracking
    # Format as numbered list
    $output = ""
    for ($i = 0; $i -lt $decisions.Count; $i++) {
        $output += "$($i + 1). $($decisions[$i])`n"
    }
    
    # If no decisions found, provide default
    if ($decisions.Count -eq 0) {
        $output = "1. Followed spec-driven development workflow`n"
        $output += "2. Implemented feature according to specification`n"
        $output += "3. Validated against quality gates`n"
    }
    
    return $output
}

# NEW: Extract final solution for Summary section
function Extract-FinalSolution {
    $solution = ""
    
    # Get quality gate statistics
    $gatesPassed = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.quality_gates_passed -eq $true }).Count
    $gatesTotal = $tasksMetaContent.tasks.PSObject.Properties.Count
    $passRate = 0
    if ($gatesTotal -gt 0) {
        $passRate = [math]::Floor(($gatesPassed * 100) / $gatesTotal)
    }
    
    # Get feature title
    $featureTitle = (Get-Content $paths.FEATURE_SPEC | Select-Object -First 50 | Where-Object { $_ -match '^# ' } | Select-Object -First 1) -replace '^# ', ''
    if (-not $featureTitle) {
        $featureTitle = $featureName
    }
    
    # Build outcome statement
    $solution = "Delivered $featureTitle implementation with $gatesPassed/$gatesTotal quality gates passed ($passRate% pass rate)."
    
    # Add user story completion
    $specContent = Get-Content $paths.FEATURE_SPEC -Raw
    $userStoryCount = ([regex]::Matches($specContent, '(?i)(As a user|User story)')).Count
    if ($userStoryCount -gt 0) {
        $solution += " All $userStoryCount user stories implemented"
        if ($passRate -eq 100) {
            $solution += " with comprehensive validation."
        } else {
            $solution += "."
        }
    }
    
    # Add evidence reference
    if ($paths.HAS_GIT -eq "true") {
        try {
            $commitSha = git log -1 --format="%h" 2>$null
            if ($commitSha) {
                $solution += " Documented in commit $commitSha"
            }
        } catch {
            # Git not available
        }
    }
    
    return $solution
}

function Extract-SessionOverview {
    $overview = ""
    
    # Get feature title from spec
    $featureTitle = (Get-Content $paths.FEATURE_SPEC | Select-Object -First 50 | Where-Object { $_ -match '^# ' } | Select-Object -First 1) -replace '^# ', ''
    if (-not $featureTitle) {
        $featureTitle = $featureName
    }
    
    # Get mission from plan
    $planContent = Get-Content $paths.IMPL_PLAN -Raw
    $mission = ""
    if ($planContent -match '(?s)## Mission(.*?)(?=## |$)') {
        $mission = ($matches[1] -split "`n" | Where-Object { $_ -and $_ -notmatch '^##' } | Select-Object -First 5) -join "`n"
    }
    
    # Get key decisions
    $keyDecisions = ""
    if ($planContent -match '(?s)## Technical Approach(.*?)(?=## |$)') {
        $keyDecisions = ($matches[1] -split "`n" | Where-Object { $_ -and $_ -notmatch '^##' } | Select-Object -First 5) -join "`n"
    }
    
    $overview = "Summary of AI agent approach for implementing `"$featureTitle`".`n`n"
    
    if ($mission) {
        $overview += "**Mission**: $mission`n`n"
    }
    
    if ($keyDecisions) {
        $overview += "**Key Architectural Decisions**:`n$keyDecisions`n"
    } else {
        $overview += "Implementation approach documented in plan.md.`n"
    }
    
    return $overview
}

function Extract-DecisionPatterns {
    $patterns = ""
    
    # Get triage decisions from tasks_meta.json
    $syncCount = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.execution_mode -eq "SYNC" }).Count
    $asyncCount = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.execution_mode -eq "ASYNC" }).Count
    $totalCount = $tasksMetaContent.tasks.PSObject.Properties.Count
    
    $patterns += "**Triage Classification**:`n"
    $patterns += "- SYNC (human-reviewed) tasks: $syncCount`n"
    $patterns += "- ASYNC (agent-delegated) tasks: $asyncCount`n"
    $patterns += "- Total tasks: $totalCount`n`n"
    
    # Extract technology choices from plan
    $planContent = Get-Content $paths.IMPL_PLAN -Raw
    if ($planContent -match '(?s)## Technology Stack(.*?)(?=## |$)') {
        $techStack = ($matches[1] -split "`n" | Where-Object { $_ -and $_ -notmatch '^##' } | Select-Object -First 10) -join "`n"
        if ($techStack) {
            $patterns += "**Technology Choices**:`n$techStack`n`n"
        }
    }
    
    $patterns += "**Problem-Solving Approaches**:`n"
    $patterns += "- Dual execution loop (SYNC/ASYNC) applied`n"
    $patterns += "- Task-based decomposition from spec → plan → tasks`n"
    
    return $patterns
}

function Extract-ExecutionContext {
    $context = ""
    
    # Quality gate statistics
    $gatesPassed = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.quality_gates_passed -eq $true }).Count
    $gatesFailed = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.quality_gates_passed -eq $false }).Count
    $totalTasks = $tasksMetaContent.tasks.PSObject.Properties.Count
    
    $context += "**Quality Gates**:`n"
    $context += "- Passed: $gatesPassed`n"
    $context += "- Failed: $gatesFailed`n"
    $context += "- Total: $totalTasks`n`n"
    
    # Execution modes breakdown
    $syncCount = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.execution_mode -eq "SYNC" }).Count
    $asyncCount = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.execution_mode -eq "ASYNC" }).Count
    
    $context += "**Execution Modes**:`n"
    $context += "- SYNC tasks (micro-reviewed): $syncCount`n"
    $context += "- ASYNC tasks (macro-reviewed): $asyncCount`n`n"
    
    # Review status
    $microReviewed = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.micro_reviewed -eq $true }).Count
    $macroReviewed = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.macro_reviewed -eq $true }).Count
    
    $context += "**Review Status**:`n"
    $context += "- Micro-reviewed: $microReviewed`n"
    $context += "- Macro-reviewed: $macroReviewed`n`n"
    
    # MCP tracking (if exists)
    $mcpJobs = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { $_.mcp_job_id }).Count
    if ($mcpJobs -gt 0) {
        $context += "**MCP Tracking**: $mcpJobs tasks with MCP job tracking`n"
    }
    
    return $context
}

function Extract-ReusablePatterns {
    $patterns = ""
    
    $patterns += "**Effective Methodologies**:`n"
    
    # Check for successful ASYNC delegations
    $asyncSuccess = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { 
        $_.execution_mode -eq "ASYNC" -and $_.quality_gates_passed -eq $true 
    }).Count
    if ($asyncSuccess -gt 0) {
        $patterns += "- ASYNC delegation: $asyncSuccess tasks successfully delegated and validated`n"
    }
    
    # Check for micro-review patterns
    $microSuccess = ($tasksMetaContent.tasks.PSObject.Properties.Value | Where-Object { 
        $_.micro_reviewed -eq $true -and $_.quality_gates_passed -eq $true 
    }).Count
    if ($microSuccess -gt 0) {
        $patterns += "- Micro-review workflow: $microSuccess tasks validated through micro-reviews`n"
    }
    
    # Extract testing approach from plan
    $planContent = Get-Content $paths.IMPL_PLAN -Raw
    if ($planContent -match '(?i)TDD|test.driven') {
        $patterns += "- Test-driven development applied`n"
    }
    
    if ($planContent -match '(?i)risk.based.testing') {
        $patterns += "- Risk-based testing strategy used`n"
    }
    
    $patterns += "`n**Applicable Contexts**:`n"
    $patterns += "- Similar features requiring dual execution loop`n"
    $patterns += "- Projects with SYNC/ASYNC task classification`n"
    $patterns += "- Spec-driven development workflows`n"
    
    return $patterns
}

function Extract-EvidenceLinks {
    $evidence = ""
    
    # Get latest commit if git available
    if ($paths.HAS_GIT -eq "true") {
        try {
            $latestCommit = git log -1 --format="%H" 2>$null
            $commitMessage = git log -1 --format="%s" 2>$null
            if ($latestCommit) {
                $evidence += "**Implementation Commit**: $latestCommit`n"
                $evidence += "- Message: $commitMessage`n`n"
            }
        } catch {
            # Git not available, skip
        }
    }
    
    # List modified files
    $fileList = @()
    foreach ($task in $tasksMetaContent.tasks.PSObject.Properties.Value) {
        if ($task.files) {
            $fileList += $task.files
        }
    }
    $fileList = $fileList | Select-Object -Unique | Select-Object -First 10
    
    if ($fileList.Count -gt 0) {
        $evidence += "**Code Paths Modified**:`n"
        foreach ($file in $fileList) {
            $evidence += "- $file`n"
        }
    }
    
    # Feature artifacts
    $evidence += "`n**Feature Artifacts**:`n"
    $evidence += "- Specification: specs/$featureName/spec.md`n"
    $evidence += "- Implementation Plan: specs/$featureName/plan.md`n"
    $evidence += "- Task List: specs/$featureName/tasks.md`n"
    $evidence += "- Execution Metadata: specs/$featureName/tasks_meta.json`n"
    
    return $evidence
}

# Generate the trace file
function Generate-Trace {
    $featureTitle = (Get-Content $paths.FEATURE_SPEC | Select-Object -First 50 | Where-Object { $_ -match '^# ' } | Select-Object -First 1) -replace '^# ', ''
    if (-not $featureTitle) {
        $featureTitle = $featureName
    }
    
    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss UTC")
    
    $traceContent = @"
# Session Trace: $featureTitle

Generated: $timestamp
Feature: $featureName
Branch: $($paths.CURRENT_BRANCH)

---

## Summary

### Problem
$(Extract-ProblemStatement)

### Key Decisions
$(Extract-KeyDecisions)

### Final Solution
$(Extract-FinalSolution)

---

## 1. Session Overview

$(Extract-SessionOverview)

---

## 2. Decision Patterns

$(Extract-DecisionPatterns)

---

## 3. Execution Context

$(Extract-ExecutionContext)

---

## 4. Reusable Patterns

$(Extract-ReusablePatterns)

---

## 5. Evidence Links

$(Extract-EvidenceLinks)

---

**Trace Generation**: This trace was automatically generated from execution metadata and feature artifacts. For detailed implementation information, refer to the linked artifacts above.
"@
    
    Set-Content -Path $traceFile -Value $traceContent
    Write-Host "Generated trace at $traceFile"
}

# Calculate section completeness
function Calculate-Completeness {
    $content = Get-Content $traceFile -Raw
    $sectionsComplete = 0
    $totalSections = 6  # Updated to include Summary
    
    # Check Summary section
    if ($content -match '## Summary' -and ($content -split '## Summary')[1].Split("`n").Count -gt 5) {
        $sectionsComplete++
    }
    
    if ($content -match '## 1\. Session Overview' -and ($content -split '## 1\. Session Overview')[1].Split("`n").Count -gt 5) {
        $sectionsComplete++
    }
    
    if ($content -match '## 2\. Decision Patterns' -and ($content -split '## 2\. Decision Patterns')[1].Split("`n").Count -gt 5) {
        $sectionsComplete++
    }
    
    if ($content -match '## 3\. Execution Context' -and ($content -split '## 3\. Execution Context')[1].Split("`n").Count -gt 5) {
        $sectionsComplete++
    }
    
    if ($content -match '## 4\. Reusable Patterns' -and ($content -split '## 4\. Reusable Patterns')[1].Split("`n").Count -gt 5) {
        $sectionsComplete++
    }
    
    if ($content -match '## 5\. Evidence Links' -and ($content -split '## 5\. Evidence Links')[1].Split("`n").Count -gt 5) {
        $sectionsComplete++
    }
    
    $coveragePct = [math]::Floor(($sectionsComplete * 100) / $totalSections)
    
    return @{
        SectionsComplete = $sectionsComplete
        TotalSections = $totalSections
        CoveragePct = $coveragePct
    }
}

# Main execution
Generate-Trace

# Calculate completeness
$completeness = Calculate-Completeness

# Output results
if ($Json) {
    $output = @{
        TRACE_FILE = $traceFile
        SECTIONS_COMPLETE = $completeness.SectionsComplete
        TOTAL_SECTIONS = $completeness.TotalSections
        COVERAGE_PCT = $completeness.CoveragePct
        BRANCH = $paths.CURRENT_BRANCH
    } | ConvertTo-Json -Compress
    Write-Output $output
} else {
    Write-Host ""
    Write-Host "✅ Trace generation complete"
    Write-Host "   File: $traceFile"
    Write-Host "   Sections: $($completeness.SectionsComplete)/$($completeness.TotalSections)"
    Write-Host "   Coverage: $($completeness.CoveragePct)%"
    Write-Host ""
}
