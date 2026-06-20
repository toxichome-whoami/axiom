<#
.SYNOPSIS
    Build Axiom and produce versioned binary.
    Run this instead of raw cargo build.

    Usage:
      .\build.ps1                        # native debug build
      .\build.ps1 -Release               # native release build
      .\build.ps1 -Linux                 # cross-compile for Linux
      .\build.ps1 -Linux -Release        # cross-compile Linux release
#>

param(
    [switch]$Release,
    [switch]$Linux
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot

# Read version from .axiom_version (written by build.rs) or fallback to Cargo.toml
$versionFile = "$projectRoot\.axiom_version"
if (Test-Path $versionFile) {
    $version = Get-Content $versionFile -Raw | ForEach-Object { $_.Trim() }
} else {
    $cargoToml = Get-Content "$projectRoot\Cargo.toml"
    $version = ($cargoToml | Select-String '^version = "(.+)"').Matches.Groups[1].Value
}

$zigPath = "D:\msys64_install\ucrt64\bin"
$origPath = $env:PATH
$env:PATH = "${zigPath};${origPath}"

Push-Location $projectRoot

try {
    if ($Linux) {
        $target = "x86_64-unknown-linux-gnu.2.17"
        $profile = if ($Release) { "--release" } else { "" }
        cargo zigbuild "--target" $target $profile
        if ($LASTEXITCODE -ne 0) { throw "Build failed" }

        # zigbuild strips the .2.17 suffix from the output directory name
        $targetDir = $target.Split('.')[0]
        $binaryDir = "target\$targetDir\$(if ($Release) { 'release' } else { 'debug' })"
        $binary = "$binaryDir\axiom"
        $versioned = "$binaryDir\axiom-v$version"
    } else {
        $profile = if ($Release) { "--release" } else { "" }
        cargo build $profile
        if ($LASTEXITCODE -ne 0) { throw "Build failed" }

        $binaryDir = "target\$(if ($Release) { 'release' } else { 'debug' })"
        $binary = "$binaryDir\axiom.exe"
        $versioned = "$binaryDir\axiom-v$version.exe"
    }

    # Copy with versioned name (post-build — binary exists now)
    if (Test-Path $binary) {
        Copy-Item $binary $versioned -Force
        $size = (Get-Item $versioned).Length / 1MB
        Write-Host "✅ Created: $([math]::Round($size, 2)) MB"
        Write-Host "   Binary:  $binary"
        Write-Host "   Version: $versioned"
    }
} finally {
    Pop-Location
}
