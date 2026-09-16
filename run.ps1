param (
    [switch]$linux
)

if ($linux) {
    Write-Host "Setting up MSYS2 environment for Linux cross-compilation..." -ForegroundColor Yellow
    $env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH
    
    Write-Host "Building Axiom for Linux (x86_64-unknown-linux-gnu.2.17)..." -ForegroundColor Cyan
    
    cargo zigbuild --color always --target x86_64-unknown-linux-gnu.2.17 --release 2>&1 | ForEach-Object {
        $line = $_.ToString()
        if ($line -notmatch "ignoring deprecated linker optimization setting" -and
            $line -notmatch "code that will be rejected by a future version of Rust" -and
            $line -notmatch "sqlx-postgres v0.7.4" -and
            $line -notmatch "to see what the problems were, use the option" -and
            $line -notmatch "warn\(linker_messages\)" -and
            $line -notmatch "axiom.*generated.*warning" -and
            $line -notmatch "^\s*\|\s*$") {
            Write-Host $line
        }
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Linux build failed! Aborting." -ForegroundColor Red
        exit $LASTEXITCODE
    }
    
    Write-Host "
Linux build complete! Binary is located in: target\x86_64-unknown-linux-gnu.2.17\release\axiom" -ForegroundColor Green
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
