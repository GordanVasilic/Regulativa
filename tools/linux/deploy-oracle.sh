#!/bin/bash
set -e

echo "Starting deployment..."

# 1. Pull latest code
echo "Pulling latest code..."
git pull origin main

# 2. Build and start containers
echo "Building and starting containers..."
docker-compose up -d --build

# 3. Wait for MeiliSearch to be ready
echo "Waiting for services to stabilize..."
sleep 15

# 4. Reindex MeiliSearch
# We use -T to disable pseudo-tty allocation for automation
echo "Running MeiliSearch indexing..."
docker-compose exec -T api npm run reindex

echo "Deployment finished successfully!"
echo "App should be running on port 8080 (Web) and 5000 (API)."
