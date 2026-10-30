# Axiom automated single-command installer for Windows PowerShell
# Usage: irm https://raw.githubusercontent.com/toxichome-whoami/axiom/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "toxichome-whoami/axiom"
$GitHubUrl = "https://github.com/$Repo"

# Detect architecture
$Arch = "amd64"
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
    $Arch = "arm64"
}

Write-Host "==> Detecting latest release of Axiom..." -ForegroundColor Cyan
$LatestTag = "v0.1.23"
try {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 5
    if ($Release.tag_name) {
        $LatestTag = $Release.tag_name
    }
} catch {
    # Fallback to default tag if GitHub API is rate-limited
}

$FileName = "axiom_${LatestTag}_windows_${Arch}.zip"
$DownloadUrl = "$GitHubUrl/releases/download/$LatestTag/$FileName"

Write-Host "==> Downloading Axiom $LatestTag for windows_$Arch..." -ForegroundColor Cyan
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

$ZipPath = Join-Path $TempDir $FileName
Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath

Write-Host "==> Extracting archive..." -ForegroundColor Cyan
Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force

$BinSource = Get-ChildItem -Path $TempDir -Filter "axiom.exe" -Recurse | Select-Object -First 1

if (-not $BinSource) {
    Write-Error "Could not locate axiom.exe in downloaded archive."
    exit 1
}

$Destination = Join-Path (Get-Location) "axiom.exe"
Copy-Item -Path $BinSource.FullName -Destination $Destination -Force
Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "==> Successfully installed Axiom $LatestTag to $Destination!" -ForegroundColor Green
Write-Host ""
Write-Host "Run Axiom with:" -ForegroundColor Yellow
Write-Host "  .\axiom.exe server run"
Write-Host ""
Write-Host "Open the Admin Web UI at:" -ForegroundColor Yellow
Write-Host "  http://localhost:4500/system"
