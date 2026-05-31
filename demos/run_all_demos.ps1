# Set output encoding to UTF-8 to correctly display emojis
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$demos = @("auth", "db_fetch", "db_insert", "db_drop", "fs_upload", "sse", "websocket", "webhook", "graphql", "mcp", "federation")

Write-Host "============================================="
Write-Host "      AXIOM DEMOS AUTOMATED TEST SCRIPT      "
Write-Host "============================================="

$failedDemos = @()

foreach ($demo in $demos) {
    Write-Host "`n---> Running Demo: $demo" -ForegroundColor Cyan
    
    # We use Start-Process or simply call go directly.
    # To catch errors, we can redirect stderr or check $LASTEXITCODE
    
    try {
        if ($demo -eq "webhook" -or $demo -eq "sse" -or $demo -eq "websocket") {
            # Run background demos with a short timeout since they loop/listen forever
            $process = Start-Process -FilePath "go" -ArgumentList "run . $demo" -NoNewWindow -PassThru
            Start-Sleep -Seconds 3
            if (-not $process.HasExited) {
                # Use taskkill to kill the entire process tree (including the compiled Go binary)
                Start-Process -FilePath "taskkill" -ArgumentList "/F /T /PID $($process.Id)" -NoNewWindow -Wait
                Write-Host "  ✅ SUCCESS: $demo connected and ran successfully (terminated gracefully)." -ForegroundColor Green
            } else {
                Write-Host "  ❌ FAILED: $demo exited prematurely with code $($process.ExitCode)" -ForegroundColor Red
                $failedDemos += $demo
            }
        } else {
            $process = Start-Process -FilePath "go" -ArgumentList "run . $demo" -NoNewWindow -Wait -PassThru
            if ($process.ExitCode -eq 0) {
                Write-Host "  ✅ SUCCESS: $demo completed without errors." -ForegroundColor Green
            } else {
                Write-Host "  ❌ FAILED: $demo exited with code $($process.ExitCode)" -ForegroundColor Red
                $failedDemos += $demo
            }
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
