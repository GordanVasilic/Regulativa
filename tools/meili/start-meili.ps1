param(
  [string]$MasterKey = "devkey",
  [string]$Addr = "127.0.0.1:7700",
  [string]$DbPath = "d:\\Projekti\\Regulativa\\apps\\api\\data.ms"
)

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $base "..\\..\\apps\\api\\.env"
if ($MasterKey -eq "devkey" -and (Test-Path $envFile)) {
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^MEILI_KEY=' }
  if ($line) { $MasterKey = ($line -replace '^MEILI_KEY=','') }
}
$exe = Join-Path $base "meilisearch.exe"
if (-not (Test-Path $exe)) {
  Write-Error "Meilisearch executable not found: $exe"
  exit 1
}

New-Item -ItemType Directory -Path $DbPath -Force | Out-Null
Start-Process -FilePath $exe -ArgumentList "--master-key $MasterKey --http-addr $Addr --db-path `"$DbPath`"" -NoNewWindow
Write-Output "MeiliSearch started on http://$Addr with master-key=$MasterKey db-path=$DbPath"
