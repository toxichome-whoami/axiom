param (
    [string]$TargetPath = "target\release\axiom.exe",
    [string]$IconPath = "src\icon\favicon.ico"
)

if (-not (Test-Path $TargetPath)) {
    Write-Host "Error: Target executable not found at $TargetPath" -ForegroundColor Red
    Write-Host "Make sure you run 'cargo build --release' first!" -ForegroundColor Yellow
    exit 1
}

Write-Host "Injecting icon and metadata into $TargetPath using rcedit..." -ForegroundColor Cyan

# 1. Read version dynamically from Cargo.toml
$CargoPath = "Cargo.toml"
if (-not (Test-Path $CargoPath)) {
    Write-Host "Error: Cargo.toml not found at $CargoPath!" -ForegroundColor Red
    exit 1
}

$CargoContent = Get-Content $CargoPath -Raw
if ($CargoContent -match '(?m)^version\s*=\s*"([^"]+)"') {
    $ProductVersion = $matches[1]
} else {
    Write-Host "Error: Could not find version in Cargo.toml!" -ForegroundColor Red
    exit 1
}

# 2. Convert to X.X.X.X strict format for rcedit
$BaseVersion = ($ProductVersion -split '-')[0]
$Parts = [System.Collections.ArrayList]($BaseVersion -split '\.')
while ($Parts.Count -lt 4) {
    $Parts.Add("0") | Out-Null
}
$NumericVersion = ($Parts[0..3] -join ".")

Write-Host "Detected Version: $ProductVersion (Numeric: $NumericVersion)" -ForegroundColor DarkGray

$rceditArgs = @(
    "$TargetPath",
    "--set-file-version", "$NumericVersion",
    "--set-product-version", "$NumericVersion",
    "--set-version-string", "CompanyName", "Toxichome, Inc",
    "--set-version-string", "FileDescription", "Axiom API Gateway Backend",
    "--set-version-string", "LegalCopyright", "Copyright (C) 2026 Toxichome, Inc. All rights reserved.",
    "--set-version-string", "ProductName", "Axiom",
    "--set-version-string", "ProductVersion", "$ProductVersion",
    "--set-version-string", "OriginalFilename", "axiom.exe",
    "--set-version-string", "InternalName", "Axiom",
    "--set-version-string", "Comments", "High-performance unified API gateway for databases."
)

if (Test-Path $IconPath) {
    $rceditArgs += "--set-icon"
    $rceditArgs += "$IconPath"
} else {
    Write-Host "Warning: Icon not found at $IconPath. The icon will not be set." -ForegroundColor Yellow
}

& "tools\rcedit-x64.exe" $rceditArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "Metadata successfully injected!" -ForegroundColor Green
} else {
    Write-Host "Failed to inject metadata." -ForegroundColor Red
}
