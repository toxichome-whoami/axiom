param (
    [switch]$linux
)

if ($linux) {
    Write-Host "Setting up MSYS2 environment for Linux cross-compilation..." -ForegroundColor Yellow
    $env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH
    
    Write-Host "Building Axiom for Linux (x86_64-unknown-linux-gnu.2.17)..." -ForegroundColor Cyan
    cargo zigbuild --target x86_64-unknown-linux-gnu.2.17 --release
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Linux build failed! Aborting." -ForegroundColor Red
        exit $LASTEXITCODE
    }
    
    Write-Host "
Linux build complete! Binary is located in the target directory (e.g., target\x86_64-unknown-linux-gnu\release\axiom)" -ForegroundColor Green
    Write-Host "(Skipping metadata injection and auto-run since Linux ELF binaries don't use Windows icons and cannot run natively on Windows)" -ForegroundColor DarkGray

} else {
    Write-Host "Building Axiom for Windows (Release)..." -ForegroundColor Cyan
    cargo build --release

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed! Aborting." -ForegroundColor Red
        exit $LASTEXITCODE
    }

    Write-Host "
Applying Metadata..." -ForegroundColor Cyan
    powershell -ExecutionPolicy Bypass -File "scripts\add_metadata.ps1" -TargetPath "target\release\axiom.exe"

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to apply metadata! Aborting." -ForegroundColor Red
        exit $LASTEXITCODE
    }

    Write-Host "
Starting Axiom..." -ForegroundColor Green
    & "target\release\axiom.exe"
}
