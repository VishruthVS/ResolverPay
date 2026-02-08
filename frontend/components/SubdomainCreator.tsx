"use client";

import { useState } from 'react';
import { ethers } from 'ethers';
import { SubdomainManager, FUSES } from '@/lib/ens/subdomain-manager';

export default function SubdomainCreator() {
  const [parentDomain, setParentDomain] = useState('');
  const [label, setLabel] = useState('');
  const [ownerAddress, setOwnerAddress] = useState('');
  const [walletConnected, setWalletConnected] = useState(false);
  const [userAddress, setUserAddress] = useState('');
  const [network, setNetwork] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{
    type: 'success' | 'error' | 'info' | null;
    message: string;
  }>({ type: null, message: '' });

  const switchToSepolia = async () => {
    try {
      if (typeof window.ethereum === 'undefined') {
        setStatus({
          type: 'error',
          message: 'MetaMask not installed',
        });
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum!);
      
      try {
        // Try to switch to Sepolia
        await provider.send('wallet_switchEthereumChain', [
          { chainId: '0xaa36a7' } // 11155111 in hex
        ]);
        
        setStatus({
          type: 'success',
          message: 'Switched to Sepolia! Please reconnect your wallet.',
        });
        
        // Reset connection state
        setWalletConnected(false);
        setNetwork('');
        
      } catch (switchError: any) {
        // This error code indicates that the chain has not been added to MetaMask
        if (switchError.code === 4902) {
          try {
            await provider.send('wallet_addEthereumChain', [
              {
                chainId: '0xaa36a7',
                chainName: 'Sepolia Test Network',
                nativeCurrency: {
                  name: 'Sepolia ETH',
                  symbol: 'ETH',
                  decimals: 18
                },
                rpcUrls: ['https://rpc.sepolia.org'],
                blockExplorerUrls: ['https://sepolia.etherscan.io']
              }
            ]);
            
            setStatus({
              type: 'success',
              message: 'Sepolia network added! Please reconnect your wallet.',
            });
            
            setWalletConnected(false);
            setNetwork('');
            
          } catch (addError) {
            setStatus({
              type: 'error',
              message: 'Failed to add Sepolia network',
            });
          }
        } else {
          setStatus({
            type: 'error',
            message: switchError?.message || 'Failed to switch network',
          });
        }
      }
    } catch (error: any) {
      setStatus({
        type: 'error',
        message: error?.message || 'An error occurred',
      });
    }
  };

  const connectWallet = async () => {
    try {
      if (typeof window.ethereum === 'undefined') {
        setStatus({
          type: 'error',
          message: 'MetaMask not installed. Please install MetaMask to create subdomains.',
        });
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      // Get network info
      const net = await provider.getNetwork();
      const chainId = Number(net.chainId);
      const networkName = chainId === 1 ? 'Mainnet' : chainId === 11155111 ? 'Sepolia' : `Unsupported (Chain ${chainId})`;
      const isSupported = chainId === 1 || chainId === 11155111;

      setUserAddress(address);
      setOwnerAddress(address);
      setNetwork(networkName);
      setWalletConnected(true);
      
      if (!isSupported) {
        setStatus({
          type: 'error',
          message: `Connected to ${networkName}. Please switch to Ethereum Mainnet or Sepolia Testnet in MetaMask.`,
        });
      } else {
        setStatus({
          type: 'success',
          message: `Connected to ${networkName}: ${address.slice(0, 6)}...${address.slice(-4)}`,
        });
      }
    } catch (error: any) {
      setStatus({
        type: 'error',
        message: error?.message || 'Failed to connect wallet',
      });
    }
  };

  const handleCreateSubdomain = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!walletConnected) {
      setStatus({ type: 'error', message: 'Please connect wallet first' });
      return;
    }

    if (!parentDomain || !label || !ownerAddress) {
      setStatus({ type: 'error', message: 'Please fill all fields' });
      return;
    }

    setLoading(true);
    setStatus({ type: 'info', message: 'Checking requirements...' });

    try {
      const provider = new ethers.BrowserProvider(window.ethereum!);
      const signer = await provider.getSigner();
      const manager = new SubdomainManager(signer);

      // Check if parent is wrapped
      setStatus({ type: 'info', message: 'Checking if domain is wrapped...' });
      const isWrapped = await manager.isWrapped(parentDomain);
      if (!isWrapped) {
        setStatus({
          type: 'error',
          message: `${parentDomain} is not wrapped. Please wrap it first at https://app.ens.domains`,
        });
        setLoading(false);
        return;
      }

      // Check ownership
      setStatus({ type: 'info', message: 'Verifying ownership...' });
      const isOwner = await manager.checkOwnership(parentDomain, userAddress);
      if (!isOwner) {
        setStatus({
          type: 'error',
          message: `You don't own ${parentDomain}. Only the owner can create subdomains. Make sure the name is wrapped and you own it.`,
        });
        setLoading(false);
        return;
      }

      // Check availability
      setStatus({ type: 'info', message: 'Checking subdomain availability...' });
      const isAvailable = await manager.isSubdomainAvailable(parentDomain, label);
      if (!isAvailable) {
        setStatus({
          type: 'error',
          message: `${label}.${parentDomain} already exists`,
        });
        setLoading(false);
        return;
      }

      // Create subdomain
      setStatus({ type: 'info', message: 'Creating subdomain... Confirm transaction in wallet.' });
      
      // Get network and set appropriate resolver
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      const resolverAddresses: Record<number, string> = {
        1: '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63', // Mainnet
        11155111: '0x8FADE66B79cC9f707aB26799354482EB93a5B7dD', // Sepolia
      };
      
      // Try without fuses first (will use PARENT_CANNOT_CONTROL only if parent is locked)
      const result = await manager.createSubdomain(
        parentDomain,
        label,
        ownerAddress,
        {
          resolverAddress: resolverAddresses[chainId],
          fuses: 0, // Let the manager decide based on parent lock status
        }
      );

      if (result.success) {
        setStatus({
          type: 'success',
          message: `Successfully created ${result.subdomainName}! Tx: ${result.transactionHash?.slice(0, 10)}...`,
        });
        setLabel('');
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Failed to create subdomain',
        });
      }
    } catch (error: any) {
      setStatus({
        type: 'error',
        message: error?.message || 'An error occurred',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
          Create Subdomain
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          Create subdomains under your owned ENS domains
        </p>

        {network && (
          <div className={`mb-4 p-3 border rounded-lg ${
            network.includes('Unsupported') 
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
          }`}>
            <p className={`text-sm ${
              network.includes('Unsupported')
                ? 'text-red-800 dark:text-red-200'
                : 'text-blue-800 dark:text-blue-200'
            }`}>
              <strong>Network:</strong> {network}
              {network.includes('Unsupported') && (
                <>
                  <span className="block mt-2 text-xs">
                    You need to be on Ethereum Mainnet or Sepolia Testnet
                  </span>
                  <button
                    onClick={switchToSepolia}
                    className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition-colors"
                  >
                    Switch to Sepolia Testnet
                  </button>
                </>
              )}
            </p>
          </div>
        )}

        {!walletConnected ? (
          <button
            onClick={connectWallet}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Connect Wallet
          </button>
        ) : (
          <form onSubmit={handleCreateSubdomain} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Parent Domain
              </label>
              <input
                type="text"
                value={parentDomain}
                onChange={(e) => setParentDomain(e.target.value.toLowerCase())}
                placeholder="example.eth"
                className="w-full px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                The ENS domain you own
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Subdomain Label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value.toLowerCase())}
                placeholder="subdomain"
                pattern="[a-z0-9\-]+"
                className="w-full px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                Preview: {label ? `${label}.${parentDomain || 'example.eth'}` : 'subdomain.example.eth'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Owner Address
              </label>
              <input
                type="text"
                value={ownerAddress}
                onChange={(e) => setOwnerAddress(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                Who will own this subdomain (defaults to your address)
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Creating...' : 'Create Subdomain'}
            </button>
          </form>
        )}

        {status.type && (
          <div
            className={`mt-4 p-4 rounded-lg ${
              status.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                : status.type === 'error'
                ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
            }`}
          >
            <p className="text-sm break-words">{status.message}</p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
            Requirements
          </h3>
          <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
            <li>- Parent domain must be <strong>wrapped</strong> (use ENS Manager app)</li>
            <li>- You must own the parent domain</li>
            <li>- Subdomain must be available</li>
            <li>- Label can only contain lowercase letters, numbers, and hyphens</li>
            <li>- You'll pay gas fees on Ethereum Mainnet</li>
          </ul>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
            Wrap your name: <a href="https://app.ens.domains" target="_blank" rel="noopener noreferrer" className="underline">app.ens.domains</a>
          </p>
        </div>
      </div>
    </div>
  );
}
