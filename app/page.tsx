import ENSProfile from "@/components/ENSProfile";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black py-12 px-4">
      <ENSProfile />
    </div>
  );
}
