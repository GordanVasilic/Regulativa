param(
  [string]$WebDir = "C:\regulativa\apps\web",
  [string]$OutDir = "C:\regulativa\www"
)
Set-Location $WebDir
npm ci
npm run build
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item -Recurse -Force "$WebDir\dist\*" $OutDir
