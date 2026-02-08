"use client";

import dynamic from 'next/dynamic';

const ENSProfile = dynamic(() => import("@/components/ENSProfile"), {
  ssr: false,
});

const SubdomainCreator = dynamic(() => import("@/components/SubdomainCreator"), {
  ssr: false,
});

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black py-12 px-4">
      <div className="w-full max-w-6xl space-y-8">
        <SubdomainCreator />
        <ENSProfile />
      </div>
    </div>
  );
}
