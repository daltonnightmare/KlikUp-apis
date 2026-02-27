# start-redis.ps1 - Version améliorée
param(
    [switch]$Silent,
    [switch]$Force
)

$redisPath = "C:\Users\ASUS\Downloads\Redis-x64-3.0.504"

# Vérifier que le dossier existe
if (-not (Test-Path $redisPath)) {
    Write-Host "❌ Dossier Redis introuvable: $redisPath" -ForegroundColor Red
    Write-Host "📁 Vérifie le chemin d'installation" -ForegroundColor Yellow
    exit 1
}

Set-Location $redisPath

# Fonction pour tester si Redis tourne déjà
function Test-RedisRunning {
    $test = & ".\redis-cli.exe" ping 2>$null
    return $test -eq "PONG"
}

# Vérifier si Redis tourne déjà
if (Test-RedisRunning) {
    if (-not $Silent) {
        Write-Host "ℹ️ Redis est déjà en cours d'exécution" -ForegroundColor Cyan
        & ".\redis-cli.exe" INFO server | Select-String "redis_version|uptime_in_seconds|connected_clients"
    }
    
    if (-not $Force) {
        exit 0
    }
}

Write-Host "🚀 Démarrage de Redis..." -ForegroundColor Green

# Démarrer Redis
$process = Start-Process -FilePath ".\redis-server.exe" -NoNewWindow -PassThru

# Attendre que Redis démarre complètement
$maxAttempts = 5
$attempt = 1
$started = $false

while ($attempt -le $maxAttempts) {
    Write-Host "⏳ Tentative $attempt/$maxAttempts..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    
    if (Test-RedisRunning) {
        $started = $true
        break
    }
    
    $attempt++
}

if ($started) {
    Write-Host "✅ Redis démarré avec succès!" -ForegroundColor Green
    Write-Host "📊 Informations:" -ForegroundColor Cyan
    
    # Afficher quelques infos
    $info = & ".\redis-cli.exe" INFO server
    $version = $info | Select-String "redis_version:" | ForEach-Object { $_ -replace "redis_version:", "" }
    $port = $info | Select-String "tcp_port:" | ForEach-Object { $_ -replace "tcp_port:", "" }
    
    Write-Host "   Version: $version" -ForegroundColor White
    Write-Host "   Port: $port" -ForegroundColor White
    Write-Host "   PID: $($process.Id)" -ForegroundColor White
} else {
    Write-Host "❌ Erreur: Redis n'a pas démarré après $maxAttempts tentatives" -ForegroundColor Red
}