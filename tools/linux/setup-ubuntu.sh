#!/bin/bash

# Stop on error
set -e

echo "🚀 Starting Server Setup for Regulativa (Ubuntu/Debian)..."

# 1. Update System
echo "📦 Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl wget git unzip build-essential

# 1.1 Configure Swap (CRITICAL for Micro Instances)
echo "💾 Configuring Swap file (4GB)..."
# Check if swap exists
if [ ! -f /swapfile ]; then
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "✅ Swap created."
else
    echo "ℹ️ Swap already exists."
fi

# 2. Install Node.js (LTS)
echo "🟢 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
# Ensure npm is installed (sometimes separate in distro packages)
if ! command -v npm &> /dev/null; then
    echo "⚠️ npm not found, installing explicitly..."
    sudo apt-get install -y npm
fi

# 3. Install PM2 (Process Manager)
echo "Process Manager (PM2) installing..."
sudo npm install -g pm2

# 4. Install Nginx
echo "🌐 Installing Nginx..."
sudo apt-get install -y nginx

# 5. Install MeiliSearch
echo "🔍 Installing MeiliSearch..."
# Download MeiliSearch binary
curl -L https://install.meilisearch.com | sh
# Move to global bin
sudo mv meilisearch /usr/local/bin/
# Create data directory
sudo mkdir -p /var/lib/meilisearch/data
sudo mkdir -p /var/lib/meilisearch/dumps
sudo mkdir -p /var/lib/meilisearch/snapshots
sudo chown -R $USER:$USER /var/lib/meilisearch

# 6. Firewall Setup (UFW)
echo "🛡️ Installing and configuring Firewall..."
if ! command -v ufw &> /dev/null; then
    sudo apt-get install -y ufw
fi
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
# Enable if not already enabled (be careful with SSH!)
# sudo ufw enable

echo "✅ Server Setup Complete! Ready to deploy application."
