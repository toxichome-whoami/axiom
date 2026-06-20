param(
    [switch]$Release,
    [switch]$Linux
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$zigPath = "D:\msys64_install\ucrt64\bin"

Push-Location $projectRoot

try {
    if ($Linux) {
        $env:PATH = "${zigPath};${env:PATH}"
        cargo zigbuild "--target" "x86_64-unknown-linux-gnu.2.17" $(if ($Release) { "--release" } else { "" })
        if ($LASTEXITCODE -ne 0) { throw "Build failed" }
        Write-Host "Linux binary: target\x86_64-unknown-linux-gnu\release\axiom"
    } else {
        cargo build $(if ($Release) { "--release" } else { "" })
        if ($LASTEXITCODE -ne 0) { throw "Build failed" }
        Write-Host "Windows binary: target\$(if ($Release) { 'release' } else { 'debug' })\axiom.exe"
    }
} finally {
    Pop-Location
}
