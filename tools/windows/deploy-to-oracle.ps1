# Deploy to Oracle Cloud Script
# Usage: .\tools\windows\deploy-to-oracle.ps1

$ErrorActionPreference = "Stop"

# Configuration
$KeyPath = "d:\Projekti\Regulativa\ssh-key-2026-01-13 (1).key"
$User = "ubuntu"
$Host = "130.61.161.14"
$RemotePath = "/var/www/regulativa"

Write-Host "🚀 Starting Deployment to Oracle ($User@$Host)..." -ForegroundColor Cyan

# 1. Check Database
$LocalDbPath = "apps\api\data\regulativa.db"
$DbFound = $false

if (Test-Path "apps\api\data.db") {
    Write-Host "📦 Found apps\api\data.db, using that."
    $LocalDbPath = "apps\api\data.db"
    $DbFound = $true
}

if (-not $DbFound) {
    if (Test-Path "apps\api\data\regulativa.db") {
        $LocalDbPath = "apps\api\data\regulativa.db"
        $DbFound = $true
    }
}

if (-not $DbFound) {
    Write-Error "❌ Database not found! Expected at apps\api\data\regulativa.db or apps\api\data.db"
}

# 2. Upload Database
Write-Host "📤 Uploading Database ($LocalDbPath)..." -ForegroundColor Yellow
$ScpArgs = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=no", $LocalDbPath, "${User}@${Host}:/tmp/regulativa.db")
Write-Host "Exec: scp $ScpArgs"
& scp $ScpArgs

# 3. Trigger Deployment on Server
Write-Host "DOING SERVER DEPLOYMENT..." -ForegroundColor Yellow

$RemoteScript = @"
set -e
echo 'Starting remote script...'
sudo mkdir -p $RemotePath/apps/api/data
sudo mv /tmp/regulativa.db $RemotePath/apps/api/data/regulativa.db
sudo chown -R ${User}:${User} $RemotePath/apps/api/data
cd $RemotePath
# Fix permission if needed
sudo chown -R ${User}:${User} .
git pull origin main
chmod +x tools/linux/deploy-oracle.sh
./tools/linux/deploy-oracle.sh
"@

$SshArgs = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=no", "${User}@${Host}", $RemoteScript)
Write-Host "Exec SSH..."
& ssh $SshArgs

Write-Host "✅ Done!" -ForegroundColor Green
