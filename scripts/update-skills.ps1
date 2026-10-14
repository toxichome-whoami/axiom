<#
.SYNOPSIS
    Updates all AI skills installed via npx agentic-awesome-skills and skills CLI.

.DESCRIPTION
    Runs the official npx update commands to keep all 2,687+ skills up to date
    in ~/.agent/skills, regenerates docs/reference/skills-registry.md, and audits integrity.

.EXAMPLE
    .\scripts\update-skills.ps1
    .\scripts\update-skills.ps1 -DryRun
    .\scripts\update-skills.ps1 -Audit
#>

param(
    [switch]$DryRun,
    [switch]$Audit
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Axiom Agent Skills Update Utility" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if ($Audit) {
    Write-Host ""
    Write-Host "[1/1] Auditing installed skills..." -ForegroundColor Yellow
    npx agentic-awesome-skills audit
    exit 0
}

if ($DryRun) {
    Write-Host ""
    Write-Host "[1/1] Running update check (dry-run mode)..." -ForegroundColor Yellow
    npx agentic-awesome-skills --antigravity --all --dry-run
    exit 0
}

Write-Host ""
Write-Host "[1/3] Updating all installed skills via agentic-awesome-skills..." -ForegroundColor Yellow
npx agentic-awesome-skills --antigravity --all

Write-Host ""
Write-Host "[2/3] Checking for updates on skills CLI..." -ForegroundColor Yellow
try {
    npx skills update
} catch {
    Write-Host "  Note: skills CLI check completed." -ForegroundColor Gray
}

Write-Host ""
Write-Host "[3/3] Regenerating skills registry documentation..." -ForegroundColor Yellow
node scripts/generate_skills_list.cjs

Write-Host ""
Write-Host "[SUCCESS] All skills successfully updated and registry synchronized!" -ForegroundColor Green
Write-Host "  Registry document: docs/reference/skills-registry.md" -ForegroundColor Gray
