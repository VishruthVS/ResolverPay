/**
 * ENS Subdomain Manager - NameWrapper Implementation
 * 
 * Creates subdomains using the ENS NameWrapper contract
 * following the official ENS documentation
 */

import { ethers } from 'ethers';

// ENS Contract Addresses (Ethereum Mainnet)
const NAME_WRAPPER_ADDRESS = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401';
const PUBLIC_RESOLVER_ADDRESS = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63';

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

  constructor(signer: ethers.Signer) {
    this.signer = signer;
    this.provider = signer.provider!;
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
      const nameWrapper = new ethers.Contract(
        NAME_WRAPPER_ADDRESS,
        NAME_WRAPPER_ABI,
        this.provider
      );

      const tokenId = this.nameToTokenId(domain);
      const owner = await nameWrapper.ownerOf(tokenId);

      return owner !== ethers.ZeroAddress;
    } catch (error) {
      // If ownerOf reverts, the name is not wrapped
      return false;
    }
  }

  /**
   * Check if an address owns a wrapped domain
   */
  async checkOwnership(domain: string, address: string): Promise<boolean> {
    try {
      const nameWrapper = new ethers.Contract(
        NAME_WRAPPER_ADDRESS,
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
      const nameWrapper = new ethers.Contract(
        NAME_WRAPPER_ADDRESS,
        NAME_WRAPPER_ABI,
        this.provider
      );

      const tokenId = this.nameToTokenId(domain);
      const [owner, fuses, expiry] = await nameWrapper.getData(tokenId);

      return { owner, fuses, expiry };
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

      const nameWrapper = new ethers.Contract(
        NAME_WRAPPER_ADDRESS,
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

      const nameWrapper = new ethers.Contract(
        NAME_WRAPPER_ADDRESS,
        NAME_WRAPPER_ABI,
        this.signer
      );

      const parentNode = this.namehash(parentDomain);
      
      // Default: PARENT_CANNOT_CONTROL (emancipated subdomain)
      const fuses = options?.fuses ?? FUSES.PARENT_CANNOT_CONTROL;
      
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
    } catch (error) {
      console.error('Error creating subdomain:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
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
      const resolver = resolverAddress || PUBLIC_RESOLVER_ADDRESS;
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
      const resolver = resolverAddress || PUBLIC_RESOLVER_ADDRESS;
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
