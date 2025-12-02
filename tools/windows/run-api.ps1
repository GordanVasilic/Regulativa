param(
  [string]$ApiDir = "C:\regulativa\apps\api",
  [int]$Port = 5000
)
Set-Location $ApiDir
npm ci
npm run build
try { npm i -g pm2 } catch {}
pm2 start dist\server.js --name regulativa-api --env production --node-args "--require dotenv/config" -- $Port
pm2 save
