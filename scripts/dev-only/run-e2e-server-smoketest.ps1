# scripts/dev-only/run-e2e-server-smoketest.ps1
#
# Standalone smoke test for scripts/e2e-server.mjs with a REAL wall-clock timeout.
# Starts the script hidden (no visible window), polls for either:
#   - the script's own stdout containing "E2E_SERVER_READY" (success)
#   - the script process exiting non-zero (failure, already reported by the script)
#   - a hard timeout (failure; kills the process tree unconditionally)
# Always tears down the spawned process tree before exiting, whatever the outcome.

$ErrorActionPreference = "Stop"
$timeoutSeconds = 75
$logPath = "artifacts\e2e-server-smoketest.log"
Remove-Item -Force $logPath -ErrorAction SilentlyContinue

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "scripts/e2e-server.mjs"
$psi.WorkingDirectory = (Get-Location).Path
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$outputBuffer = New-Object System.Text.StringBuilder
$handler = {
    param($sender, $e)
    if ($null -ne $e.Data) { [void]$outputBuffer.AppendLine($e.Data) }
}
$proc.add_OutputDataReceived($handler)
$proc.add_ErrorDataReceived($handler)

[void]$proc.Start()
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()

$deadline = (Get-Date).AddSeconds($timeoutSeconds)
$ready = $false
$failed = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $text = $outputBuffer.ToString()
    if ($text -match "E2E_SERVER_READY") { $ready = $true; break }
    if ($proc.HasExited) { $failed = $true; break }
}

$outputBuffer.ToString() | Out-File -FilePath $logPath -Encoding utf8
$exitedOnOwn = $proc.HasExited

# Always tear down: taskkill /T kills the whole tree (cmd.exe -> next binary),
# not just this direct child, regardless of outcome.
if (-not $proc.HasExited) {
    & taskkill /pid $proc.Id /T /F 2>&1 | Out-Null
    Start-Sleep -Seconds 1
}

if ($ready) {
    Write-Output "RESULT=READY"
} elseif ($exitedOnOwn -or $failed) {
    Write-Output "RESULT=FAILED_EARLY (exit code $($proc.ExitCode))"
} else {
    Write-Output "RESULT=TIMEOUT after ${timeoutSeconds}s"
}
Write-Output "Log written to $logPath"
