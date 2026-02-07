'use client';

/**
 * ENS Context Provider
 * Provides ENS resolver instance to the entire application
 */

import React, { createContext, useContext, useMemo } from 'react';
import { ethers } from 'ethers';
import { ENSResolver } from '@/lib/ens/resolver';
import type { ENSProfile, MultiChainAddress } from '@/lib/ens/types';

interface ENSContextValue {
  resolver: ENSResolver;
  // Convenience methods that components can call directly
  resolveAddress: (name: string) => Promise<string | null>;
  reverseLookup: (address: string) => Promise<string | null>;
  getProfile: (name: string) => Promise<ENSProfile | null>;
  getAvatar: (name: string) => Promise<string | null>;
  getTextRecord: (name: string, key: string) => Promise<string | null>;
  getMultiChainAddress: (name: string, coinType: number) => Promise<string | null>;
  getAllChainAddresses: (name: string) => Promise<MultiChainAddress[]>;
  validateName: (name: string) => { valid: boolean; error?: string };
}

const ENSContext = createContext<ENSContextValue | null>(null);

interface ENSProviderProps {
  children: React.ReactNode;
  rpcUrl?: string;
}

export function ENSProvider({ children, rpcUrl }: ENSProviderProps) {
  // Create resolver instance with RPC URL from env or provided prop
  const resolver = useMemo(() => {
    const url = rpcUrl || process.env.NEXT_PUBLIC_RPC_URL;
    
    if (!url) {
      console.warn('No RPC URL provided, using default Ethereum provider');
      return new ENSResolver(ethers.getDefaultProvider('mainnet'));
    }

    const provider = new ethers.JsonRpcProvider(url);
    return new ENSResolver(provider);
  }, [rpcUrl]);

  // Create context value with bound methods
  const contextValue = useMemo<ENSContextValue>(
    () => ({
      resolver,
      resolveAddress: (name: string) => resolver.resolveAddress(name),
      reverseLookup: (address: string) => resolver.reverseLookup(address),
      getProfile: (name: string) => resolver.getProfile(name),
      getAvatar: (name: string) => resolver.getAvatar(name),
      getTextRecord: (name: string, key: string) => resolver.getTextRecord(name, key),
      getMultiChainAddress: (name: string, coinType: number) =>
        resolver.getMultiChainAddress(name, coinType),
      getAllChainAddresses: (name: string) => resolver.getAllChainAddresses(name),
      validateName: (name: string) => resolver.validateName(name),
    }),
    [resolver]
  );

  return <ENSContext.Provider value={contextValue}>{children}</ENSContext.Provider>;
}

/**
 * Hook to access ENS resolver in components
 */
export function useENS() {
  const context = useContext(ENSContext);
  
  if (!context) {
    throw new Error('useENS must be used within an ENSProvider');
  }
  
  return context;
}

/**
 * Hook for ENS profile with loading and error states
 */
export function useENSProfile(name: string | null) {
  const { getProfile } = useENS();
  const [profile, setProfile] = React.useState<ENSProfile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!name) {
      setProfile(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getProfile(name)
      .then((result) => {
        setProfile(result);
        if (!result) {
          setError('Profile not found or name not registered');
        }
      })
      .catch((err) => {
        console.error('Failed to fetch ENS profile:', err);
        setError(err.message || 'Failed to fetch profile');
        setProfile(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [name, getProfile]);

  return { profile, loading, error };
}

/**
 * Hook for ENS address resolution with loading state
 */
export function useENSAddress(name: string | null) {
  const { resolveAddress } = useENS();
  const [address, setAddress] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!name) {
      setAddress(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    resolveAddress(name)
      .then((result) => {
        setAddress(result);
        if (!result) {
          setError('Address not found');
        }
      })
      .catch((err) => {
        console.error('Failed to resolve ENS address:', err);
        setError(err.message || 'Failed to resolve address');
        setAddress(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [name, resolveAddress]);

  return { address, loading, error };
}

/**
 * Hook for reverse ENS lookup
 */
export function useENSName(address: string | null) {
  const { reverseLookup } = useENS();
  const [name, setName] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!address) {
      setName(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    reverseLookup(address)
      .then((result) => {
        setName(result);
        if (!result) {
          setError('No ENS name found for this address');
        }
      })
      .catch((err) => {
        console.error('Failed to reverse lookup ENS name:', err);
        setError(err.message || 'Failed to reverse lookup');
        setName(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [address, reverseLookup]);

  return { name, loading, error };
}

/**
 * Hook for multi-chain addresses
 */
export function useMultiChainAddresses(name: string | null) {
  const { getAllChainAddresses } = useENS();
  const [addresses, setAddresses] = React.useState<MultiChainAddress[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!name) {
      setAddresses([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getAllChainAddresses(name)
      .then((result) => {
        setAddresses(result);
      })
      .catch((err) => {
        console.error('Failed to fetch multi-chain addresses:', err);
        setError(err.message || 'Failed to fetch addresses');
        setAddresses([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [name, getAllChainAddresses]);

  return { addresses, loading, error };
}
