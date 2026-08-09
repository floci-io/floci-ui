# Setup script for LevelUp extension
# Initializes CDR file and resolves team-ai-directives path

param(
    [switch]$Json,
    [switch]$NoDecompose,
    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: setup-levelup.ps1 [-Json] [-NoDecompose]"
    Write-Host "  -Json          Output results in JSON format"
    Write-Host "  -NoDecompose   Disable automatic sub-system decomposition"
    Write-Host "  -Help          Show this help message"
    exit 0
}

# Get script directory for common.ps1 sourcing
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

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

$projectRoot = Get-ProjectRoot $scriptDir

# Load common functions - use absolute path from project root
$commonPath = "$projectRoot\.specify\scripts\powershell\common.ps1"
if (Test-Path $commonPath) {
    . $commonPath
} elseif (Test-Path "$scriptDir\common.ps1") {
    . "$scriptDir\common.ps1"
}

# Get repository root using common.ps1 function (searches upward for .specify first)
$repoRoot = Get-RepoRoot

function Detect-Subsystems {
    $repoRoot = Get-RepoRoot
    $originalLocation = Get-Location
    
    try {
        Set-Location $repoRoot -ErrorAction SilentlyContinue | Out-Null
    } catch {
        return @()
    }
    
    $dirs = @()
    
    # 1. Top-level feature directories (src/, app/, services/)
    if (Test-Path "src") {
        Get-ChildItem -Path "src" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $dirname = $_.Name
            if ($dirname -notin @("utils", "common", "lib", "shared", "core")) {
                $dirs += $dirname
            }
        }
    }
    
    if (Test-Path "services") {
        Get-ChildItem -Path "services" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $dirs += $_.Name
        }
    }
    
    if (Test-Path "modules") {
        Get-ChildItem -Path "modules" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $dirs += $_.Name
        }
    }
    
    if (Test-Path "apps") {
        Get-ChildItem -Path "apps" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $dirs += $_.Name
        }
    }
    
    # 2. Check for docker-compose services
    $composeFile = $null
    if (Test-Path "docker-compose.yml") { $composeFile = "docker-compose.yml" }
    elseif (Test-Path "docker-compose.yaml") { $composeFile = "docker-compose.yaml" }
    
    if ($composeFile) {
        $content = Get-Content $composeFile -Raw
        $services = [regex]::Matches($content, '^\s*([a-zA-Z0-9_-]+):\s*$' , [System.Text.RegularExpressions.RegexOptions]::Multiline) | ForEach-Object { $_.Groups[1].Value }
        $services = $services | Where-Object { $_ -notin @("version", "services", "networks", "volumes") }
        
        foreach ($svc in $services) {
            $found = $false
            foreach ($d in $dirs) {
                if ($d.ToLower() -like "*$($svc.ToLower())*" -or $svc.ToLower() -like "*$($d.ToLower())*") {
                    $found = $true
                    break
                }
            }
            if (-not $found) {
                $dirs += $svc
            }
        }
    }
    
    # 3. Check for Node.js workspaces
    if (Test-Path "package.json") {
        try {
            $packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
            if ($packageJson.workspaces) {
                $packageJson.workspaces | ForEach-Object {
                    $dirname = [System.IO.Path]::GetFileName($_)
                    if ($dirname -ne "node_modules" -and $dirs -notcontains $dirname) {
                        $dirs += $dirname
                    }
                }
            }
        } catch {}
    }
    
    # 4. Check for Python namespace packages
    if (Test-Path "pyproject.toml") {
        Get-ChildItem -Path . -Recurse -Filter "__init__.py" -ErrorAction SilentlyContinue | 
            Where-Object { $_.FullName -notmatch "node_modules|__pycache__" } | 
            Select-Object -First 20 | ForEach-Object {
                $dirname = $_.Directory.Name
                if ($dirname -ne "." -and $dirname -ne "src" -and $dirs -notcontains $dirname) {
                    $dirs += $dirname
                }
            }
    }
    
    # 5. Check for Go modules
    if (Test-Path "go.mod" -and (Test-Path "cmd")) {
        Get-ChildItem -Path "cmd" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            if ($dirs -notcontains $_.Name) {
                $dirs += $_.Name
            }
        }
    }
    
    Set-Location $originalLocation | Out-Null
    
    return $dirs
}

# Resolve team-ai-directives path using centralized function
$teamDirectives = Load-TeamDirectivesConfig

# Skills drafts location
$skillsDrafts = Join-Path $repoRoot ".specify\drafts\skills"
$cdrFile = Join-Path $repoRoot ".specify\drafts\cdr.md"

if (-not (Test-Path $skillsDrafts)) {
    New-Item -ItemType Directory -Path $skillsDrafts -Force | Out-Null
}

# Ensure .specify/drafts exists
$draftsDir = Join-Path $repoRoot ".specify/drafts"
if (-not (Test-Path $draftsDir)) {
    New-Item -ItemType Directory -Path $draftsDir -Force | Out-Null
}

# Get current git branch
$currentBranch = ""
try {
    $currentBranch = git rev-parse --abbrev-ref HEAD 2>$null
} catch {
    $currentBranch = ""
}

# Output results
if ($Json) {
    $subsystems = @(Detect-Subsystems)
    $subsystemObjects = @()
    foreach ($s in $subsystems) {
        $subsystemObjects += @{
            id = $s
            name = $s
            detection_method = "directory"
            evidence = "$s/"
        }
    }
    $output = @{
        REPO_ROOT = $repoRoot
        TEAM_DIRECTIVES = if ($teamDirectives) { $teamDirectives } else { "" }
        SKILLS_DRAFTS = $skillsDrafts
        CDR_FILE = $cdrFile
        BRANCH = $currentBranch
        subsystems = $subsystemObjects
        decomposition = -not $NoDecompose
    }
    $output | ConvertTo-Json -Compress
} else {
    Write-Host "REPO_ROOT: $repoRoot"
    if ($teamDirectives) {
        Write-Host "TEAM_DIRECTIVES: $teamDirectives"
    } else {
        Write-Host "TEAM_DIRECTIVES: (not configured)"
    }
    Write-Host "SKILLS_DRAFTS: $skillsDrafts"
    Write-Host "CDR_FILE: $cdrFile"
    Write-Host "BRANCH: $currentBranch"

    $subsystems = Detect-Subsystems
    if ($subsystems.Count -eq 0) {
        Write-Host "No sub-systems detected." -ForegroundColor Yellow
    } else {
        Write-Host "Detected $($subsystems.Count) sub-systems:" -ForegroundColor Cyan
        foreach ($s in $subsystems) {
            Write-Host "  - $s" -ForegroundColor White
        }
    }
}
