"use client";

/**
 * ENS Profile Component
 *
 * Production ENS Integration with:
 * - Custom namehash algorithm
 * - Direct ENS Registry and Resolver contract calls
 * - Text record fetching (avatar, twitter, github, etc.)
 * - Multi-chain address support
 * - No hard-coded values - all dynamic
 */

import { useENSProfile, useMultiChainAddresses } from "@/lib/ens/context";
import Image from "next/image";
import { useState } from "react";

export default function ENSProfile() {
  const [ensName, setEnsName] = useState("vitalik.eth");
  const [inputValue, setInputValue] = useState("vitalik.eth");
  const [showMultiChain, setShowMultiChain] = useState(false);

  // Use our custom ENS hooks
  const { profile, loading, error } = useENSProfile(ensName);
  const { addresses: multiChainAddresses, loading: loadingMultiChain } =
    useMultiChainAddresses(showMultiChain ? ensName : null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue && inputValue.includes(".")) {
      setEnsName(inputValue);
      setShowMultiChain(false);
    }
  };

  const handleShowMultiChain = () => {
    setShowMultiChain(!showMultiChain);
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-center mb-2 text-zinc-900 dark:text-zinc-50">
          ENS Profile Viewer
        </h1>
        <p className="text-center text-zinc-600 dark:text-zinc-400 mb-2">
          Production ENS Integration with Direct Contract Calls
        </p>
        <p className="text-xs text-center text-zinc-500 dark:text-zinc-500">
          Custom Namehash | Direct Registry Calls | No Hard-Coded Values
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Enter ENS name (e.g., vitalik.eth)"
            className="flex-1 px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? "Resolving..." : "Search"}
          </button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-2">
          Try: vitalik.eth, brantly.eth, nick.eth, ens.eth
        </p>
      </form>

      {/* Loading State */}
      {loading && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
          <div className="flex flex-col items-center gap-4">
            <div className="w-32 h-32 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
            <div className="h-8 w-48 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            <div className="h-6 w-64 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Calling ENS Registry and Resolver contracts...
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-center">
          <h3 className="text-lg font-semibold text-red-900 dark:text-red-200 mb-2">
            Resolution Failed
          </h3>
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <p className="text-xs text-red-600 dark:text-red-400 mt-2">
            Make sure the ENS name is registered and has a resolver set
          </p>
        </div>
      )}

      {/* Profile Card */}
      {profile && !loading && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
          {/* Avatar and Name */}
          <div className="flex flex-col items-center mb-6">
            <div className="relative w-32 h-32 mb-4">
              <Image
                src={
                  profile.avatar || `https://avatars.jakerunzer.com/${ensName}`
                }
                alt={ensName}
                width={128}
                height={128}
                className="rounded-full border-4 border-zinc-200 dark:border-zinc-800"
              />
            </div>
            <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
              {profile.name}
            </h2>
            {profile.address ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-4 py-2 rounded-lg break-all">
                  {profile.address}
                </p>
                <button
                  onClick={handleShowMultiChain}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {showMultiChain ? "Hide" : "Show"} multi-chain addresses
                </button>
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No address set
              </p>
            )}
          </div>

          {/* Multi-Chain Addresses */}
          {showMultiChain && (
            <div className="mb-6 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
                Multi-Chain Addresses
              </h3>
              {loadingMultiChain ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Loading addresses...
                </div>
              ) : multiChainAddresses.length > 0 ? (
                <div className="space-y-2">
                  {multiChainAddresses.map((addr) => (
                    <div
                      key={addr.coinType}
                      className="flex items-center justify-between text-xs bg-white dark:bg-zinc-900 p-2 rounded"
                    >
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                        {addr.chainName}
                      </span>
                      <span className="font-mono text-zinc-600 dark:text-zinc-400">
                        {addr.address.slice(0, 10)}...{addr.address.slice(-8)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-zinc-500 dark:text-zinc-500">
                  No additional chain addresses found
                </div>
              )}
            </div>
          )}

          {/* Profile Details */}
          <div className="space-y-4 mt-6">
            {profile.description && (
              <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
                <p className="text-zinc-700 dark:text-zinc-300 text-center italic">
                  "{profile.description}"
                </p>
              </div>
            )}

            <div className="grid gap-4">
              {profile.twitter && (
                <ProfileField
                  label="Twitter"
                  value={profile.twitter}
                  href={`https://twitter.com/${profile.twitter}`}
                />
              )}

              {profile.github && (
                <ProfileField
                  label="GitHub"
                  value={profile.github}
                  href={`https://github.com/${profile.github}`}
                />
              )}

              {profile.discord && (
                <ProfileField
                  label="Discord"
                  value={profile.discord}
                />
              )}

              {profile.telegram && (
                <ProfileField
                  label="Telegram"
                  value={profile.telegram}
                  href={`https://t.me/${profile.telegram}`}
                />
              )}

              {profile.email && (
                <ProfileField
                  label="Email"
                  value={profile.email}
                  href={`mailto:${profile.email}`}
                />
              )}

              {profile.url && (
                <ProfileField
                  label="Website"
                  value={profile.url}
                  href={profile.url}
                />
              )}

              {profile.contentHash && (
                <ProfileField
                  label="Content Hash"
                  value={`${profile.contentHash.slice(0, 20)}...`}
                  tooltip={profile.contentHash}
                />
              )}

              {!profile.twitter &&
                !profile.github &&
                !profile.discord &&
                !profile.telegram &&
                !profile.email &&
                !profile.url &&
                !profile.description &&
                !profile.contentHash && (
                  <div className="text-center py-8 text-zinc-500 dark:text-zinc-500">
                    No additional profile information available
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component for profile fields
function ProfileField({
  label,
  value,
  href,
  tooltip,
}: {
  label: string;
  value: string;
  href?: string;
  tooltip?: string;
}) {
  const content = (
    <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-500 dark:text-zinc-500 uppercase font-medium">
          {label}
        </p>
        <p
          className="text-blue-600 dark:text-blue-400 font-medium break-all"
          title={tooltip}
        >
          {href ? value : value}
        </p>
      </div>
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:scale-[1.02] transition-transform"
      >
        {content}
      </a>
    );
  }

  return content;
}
