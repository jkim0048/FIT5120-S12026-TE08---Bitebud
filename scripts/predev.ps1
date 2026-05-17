# Stop a stale Node API on port 3001 so `tsx watch` can bind after route changes.
$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { exit 0 }

$pid = $conn.OwningProcess
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
if ($proc -and $proc.ProcessName -eq 'node') {
  Write-Host "Stopping existing API on port 3001 (PID $pid)"
  Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}
