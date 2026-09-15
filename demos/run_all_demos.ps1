# Set output encoding to UTF-8 to correctly display emojis
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$demos = @("db_insert", "db_fetch", "db_drop")

Write-Host "============================================="
Write-Host "      AXIOM DEMOS AUTOMATED TEST SCRIPT      "
Write-Host "============================================="

$failedDemos = @()

foreach ($demo in $demos) {
    Write-Host "`n---> Running Demo: $demo" -ForegroundColor Cyan
    
    try {
        $process = Start-Process -FilePath "go" -ArgumentList "run . $demo" -NoNewWindow -Wait -PassThru
        if ($process.ExitCode -eq 0) {
            Write-Host "  ✅ SUCCESS: $demo completed without errors." -ForegroundColor Green
        } else {
            Write-Host "  ❌ FAILED: $demo exited with code $($process.ExitCode)" -ForegroundColor Red
            $failedDemos += $demo
        }
    } catch {
        Write-Host "  ❌ FAILED: Could not execute 'go run . $demo'" -ForegroundColor Red
        $failedDemos += $demo
    }
}

Write-Host "`n============================================="
if ($failedDemos.Count -eq 0) {
    Write-Host "🎉 All demos completed successfully!" -ForegroundColor Green
} else {
    Write-Host "⚠️ The following demos failed:" -ForegroundColor Red
    foreach ($fd in $failedDemos) {
        Write-Host "   - $fd" -ForegroundColor Red
    }
}
Write-Host "============================================="
