
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

## System Architecture

The application follows a layered architecture for ENS operations:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                               USER INTERFACE                                    │
├─────────────────────────────────────┬──────────────────────────────────────────┤
│  ENSProfile.tsx                     │  SubdomainCreator.tsx                    │
│  - Search ENS names                 │  - Create subdomains                     │
│  - Display profiles                 │  - Manage ownership                      │
│  - Show multi-chain addresses       │  - Set fuses/permissions                 │
└─────────────────────────────────────┴──────────────────────────────────────────┘
                                      ↓
┌────────────────────────────────────────────────────────────────────────────────┐
│                           REACT CONTEXT LAYER                                   │
├────────────────────────────────────────────────────────────────────────────────┤
│  ENSContext (context.tsx)                                                       │
│  - useENSProfile(name) → Profile data                                           │
│  - useENSAddress(name) → ETH address                                            │
│  - useMultiChainAddresses(name) → All chain addresses                           │
│  - State management & caching                                                   │
└────────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌────────────────────────────────────────────────────────────────────────────────┐
│                          CORE ENS RESOLVERS                                     │
├──────────────────────────────┬─────────────────────────────────────────────────┤
│  ENSResolver                 │  SubdomainManager                               │
│  (resolver.ts)               │  (subdomain-manager.ts)                         │
│  - Name resolution           │  - Subdomain creation                           │
│  - Multi-chain addresses     │  - Fuse management                              │
│  - Text records              │  - Ownership verification                       │
│  - Content hash              │  - Network detection                            │
└──────────────────────────────┴─────────────────────────────────────────────────┘
```

## ENS Name Resolution Flow

### Feature: Resolve ENS Name → Ethereum Address

#### Architecture Flow
```
┌─────────────────┐
│ ENSProfile.tsx  │
│ User Input      │
└────────┬────────┘
         │ "vishruth2025taipei.eth"
         ▼
┌─────────────────┐
│ useENSProfile() │
│ React Hook      │
└────────┬────────┘
         │ Triggers getProfile()
         ▼
┌─────────────────┐
│ resolveENS()    │
│ Core Function   │
└────────┬────────┘
         │
         ├─────────────────────────────────────────┐
         │                                         │
         ▼                                         ▼
┌──────────────────┐                    ┌──────────────────┐
│ Step 1: namehash │                    │ Step 2: Resolver │
└──────────────────┘                    └──────────────────┘
         │                                         │
         │                                         ▼
         │                              ┌──────────────────┐
         │                              │ Step 3: Address  │
         │                              └──────────────────┘
         │                                         │
         └─────────────────────────────────────────┘
                           │
                           ▼
                  ┌────────────────┐
                  │ Return Profile │
                  │ Data to UI     │
                  └────────────────┘
```

### Step-by-Step Process

#### Step 1: Namehash Calculation

The namehash algorithm converts human-readable names into bytes32 identifiers used by ENS contracts.

```typescript
// File: lib/ens/resolver.ts:102-140
function namehash(name: string): string {
  // Input: "vishruth2025taipei.eth"
  
  // Process:
  // 1. Split by "." → ["vishruth2025taipei", "eth"]
  // 2. Reverse order → ["eth", "vishruth2025taipei"]
  // 3. Hash each label recursively:
  //    - Start: 0x0000...0000 (32 bytes)
  //    - Hash "eth": keccak256(0x0000...0000 + keccak256("eth"))
  //      → 0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae
  //    - Hash "vishruth2025taipei": 
  //      keccak256(0x93cd... + keccak256("vishruth2025taipei"))
  //      → 0x83bc9230fca2ab2b9a9f601b123922214f94337c8d51de7d2775558b8d47f619
  
  // Output: 0x83bc9230fca2ab2b9a9f601b123922214f94337c8d51de7d2775558b8d47f619
}
```

#### Step 2: Get Resolver Address

Query the ENS Registry to find which resolver contract handles this name.

```typescript
// Contract: ENS Registry (0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e)
// Network: Sepolia (11155111)
// Method: resolver(bytes32 node)

const resolverAddress = await registry.resolver(
  "0x83bc9230fca2ab2b9a9f601b123922214f94337c8d51de7d2775558b8d47f619"
);

// Returns: 0x8FADE66B79cC9f707aB26799354482EB93a5B7dD
//          (Sepolia Public Resolver)
```

#### Step 3: Get ETH Address

Query the resolver contract for the Ethereum address associated with this name.

```typescript
// Contract: Public Resolver (0x8FADE66B79cC9f707aB26799354482EB93a5B7dD)
// Method: addr(bytes32 node)

const ethAddress = await resolver.addr(
  "0x83bc9230fca2ab2b9a9f601b123922214f94337c8d51de7d2775558b8d47f619"
);

// Returns: 0x657Ec760F0689119DB61155bCa25cfAc5E286Dba
```

### Complete Example

```typescript
// Input
const ensName = "vishruth2025taipei.eth";

// Step 1: Calculate namehash
const node = namehash(ensName);
// → 0x83bc9230fca2ab2b9a9f601b123922214f94337c8d51de7d2775558b8d47f619

// Step 2: Get resolver
const resolverAddr = await registry.resolver(node);
// → 0x8FADE66B79cC9f707aB26799354482EB93a5B7dD (Sepolia Public Resolver)

// Step 3: Get address
const ethAddress = await resolver.addr(node);
// → 0x657Ec760F0689119DB61155bCa25cfAc5E286Dba

// Response Flow: resolver.ts → context.tsx → ENSProfile.tsx
// Result: {
//   address: "0x657Ec760F0689119DB61155bCa25cfAc5E286Dba",
//   name: "vishruth2025taipei.eth"
// }
```

### File Locations

| Component | File Path | Lines |
|-----------|-----------|-------|
| UI Component | `components/ENSProfile.tsx` | - |
| React Hook | `lib/ens/context.tsx` | 96-130 |
| Core Resolver | `lib/ens/resolver.ts` | 102-140 |
| Namehash Algorithm | `lib/ens/resolver.ts` | - |

## Subdomain Creation Flow

The subdomain creation system performs a 10-step validation and execution process:

### Process Overview

| Step | Phase | Action | Example |
|------|-------|--------|---------|
| 1️⃣ | **User Input** | Parent name + label entry | `vishruth2025taipei.eth` + `devine` |
| 2️⃣ | **Network Check** | Detect and validate chain | Sepolia (11155111) ✓ |
| 3️⃣ | **Wrapped Check** | Verify parent is wrapped | `isWrapped()` → `0x657...` ✓ |
| 4️⃣ | **Owner Verification** | Confirm wallet ownership | `checkOwnership()` → Match ✓ |
| 5️⃣ | **Availability Check** | Ensure subdomain is free | `isAvailable()` → Available ✓ |
| 6️⃣ | **Hashing** | Calculate node identifiers | `parentNode`, `labelHash`, `subdomainNode` |
| 7️⃣ | **Parent Data** | Retrieve parent metadata | Fuses: 0, Expiry: 2026 |
| 8️⃣ | **Fuses Logic** | Determine subdomain fuses | Parent not locked → Fuses: 0 |
| 9️⃣ | **Contract TX** | Execute `setSubnodeRecord()` | Gas: ~150k, Sign & Send |
| 🔟 | **Success** | Subdomain created | `devine.vishruth2025taipei.eth` ✓ |

### Detailed Flow

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ User Input  │ → │ Network     │ → │ Wrapped     │ → │ Owner       │ → │ Availability│
│             │   │ Check       │   │ Check       │   │ Verify      │   │ Check       │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
                                                                                 ↓
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ Success     │ ← │ Contract    │ ← │ Fuses       │ ← │ Parent      │ ← │ Hashing     │
│             │   │ Transaction │   │ Logic       │   │ Data        │   │             │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
```

### Key Components

#### Pre-Flight Checks
```typescript
// 1. Network Detection
const chainId = await provider.getNetwork().then(n => n.chainId);
// Sepolia: 11155111, Mainnet: 1

// 2. Wrapped Status
const wrappedAddress = await nameWrapper.ownerOf(parentNode);
// Returns address if wrapped, throws if not

// 3. Ownership Verification
const isOwner = wrappedAddress.toLowerCase() === signerAddress.toLowerCase();

// 4. Availability Check
const existingOwner = await nameWrapper.ownerOf(subdomainNode);
// Available if owner is 0x0000...0000
```

#### Fuse Management
```typescript
// Parent must be locked (CANNOT_UNWRAP) to set PARENT_CANNOT_CONTROL
const [owner, parentFuses] = await nameWrapper.getData(parentNode);
const isParentLocked = (parentFuses & CANNOT_UNWRAP) !== 0n;

let fuses = 0;
if (isParentLocked) {
  fuses = PARENT_CANNOT_CONTROL; // 65536
}
```

#### Contract Execution
```typescript
// Create subdomain with NameWrapper
await nameWrapper.setSubnodeRecord(
  parentNode,      // bytes32: parent name hash
  label,           // string: subdomain label
  signerAddress,   // address: subdomain owner
  resolverAddress, // address: resolver contract
  0,               // uint64: TTL (0 = inherit)
  fuses,           // uint32: permission fuses
  expiry           // uint64: expiration timestamp
);
```

### Network-Specific Contracts

#### Ethereum Mainnet (Chain ID: 1)
- **NameWrapper**: `0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401`
- **Public Resolver**: `0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63`
- **ENS Registry**: `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`

#### Sepolia Testnet (Chain ID: 11155111)
- **NameWrapper**: `0x0635513f179D50A207757E05759CbD106d7dFcE8`
- **Public Resolver**: `0x8FADE66B79cC9f707aB26799354482EB93a5B7dD`
- **ENS Registry**: `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`

### Fuse Constants

| Fuse | Value | Description |
|------|-------|-------------|
| `CANNOT_UNWRAP` | 1 | Prevents unwrapping (locks the name) |
| `CANNOT_BURN_FUSES` | 2 | Prevents burning additional fuses |
| `CANNOT_TRANSFER` | 4 | Prevents transferring ownership |
| `CANNOT_SET_RESOLVER` | 8 | Prevents changing resolver |
| `CANNOT_SET_TTL` | 16 | Prevents changing TTL |
| `CANNOT_CREATE_SUBDOMAIN` | 32 | Prevents creating subdomains |
| `PARENT_CANNOT_CONTROL` | 65536 | Parent cannot reclaim subdomain |

### Example: Creating `devine.vishruth2025taipei.eth`

```typescript
// Input
const parentName = "vishruth2025taipei.eth";
const label = "devine";

// Validation Results
Network: Sepolia (11155111) ✓
Wrapped: 0x657... ✓
Owner: Match ✓
Available: true ✓

// Calculated Values
parentNode: 0x8e5f... (namehash of vishruth2025taipei.eth)
labelHash: 0x9c3a... (keccak256 of "devine")
subdomainNode: 0x4f7b... (namehash of devine.vishruth2025taipei.eth)

// Parent Data
Owner: 0x657...
Fuses: 0 (not locked)
Expiry: 1767225600 (2026)

// Transaction
Fuses: 0 (parent not locked, regular subdomain)
Gas: ~150,000
Status: Success ✓
```

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- ethers.js v6
- Tailwind CSS
- ENS NameWrapper Protocol
