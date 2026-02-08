/**
 * ENS Subdomain Manager - NameWrapper Implementation
 * 
 * Creates subdomains using the ENS NameWrapper contract
 * following the official ENS documentation
 */

import { ethers } from 'ethers';

// ENS Contract Addresses by Network
const CONTRACT_ADDRESSES: Record<number, { nameWrapper: string; publicResolver: string }> = {
  1: { // Ethereum Mainnet
    nameWrapper: '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401',
    publicResolver: '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63',
  },
  11155111: { // Sepolia
    nameWrapper: '0x0635513f179D50A207757E05759CbD106d7dFcE8',
    publicResolver: '0x8FADE66B79cC9f707aB26799354482EB93a5B7dD',
  },
};

// Fuse constants from ENS NameWrapper
export const FUSES = {
  CANNOT_UNWRAP: 1,
  CANNOT_BURN_FUSES: 2,
  CANNOT_TRANSFER: 4,
  CANNOT_SET_RESOLVER: 8,
  CANNOT_SET_TTL: 16,
  CANNOT_CREATE_SUBDOMAIN: 32,
  CANNOT_APPROVE: 64,
  PARENT_CANNOT_CONTROL: 65536, // Makes subdomain emancipated
  CAN_EXTEND_EXPIRY: 262144,
};

const NAME_WRAPPER_ABI = [
  'function ownerOf(uint256 id) view returns (address)',
  'function getData(uint256 id) view returns (address owner, uint32 fuses, uint64 expiry)',
  'function setSubnodeOwner(bytes32 parentNode, string label, address owner, uint32 fuses, uint64 expiry) returns (bytes32)',
  'function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry) returns (bytes32)',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
];

const RESOLVER_ABI = [
  'function addr(bytes32 node) view returns (address)',
  'function setAddr(bytes32 node, address addr)',
  'function setText(bytes32 node, string key, string value)',
];

export class SubdomainManager {
  private signer: ethers.Signer;
  private provider: ethers.Provider;
  private chainId: number | null = null;

  constructor(signer: ethers.Signer) {
    this.signer = signer;
    this.provider = signer.provider!;
  }

  /**
   * Get the current network chain ID
   */
  private async getChainId(): Promise<number> {
    if (this.chainId === null) {
      const network = await this.provider.getNetwork();
      this.chainId = Number(network.chainId);
    }
    return this.chainId;
  }

  /**
   * Get contract addresses for current network
   */
  private async getContractAddresses(): Promise<{ nameWrapper: string; publicResolver: string }> {
    const chainId = await this.getChainId();
    const addresses = CONTRACT_ADDRESSES[chainId];
    
    if (!addresses) {
      const networkName = chainId === 137 ? 'Polygon' : chainId === 8453 ? 'Base' : chainId === 10 ? 'Optimism' : `Chain ${chainId}`;
      throw new Error(
        `ENS subdomain creation is not available on ${networkName}. Please switch to Ethereum Mainnet (Chain 1) or Sepolia Testnet (Chain 11155111) in your wallet.`
      );
    }
    
    return addresses;
  }

  /**
   * Calculate namehash for ENS names (ENSIP-1)
   */
  namehash(name: string): string {
    let node = ethers.ZeroHash;
    if (name === '') return node;

    const labels = name.split('.').reverse();
    for (const label of labels) {
      const labelHash = ethers.id(label);
      node = ethers.keccak256(ethers.concat([node, labelHash]));
    }
    return node;
  }

  /**
   * Convert namehash to tokenId for NameWrapper ERC-1155
   */
  private nameToTokenId(name: string): bigint {
    return BigInt(this.namehash(name));
  }

  /**
   * Check if a name is wrapped in the NameWrapper
   */
  async isWrapped(domain: string): Promise<boolean> {
    try {
      const chainId = await this.getChainId();
      const { nameWrapper: nameWrapperAddress } = await this.getContractAddresses();
      
      console.log(`Checking if ${domain} is wrapped on chain ${chainId}`);
      console.log(`Using NameWrapper: ${nameWrapperAddress}`);
      
      const nameWrapper = new ethers.Contract(
        nameWrapperAddress,
        NAME_WRAPPER_ABI,
        this.provider
      );

      const tokenId = this.nameToTokenId(domain);
      console.log(`Token ID: ${tokenId}`);
      
      const owner = await nameWrapper.ownerOf(tokenId);
      console.log(`Owner: ${owner}`);

      return owner !== ethers.ZeroAddress;
    } catch (error) {
      console.error(`Error checking if ${domain} is wrapped:`, error);
      // If ownerOf reverts, the name is not wrapped
      return false;
    }
  }

  /**
   * Check if an address owns a wrapped domain
   */
  async checkOwnership(domain: string, address: string): Promise<boolean> {
    try {
      const { nameWrapper: nameWrapperAddress } = await this.getContractAddresses();
      const nameWrapper = new ethers.Contract(
        nameWrapperAddress,
        NAME_WRAPPER_ABI,
        this.provider
      );

      const tokenId = this.nameToTokenId(domain);
      const owner = await nameWrapper.ownerOf(tokenId);

      return owner.toLowerCase() === address.toLowerCase();
    } catch (error) {
      console.error('Error checking ownership:', error);
      return false;
    }
  }

  /**
   * Get name data (owner, fuses, expiry) for a wrapped name
   */
  async getNameData(domain: string): Promise<{
    owner: string;
    fuses: number;
    expiry: bigint;
  } | null> {
    try {
      const { nameWrapper: nameWrapperAddress } = await this.getContractAddresses();
      const nameWrapper = new ethers.Contract(
        nameWrapperAddress,
        NAME_WRAPPER_ABI,
        this.provider
      );

      const tokenId = this.nameToTokenId(domain);
      const [owner, fuses, expiry] = await nameWrapper.getData(tokenId);

      return { 
        owner, 
        fuses: Number(fuses), 
        expiry: BigInt(expiry) 
      };
    } catch (error) {
      console.error('Error getting name data:', error);
      return null;
    }
  }

  /**
   * Check if a subdomain is available (doesn't exist)
   */
  async isSubdomainAvailable(parentDomain: string, label: string): Promise<boolean> {
    try {
      const subdomainName = `${label}.${parentDomain}`;
      const tokenId = this.nameToTokenId(subdomainName);

      const { nameWrapper: nameWrapperAddress } = await this.getContractAddresses();
      const nameWrapper = new ethers.Contract(
        nameWrapperAddress,
        NAME_WRAPPER_ABI,
        this.provider
      );

      try {
        const owner = await nameWrapper.ownerOf(tokenId);
        return owner === ethers.ZeroAddress;
      } catch {
        // If ownerOf reverts, subdomain doesn't exist
        return true;
      }
    } catch (error) {
      console.error('Error checking subdomain availability:', error);
      return false;
    }
  }

  /**
   * Create a wrapped subdomain using NameWrapper
   */
  async createSubdomain(
    parentDomain: string,
    label: string,
    ownerAddress: string,
    options?: {
      resolverAddress?: string;
      fuses?: number;
      durationInSeconds?: number;
    }
  ): Promise<{
    success: boolean;
    transactionHash?: string;
    subdomainName?: string;
    error?: string;
  }> {
    try {
      const signerAddress = await this.signer.getAddress();

      // Check if parent is wrapped
      const isWrapped = await this.isWrapped(parentDomain);
      if (!isWrapped) {
        return {
          success: false,
          error: `${parentDomain} is not wrapped. Please wrap it first at https://app.ens.domains`,
        };
      }

      // Check ownership
      const isOwner = await this.checkOwnership(parentDomain, signerAddress);
      if (!isOwner) {
        return {
          success: false,
          error: 'You do not own this domain',
        };
      }

      // Check availability
      const isAvailable = await this.isSubdomainAvailable(parentDomain, label);
      if (!isAvailable) {
        return {
          success: false,
          error: 'Subdomain already exists',
        };
      }

      // Get parent name data for expiry
      const parentData = await this.getNameData(parentDomain);
      if (!parentData) {
        return {
          success: false,
          error: 'Could not retrieve parent name data',
        };
      }

      // Check if parent has CANNOT_CREATE_SUBDOMAIN fuse burned
      const CANNOT_CREATE_SUBDOMAIN_FUSE = 32;
      const fusesNum = Number(parentData.fuses);
      if ((fusesNum & CANNOT_CREATE_SUBDOMAIN_FUSE) !== 0) {
        return {
          success: false,
          error: 'Parent name has CANNOT_CREATE_SUBDOMAIN fuse burned. You cannot create subdomains.',
        };
      }

      const { nameWrapper: nameWrapperAddress } = await this.getContractAddresses();
      const nameWrapper = new ethers.Contract(
        nameWrapperAddress,
        NAME_WRAPPER_ABI,
        this.signer
      );

      const parentNode = this.namehash(parentDomain);
      
      // Check if parent is locked (has CANNOT_UNWRAP burned)
      const CANNOT_UNWRAP = 1;
      const parentIsLocked = (Number(parentData.fuses) & CANNOT_UNWRAP) !== 0;
      
      // Default: PARENT_CANNOT_CONTROL only if parent is locked
      // If parent isn't locked, create a regular subdomain (no fuses)
      let fuses = options?.fuses ?? 0;
      
      if (!parentIsLocked && fuses !== 0) {
        console.warn('Parent is not locked. Creating subdomain without fuses.');
        fuses = 0;
      }
      
      // Expiry: match parent or set custom duration (capped at parent's expiry)
      let expiry: bigint;
      if (options?.durationInSeconds) {
        const now = BigInt(Math.floor(Date.now() / 1000));
        expiry = now + BigInt(options.durationInSeconds);
        if (expiry > parentData.expiry) {
          expiry = parentData.expiry;
        }
      } else {
        expiry = parentData.expiry;
      }

      let tx;
      if (options?.resolverAddress) {
        // Use setSubnodeRecord to set resolver in same transaction
        tx = await nameWrapper.setSubnodeRecord(
          parentNode,
          label,
          ownerAddress,
          options.resolverAddress,
          0, // ttl
          fuses,
          expiry
        );
      } else {
        // Use setSubnodeOwner
        tx = await nameWrapper.setSubnodeOwner(
          parentNode,
          label,
          ownerAddress,
          fuses,
          expiry
        );
      }

      const receipt = await tx.wait();
      const subdomainName = `${label}.${parentDomain}`;

      return {
        success: true,
        transactionHash: receipt.hash,
        subdomainName,
      };
    } catch (error: any) {
      console.error('Error creating subdomain:', error);
      
      // Parse common NameWrapper errors
      let errorMessage = 'Unknown error occurred';
      
      if (error.message) {
        if (error.message.includes('OperationProhibited')) {
          errorMessage = 'Operation prohibited. The parent name may have restrictions preventing subdomain creation.';
        } else if (error.message.includes('Unauthorized')) {
          errorMessage = 'Unauthorized. You do not have permission to create subdomains for this name.';
        } else if (error.message.includes('Expired')) {
          errorMessage = 'The parent name has expired.';
        } else if (error.message.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user.';
        } else {
          errorMessage = error.message;
        }
      }
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Set address record for a subdomain
   */
  async setSubdomainAddress(
    subdomainName: string,
    address: string,
    resolverAddress?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { publicResolver } = await this.getContractAddresses();
      const resolver = resolverAddress || publicResolver;
      const resolverContract = new ethers.Contract(
        resolver,
        RESOLVER_ABI,
        this.signer
      );

      const node = this.namehash(subdomainName);
      const tx = await resolverContract.setAddr(node, address);
      await tx.wait();

      return { success: true };
    } catch (error) {
      console.error('Error setting subdomain address:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Set text record for a subdomain
   */
  async setSubdomainText(
    subdomainName: string,
    key: string,
    value: string,
    resolverAddress?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { publicResolver } = await this.getContractAddresses();
      const resolver = resolverAddress || publicResolver;
      const resolverContract = new ethers.Contract(
        resolver,
        RESOLVER_ABI,
        this.signer
      );

      const node = this.namehash(subdomainName);
      const tx = await resolverContract.setText(node, key, value);
      await tx.wait();

      return { success: true };
    } catch (error) {
      console.error('Error setting subdomain text:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
