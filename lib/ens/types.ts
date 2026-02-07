/**
 * ENS Integration Types
 * Production-ready TypeScript interfaces for ENS functionality
 */

export interface ENSProfile {
  name: string;
  address: string | null;
  avatar: string | null;
  description: string | null;
  twitter: string | null;
  github: string | null;
  discord: string | null;
  telegram: string | null;
  email: string | null;
  url: string | null;
  notice: string | null;
  keywords: string | null;
  contentHash: string | null;
}

export interface ENSTextRecord {
  key: string;
  value: string | null;
}

export interface MultiChainAddress {
  coinType: number;
  address: string;
  chainName: string;
}

export interface ENSResolverInfo {
  address: string;
  supportsInterface: (interfaceId: string) => Promise<boolean>;
}

export interface ENSRegistryInfo {
  owner: string;
  resolver: string;
  ttl: bigint;
}

export interface ENSError {
  code: string;
  message: string;
  name?: string;
  details?: unknown;
}

export interface ContentHashInfo {
  decoded: string;
  protocolType: string | null;
  hash: string | null;
}

export const COIN_TYPES = {
  ETH: 60,
  BTC: 0,
  LTC: 2,
  DOGE: 3,
  MATIC: 966,
  BNB: 714,
  AVAX: 9000,
  ARB: 2147525809,
  OP: 2147483658,
} as const;

export const TEXT_RECORD_KEYS = {
  // Social
  TWITTER: 'com.twitter',
  GITHUB: 'com.github',
  DISCORD: 'com.discord',
  TELEGRAM: 'org.telegram',
  
  // Contact
  EMAIL: 'email',
  URL: 'url',
  
  // Profile
  AVATAR: 'avatar',
  DESCRIPTION: 'description',
  NOTICE: 'notice',
  KEYWORDS: 'keywords',
  
  // Other
  CONTENT_HASH: 'contenthash',
} as const;

export const ENS_CONTRACTS = {
  REGISTRY: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
  REVERSE_REGISTRAR: '0x084b1c3C81545d370f3634392De611CaaBFf8482',
  PUBLIC_RESOLVER: '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41',
} as const;

export const INTERFACE_IDS = {
  ADDR: '0x3b3b57de',
  TEXT: '0x59d1d43c',
  CONTENT_HASH: '0xbc1c58d1',
  MULTICOIN_ADDR: '0xf1cb7e06',
  NAME: '0x691f3431',
} as const;
