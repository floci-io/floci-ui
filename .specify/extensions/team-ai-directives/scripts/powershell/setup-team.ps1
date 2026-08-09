param(
    [switch]$Json
)

$projectRoot = if ($env:PROJECT_ROOT) { $env:PROJECT_ROOT } else {
    try { (git rev-parse --show-toplevel 2>$null) } catch { $null }
}
if (-not $projectRoot) { $projectRoot = (Get-Location).Path }

$branch = if ($env:BRANCH) { $env:BRANCH } else {
    try { (git branch --show-current 2>$null) } catch { 'unknown' }
}
if (-not $branch) { $branch = 'unknown' }

$teamDirectives = ""
$initOptions = Join-Path $projectRoot ".specify\init-options.json"
if (Test-Path $initOptions) {
    try {
        $opts = Get-Content $initOptions -Raw | ConvertFrom-Json
        $teamDirectives = $opts.team_ai_directives
    } catch {
        $teamDirectives = ""
    }
}
if (-not $teamDirectives) {
    $teamDirectives = Join-Path $projectRoot ".specify\team-ai-directives"
}

if ($Json) {
    @{ REPO_ROOT = $projectRoot; TEAM_DIRECTIVES = $teamDirectives; BRANCH = $branch } | ConvertTo-Json -Compress
} else {
    "REPO_ROOT=$projectRoot"
    "TEAM_DIRECTIVES=$teamDirectives"
    "BRANCH=$branch"
}
