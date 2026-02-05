"use client";

import Image from "next/image";
import { useState } from "react";
import { normalize } from "viem/ens";
import { useEnsAddress, useEnsAvatar, useEnsText } from "wagmi";

export default function ENSProfile() {
  const [ensName, setEnsName] = useState("nick.eth");
  const [inputValue, setInputValue] = useState("nick.eth");

  // Get the Ethereum address from ENS name
  const { data: address, isLoading: isLoadingAddress } = useEnsAddress({
    name: normalize(ensName),
    chainId: 1,
  });

  // Get the avatar
  const { data: avatar, isLoading: isLoadingAvatar } = useEnsAvatar({
    name: normalize(ensName),
    chainId: 1,
  });

  // Get Twitter handle
  const { data: twitter } = useEnsText({
    name: normalize(ensName),
    key: "com.twitter",
    chainId: 1,
  });

  // Get email
  const { data: email } = useEnsText({
    name: normalize(ensName),
    key: "email",
    chainId: 1,
  });

  // Get URL
  const { data: url } = useEnsText({
    name: normalize(ensName),
    key: "url",
    chainId: 1,
  });

  // Get description
  const { data: description } = useEnsText({
    name: normalize(ensName),
    key: "description",
    chainId: 1,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue) {
      setEnsName(inputValue);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-center mb-2 text-zinc-900 dark:text-zinc-50">
          ENS Profile Viewer
        </h1>
        <p className="text-center text-zinc-600 dark:text-zinc-400">
          Look up Ethereum Name Service profiles
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
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Search
          </button>
        </div>
      </form>

      {/* Profile Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
        {/* Avatar and Name */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative w-32 h-32 mb-4">
            {isLoadingAvatar ? (
              <div className="w-full h-full rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
            ) : (
              <Image
                src={avatar || `https://avatars.jakerunzer.com/${ensName}`}
                alt={ensName}
                width={128}
                height={128}
                className="rounded-full border-4 border-zinc-200 dark:border-zinc-800"
              />
            )}
          </div>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
            {ensName}
          </h2>
          {isLoadingAddress ? (
            <div className="h-6 w-64 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
          ) : address ? (
            <p className="text-sm font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-4 py-2 rounded-lg">
              {address}
            </p>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-500">
              No address found
            </p>
          )}
        </div>

        {/* Profile Details */}
        <div className="space-y-4 mt-6">
          {description && (
            <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-700 dark:text-zinc-300 text-center italic">
                "{description}"
              </p>
            </div>
          )}

          <div className="grid gap-4">
            {twitter && (
              <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                <div className="text-2xl">🐦</div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 uppercase font-medium">
                    Twitter
                  </p>
                  <a
                    href={`https://twitter.com/${twitter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    @{twitter}
                  </a>
                </div>
              </div>
            )}

            {email && (
              <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                <div className="text-2xl">📧</div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 uppercase font-medium">
                    Email
                  </p>
                  <a
                    href={`mailto:${email}`}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    {email}
                  </a>
                </div>
              </div>
            )}

            {url && (
              <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                <div className="text-2xl">🔗</div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 uppercase font-medium">
                    Website
                  </p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium break-all"
                  >
                    {url}
                  </a>
                </div>
              </div>
            )}

            {!twitter && !email && !url && !description && (
              <div className="text-center py-8 text-zinc-500 dark:text-zinc-500">
                No additional profile information available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
