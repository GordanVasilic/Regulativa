param(
  [string]$NginxDir = "C:\nginx",
  [string]$WebRoot = "C:\regulativa\www"
)
if (-not (Test-Path $NginxDir)) {
  $zip = "$env:TEMP\nginx.zip"
  Invoke-WebRequest -Uri "https://nginx.org/download/nginx-1.27.2.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath C:\ -Force
  $folder = Get-ChildItem C:\ -Directory | Where-Object { $_.Name -like "nginx-*" } | Select-Object -First 1
  if ($folder) { Move-Item $folder.FullName $NginxDir }
}
Copy-Item -Force "tools\windows\nginx.conf" "$NginxDir\conf\nginx.conf"
Start-Process -FilePath "$NginxDir\nginx.exe"
