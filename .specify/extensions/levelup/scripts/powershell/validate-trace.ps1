#!/usr/bin/env pwsh

# Validate AI session trace completeness and quality
# This script checks trace.md for section completeness, quality gate statistics,
# and provides recommendations for improvement.

param(
    [switch]$Json,
    [string]$TraceFile = "",
    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: validate-trace.ps1 [-Json] [-TraceFile <path>] [-Help]"
    Write-Host "  -Json         Output results in JSON format"
    Write-Host "  -TraceFile    Path to trace.md (default: current feature trace)"
    Write-Host "  -Help         Show this help message"
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

# If no trace file specified, use current feature trace
if (-not $TraceFile) {
    $paths = Get-FeaturePaths
    Test-FeatureBranch $paths.CURRENT_BRANCH $paths.HAS_GIT
    $TraceFile = Join-Path $paths.FEATURE_DIR "trace.md"
}

# Check if trace exists
if (-not (Test-Path $TraceFile)) {
    if ($Json) {
        $output = @{
            valid = $false
            error = "Trace file not found: $TraceFile"
        } | ConvertTo-Json -Compress
        Write-Output $output
    } else {
        Write-Error "Trace file not found: $TraceFile. Run /spec.trace to generate a session trace."
    }
    exit 1
}

# Read trace content
$traceContent = Get-Content $TraceFile -Raw

# Validation function
function Test-Section {
    param(
        [string]$SectionName,
        [string]$SectionPattern,
        [int]$MinLines
    )
    
    if ($traceContent -notmatch $SectionPattern) {
        return $false
    }
    
    $sectionText = ($traceContent -split $SectionPattern)[1]
    if ($sectionText) {
        $sectionText = ($sectionText -split "(?m)^## ")[0]
        $lineCount = ($sectionText -split "`n").Count
        return $lineCount -ge $MinLines
    }
    
    return $false
}

# Validate all 6 sections (including Summary)
$summaryValid = Test-Section "Summary" "## Summary" 5
$section1Valid = Test-Section "Session Overview" "## 1\. Session Overview" 5
$section2Valid = Test-Section "Decision Patterns" "## 2\. Decision Patterns" 5
$section3Valid = Test-Section "Execution Context" "## 3\. Execution Context" 5
$section4Valid = Test-Section "Reusable Patterns" "## 4\. Reusable Patterns" 5
$section5Valid = Test-Section "Evidence Links" "## 5\. Evidence Links" 5

$sectionsValid = @($summaryValid, $section1Valid, $section2Valid, $section3Valid, $section4Valid, $section5Valid | Where-Object { $_ }).Count
$totalSections = 6
$coveragePct = [math]::Floor(($sectionsValid * 100) / $totalSections)

# Validate Summary subsections
$problemValid = $false
$decisionsValid = $false
$solutionValid = $false

if ($traceContent -match '### Problem') {
    $problemSection = ($traceContent -split '### Problem')[1] -split '###|^##'
    $problemLines = ($problemSection[0] -split "`n" | Where-Object { $_ }).Count
    if ($problemLines -ge 1 -and $problemLines -le 5) {
        $problemValid = $true
    }
}

if ($traceContent -match '### Key Decisions') {
    $decisionsSection = ($traceContent -split '### Key Decisions')[1] -split '###|^##'
    $decisionCount = ([regex]::Matches($decisionsSection[0], '^\d+\.', [System.Text.RegularExpressions.RegexOptions]::Multiline)).Count
    if ($decisionCount -ge 3) {
        $decisionsValid = $true
    }
}

if ($traceContent -match '### Final Solution') {
    $solutionSection = ($traceContent -split '### Final Solution')[1] -split '---| ^##'
    if ($solutionSection[0] -match '(pass|coverage|quality|delivered)') {
        $solutionValid = $true
    }
}

# Extract quality gate info
$gatesPassed = 0
$gatesFailed = 0
$gatesTotal = 0

if ($traceContent -match '(?s)\*\*Quality Gates\*\*:.*?Passed: (\d+).*?Failed: (\d+).*?Total: (\d+)') {
    $gatesPassed = [int]$matches[1]
    $gatesFailed = [int]$matches[2]
    $gatesTotal = [int]$matches[3]
}

# Calculate quality gate pass rate
if ($gatesTotal -gt 0) {
    $gatePassRate = [math]::Floor(($gatesPassed * 100) / $gatesTotal)
} else {
    $gatePassRate = 0
}

# Determine overall validity
$isValid = $coveragePct -ge 80

# Generate warnings and recommendations
$warnings = @()
$recommendations = @()

if (-not $summaryValid) {
    $warnings += "Summary section missing or incomplete"
    $recommendations += "Add Summary section with Problem, Key Decisions, and Final Solution"
}

if (-not $problemValid) {
    $warnings += "Problem statement missing or not concise (should be 1-2 sentences)"
    $recommendations += "Extract problem from spec mission and user stories"
}

if (-not $decisionsValid) {
    $warnings += "Key Decisions missing or insufficient (need at least 3)"
    $recommendations += "Document architecture, technology, testing, and process decisions"
}

if (-not $solutionValid) {
    $warnings += "Final Solution missing or lacks metrics"
    $recommendations += "Include outcome statement with quality gate pass rate"
}

if (-not $section1Valid) {
    $warnings += "Session Overview section missing or incomplete"
    $recommendations += "Add session overview with feature context and key decisions"
}

if (-not $section2Valid) {
    $warnings += "Decision Patterns section missing or incomplete"
    $recommendations += "Document triage decisions and technology choices"
}

if (-not $section3Valid) {
    $warnings += "Execution Context section missing or incomplete"
    $recommendations += "Include quality gate statistics and execution mode breakdown"
}

if (-not $section4Valid) {
    $warnings += "Reusable Patterns section missing or incomplete"
    $recommendations += "Identify effective methodologies and applicable contexts"
}

if (-not $section5Valid) {
    $warnings += "Evidence Links section missing or incomplete"
    $recommendations += "Add commit references, issue links, and code paths"
}

if ($gatePassRate -lt 80 -and $gatesTotal -gt 0) {
    $warnings += "Low quality gate pass rate: ${gatePassRate}%"
    $recommendations += "Review failed quality gates and address test failures"
}

# Output results
if ($Json) {
    $output = @{
        valid = $isValid
        trace_file = $TraceFile
        sections_valid = $sectionsValid
        total_sections = $totalSections
        coverage_pct = $coveragePct
        quality_gates = @{
            passed = $gatesPassed
            failed = $gatesFailed
            total = $gatesTotal
            pass_rate = $gatePassRate
        }
        warnings = $warnings
        recommendations = $recommendations
    } | ConvertTo-Json -Compress
    Write-Output $output
} else {
    Write-Host ""
    Write-Host "==================================="
    Write-Host "Trace Validation Report"
    Write-Host "==================================="
    Write-Host ""
    Write-Host "File: $TraceFile"
    Write-Host ""
    Write-Host "Section Completeness:"
    Write-Host "  ✓ Summary:             $(if ($summaryValid) { '✅' } else { '❌' })"
    Write-Host "    - Problem:          $(if ($problemValid) { '✅' } else { '❌' })"
    Write-Host "    - Key Decisions:    $(if ($decisionsValid) { '✅' } else { '❌' })"
    Write-Host "    - Final Solution:   $(if ($solutionValid) { '✅' } else { '❌' })"
    Write-Host "  ✓ Session Overview:    $(if ($section1Valid) { '✅' } else { '❌' })"
    Write-Host "  ✓ Decision Patterns:   $(if ($section2Valid) { '✅' } else { '❌' })"
    Write-Host "  ✓ Execution Context:   $(if ($section3Valid) { '✅' } else { '❌' })"
    Write-Host "  ✓ Reusable Patterns:   $(if ($section4Valid) { '✅' } else { '❌' })"
    Write-Host "  ✓ Evidence Links:      $(if ($section5Valid) { '✅' } else { '❌' })"
    Write-Host ""
    Write-Host "Coverage: $sectionsValid/$totalSections sections ($coveragePct%)"
    Write-Host ""
    
    if ($gatesTotal -gt 0) {
        Write-Host "Quality Gates:"
        Write-Host "  Passed: $gatesPassed"
        Write-Host "  Failed: $gatesFailed"
        Write-Host "  Total:  $gatesTotal"
        Write-Host "  Pass Rate: $gatePassRate%"
        Write-Host ""
    }
    
    if ($warnings.Count -gt 0) {
        Write-Host "⚠️  Warnings:"
        foreach ($warning in $warnings) {
            Write-Host "  - $warning"
        }
        Write-Host ""
    }
    
    if ($recommendations.Count -gt 0) {
        Write-Host "💡 Recommendations:"
        foreach ($rec in $recommendations) {
            Write-Host "  - $rec"
        }
        Write-Host ""
    }
    
    if ($isValid) {
        Write-Host "✅ Trace validation passed"
    } else {
        Write-Host "❌ Trace validation failed (coverage < 80%)"
    }
    Write-Host ""
}

# Exit with appropriate code
if ($isValid) {
    exit 0
} else {
    exit 1
}
