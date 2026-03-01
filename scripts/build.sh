#!/bin/bash

# Dethernety OSS Production Build Script
# This script builds the application for production deployment

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Determine project root from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Starting Dethernety Production Build..."
echo "Project root: $PROJECT_ROOT"

# Change to project root
cd "$PROJECT_ROOT"

# Verify we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Could not find package.json in project root: $PROJECT_ROOT${NC}"
    exit 1
fi

# Check if environment file exists
if [ ! -f ".env.production" ]; then
    echo -e "${YELLOW}Warning: .env.production not found${NC}"
    echo -e "   Copy env.production.template to .env.production and configure it"
    echo -e "   Continuing with default environment..."
fi

echo -e "${BLUE}Installing dependencies...${NC}"
pnpm install

echo -e "${BLUE}Building packages...${NC}"
pnpm turbo build --filter="./packages/*"

echo -e "${BLUE}Building frontend (dt-ui)...${NC}"
echo -e "${BLUE}Using runtime configuration - no build-time environment injection needed${NC}"

cd apps/dt-ui
NODE_ENV=production pnpm build:production
cd ../..

echo -e "${BLUE}Building backend (dt-ws)...${NC}"
cd apps/dt-ws
NODE_ENV=production pnpm build:production
cd ../..

echo -e "${BLUE}Preparing deployment assets...${NC}"
# Backup existing backend assets (modules, img, etc.)
if [ -d "apps/dt-ws/public" ]; then
  echo -e "${YELLOW}Backing up existing backend assets...${NC}"
  mkdir -p apps/dt-ws/public.backup
  for dir in img; do
    if [ -d "apps/dt-ws/public/$dir" ]; then
      cp -r "apps/dt-ws/public/$dir" apps/dt-ws/public.backup/
    fi
  done
fi

# Clear public directory
mkdir -p apps/dt-ws/public/
rm -rf apps/dt-ws/public/*

# Copy built frontend directly to backend public directory
echo -e "${BLUE}Deploying frontend to /public (root serving)...${NC}"
cp -r apps/dt-ui/dist/* apps/dt-ws/public/

# Restore backend-specific assets
if [ -d "apps/dt-ws/public.backup" ]; then
  echo -e "${BLUE}Restoring backend assets...${NC}"
  for dir in img; do
    if [ -d "apps/dt-ws/public.backup/$dir" ]; then
      cp -r "apps/dt-ws/public.backup/$dir" apps/dt-ws/public/
    fi
  done
  rm -rf apps/dt-ws/public.backup
fi

echo -e "${GREEN}Production build completed successfully!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "   1. Configure .env.production with your settings"
echo "   2. Test locally: cd apps/dt-ws && NODE_ENV=production pnpm start:prod"
echo "   3. Build Docker image: docker build -f Dockerfile.production -t dethernety:latest ."
echo "   4. Deploy: docker run --env-file .env.production -p 3000:3000 dethernety:latest"
echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "   - Configuration: docs/CONFIGURATION_GUIDE.md"
