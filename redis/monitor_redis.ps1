# monitor-redis.ps1
$redisPath = "C:\Users\ASUS\Downloads\Redis-x64-3.0.504"
Set-Location $redisPath

Write-Host "📊 Monitoring Redis (Ctrl+C pour quitter)" -ForegroundColor Cyan
& ".\redis-cli.exe" monitor