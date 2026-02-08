
## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local`:
```bash
NEXT_PUBLIC_RPC_URL=https://ethereum.publicnode.com
```

3. Start development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Features

- Forward resolution (name to address)
- Reverse resolution (address to name)
- Text records (avatar, social profiles)
- Multi-chain addresses
- Content hash resolution
- Subdomain creation (NameWrapper-based)
- Multi-network support (Mainnet & Sepolia)

## Supported Networks

- **Ethereum Mainnet** (Chain ID: 1)
- **Sepolia Testnet** (Chain ID: 11155111)

The app automatically detects the connected network and uses the appropriate ENS contracts.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- ethers.js v6
- Tailwind CSS
