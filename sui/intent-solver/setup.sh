#!/bin/bash

# ============================================================================
# Intent Protocol V2 - Setup Script
# ============================================================================
# This script sets up the project structure and installs dependencies
# ============================================================================

set -e  # Exit on error

echo "🚀 Intent Protocol V2 - Project Setup"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js detected: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo -e "${GREEN}✓${NC} npm detected: $(npm --version)"
echo ""

# Create directory structure
echo -e "${BLUE}📁 Creating directory structure...${NC}"

mkdir -p src
mkdir -p config
mkdir -p scripts
mkdir -p test
mkdir -p data
mkdir -p logs

echo -e "${GREEN}✓${NC} Directories created"
echo ""

# Check if files exist in current directory
echo -e "${BLUE}📦 Organizing project files...${NC}"

# Move TypeScript files to src/ if they exist in root
if [ -f "intent-protocol-sdk.ts" ]; then
    mv intent-protocol-sdk.ts src/
    echo -e "${GREEN}✓${NC} Moved intent-protocol-sdk.ts to src/"
fi

if [ -f "solver-engine.ts" ]; then
    mv solver-engine.ts src/
    echo -e "${GREEN}✓${NC} Moved solver-engine.ts to src/"
fi

if [ -f "examples.ts" ]; then
    mv examples.ts src/
    echo -e "${GREEN}✓${NC} Moved examples.ts to src/"
fi

echo ""

# Setup environment file
echo -e "${BLUE}⚙️  Setting up environment configuration...${NC}"

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}✓${NC} Created .env from .env.example"
        echo -e "${YELLOW}⚠${NC}  Please edit .env with your configuration"
    elif [ -f ".env.complete" ]; then
        cp .env.complete .env
        echo -e "${GREEN}✓${NC} Created .env from .env.complete"
        echo -e "${YELLOW}⚠${NC}  Please edit .env with your configuration"
    else
        echo -e "${YELLOW}⚠${NC}  No .env template found. You'll need to create .env manually"
    fi
else
    echo -e "${GREEN}✓${NC} .env already exists"
fi

echo ""

# Install dependencies
echo -e "${BLUE}📚 Installing dependencies...${NC}"

if [ -f "package.json" ]; then
    npm install
    echo -e "${GREEN}✓${NC} Dependencies installed"
else
    echo -e "${YELLOW}⚠${NC}  package.json not found. Creating minimal package.json..."
    
    cat > package.json << 'EOF'
{
  "name": "intent-protocol-v2",
  "version": "2.0.0",
  "description": "Intent Protocol V2 SDK and Solver Engine",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node-dev --respawn src/solver-engine.ts",
    "solver": "ts-node src/solver-engine.ts",
    "example": "ts-node src/examples.ts",
    "test": "jest",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write \"**/*.ts\""
  },
  "keywords": ["sui", "intent", "dex", "solver"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "@mysten/sui.js": "^0.50.0",
    "dotenv": "^16.0.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.9.0",
    "ts-node-dev": "^2.0.0"
  }
}
EOF
    
    npm install
    echo -e "${GREEN}✓${NC} Created package.json and installed dependencies"
fi

echo ""

# Create tsconfig.json if it doesn't exist
if [ ! -f "tsconfig.json" ]; then
    echo -e "${BLUE}📝 Creating TypeScript configuration...${NC}"
    
    cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF
    
    echo -e "${GREEN}✓${NC} Created tsconfig.json"
fi

echo ""

# Build the project
echo -e "${BLUE}🔨 Building TypeScript files...${NC}"

if npm run build 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Build successful"
else
    echo -e "${YELLOW}⚠${NC}  Build failed or no build script available"
fi

echo ""

# Create .gitignore if it doesn't exist
if [ ! -f ".gitignore" ]; then
    echo -e "${BLUE}📋 Creating .gitignore...${NC}"
    
    cat > .gitignore << 'EOF'
.env
.env.local
node_modules/
dist/
*.log
.DS_Store
*.db
data/
logs/
EOF
    
    echo -e "${GREEN}✓${NC} Created .gitignore"
fi

echo ""
echo "=============================================="
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Edit .env with your configuration:"
echo "   ${YELLOW}nano .env${NC}"
echo ""
echo "2. Add your private keys and contract addresses"
echo ""
echo "3. Run an example:"
echo "   ${YELLOW}npm run example 3${NC}  # Query open intents"
echo ""
echo "4. Start the solver:"
echo "   ${YELLOW}npm run solver${NC}"
echo ""
echo "📚 Documentation:"
echo "   Check README.md for detailed usage instructions"
echo ""
echo "🔧 Available commands:"
echo "   npm run build     - Build TypeScript"
echo "   npm run solver    - Start solver engine"
echo "   npm run example N - Run example N (1-10)"
echo ""
echo "⚠️  Important:"
echo "   - Never commit .env to git"
echo "   - Start with testnet before mainnet"
echo "   - Test with small amounts first"
echo ""
echo "=============================================="
