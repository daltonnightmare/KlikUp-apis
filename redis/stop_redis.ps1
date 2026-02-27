# stop-redis.ps1
$redisPath = "C:\Users\ASUS\Downloads\Redis-x64-3.0.504"
Set-Location $redisPath

Write-Host "🛑 Arrêt de Redis..." -ForegroundColor Yellow

# Arrêter Redis proprement
& ".\redis-cli.exe" shutdown

Start-Sleep -Seconds 2

# Vérifier que Redis est bien arrêté
$test = & ".\redis-cli.exe" ping 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "✅ Redis arrêté avec succès!" -ForegroundColor Green
} else {
    Write-Host "❌ Erreur: Redis n'a pas pu être arrêté" -ForegroundColor Red
}