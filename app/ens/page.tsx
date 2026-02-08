"use client";

import dynamic from "next/dynamic";
import { DashboardLayout } from "@/components/DashboardLayout";

const ENSProfile = dynamic(() => import("@/components/ENSProfile"), {
  ssr: false,
});

const SubdomainCreator = dynamic(() => import("@/components/SubdomainCreator"), {
  ssr: false,
});

export default function ENSPageRoute() {
  return (
    <DashboardLayout>
      <div className="w-full space-y-8">
        <SubdomainCreator />
        <ENSProfile />
      </div>
    </DashboardLayout>
  );
}
