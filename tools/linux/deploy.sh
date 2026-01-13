#!/bin/bash

# Stop on error
set -e

PROJECT_DIR="/var/www/regulativa"
REPO_URL="https://github.com/GordanVasilic/Regulativa.git"

echo "🚀 Starting Deployment..."

# 1. Clone or Pull Repo
if [ -d "$PROJECT_DIR" ]; then
    echo "📂 Updating existing repository..."
    cd $PROJECT_DIR
    git pull
else
    echo "📂 Cloning repository..."
    sudo mkdir -p $PROJECT_DIR
    sudo chown -R $USER:$USER /var/www
    git clone $REPO_URL $PROJECT_DIR
    cd $PROJECT_DIR
fi

# 2. Install Dependencies
echo "📦 Installing dependencies..."
# Create .env for API if not exists
if [ ! -f apps/api/.env ]; then
    echo "📝 Creating .env for API..."
    echo "MEILI_HOST=http://127.0.0.1:7700" > apps/api/.env
    echo "MEILI_KEY=masterKey" >> apps/api/.env
    echo "PORT=5000" >> apps/api/.env
fi

cd apps/api && npm install && cd ../..
cd apps/web && npm install && cd ../..

# 3. Build Web App
echo "🏗️ Building Web App..."
cd apps/web
npm run build
cd ../..

# 4. Build API
echo "🏗️ Building API..."
cd apps/api
npm run build
cd ../..

# 5. Configure Nginx
echo "🌐 Configuring Nginx..."
sudo cp tools/linux/nginx.conf /etc/nginx/sites-available/regulativa
sudo ln -sf /etc/nginx/sites-available/regulativa /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# 6. Manage Services with PM2
echo "🚀 Managing Services..."

# Start/Restart MeiliSearch
if pm2 describe meili-search > /dev/null; then
    pm2 restart meili-search --update-env
else
    pm2 start "meilisearch --master-key 'masterKey' --db-path '/var/lib/meilisearch/data'" --name meili-search
fi

# Start/Restart API
cd apps/api
if pm2 describe regulativa-api > /dev/null; then
    pm2 restart regulativa-api --update-env
else
    pm2 start dist/server.js --name regulativa-api
fi
cd ../..

# 7. Save PM2 state
echo "💾 Saving PM2 state..."
pm2 save

# Ensure PM2 starts on boot
# (This might need sudo, and usually prints a command to run, but 'pm2 startup' is idempotent-ish)
# We'll assume setup-ubuntu.sh handled the startup command generation, or we can try to run it.
# pm2 startup | tail -n 1 | sh # This is risky in non-interactive script if it requires sudo password.
# Assuming user has run setup-ubuntu.sh which handles this manually usually.

echo "✅ Deployment Complete! App should be live."
