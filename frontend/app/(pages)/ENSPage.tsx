import { Globe } from "lucide-react";

const ENSPage = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="rounded-lg border border-border bg-card p-12 text-center max-w-md">
        <Globe className="h-12 w-12 text-primary mx-auto mb-4" />
        <h2 className="text-2xl font-bold font-mono text-foreground mb-2">ENS Resolver</h2>
        <p className="text-muted-foreground text-sm">
          ENS resolution functionality coming soon. This page will allow you to resolve Ethereum
          Name Service domains.
        </p>
      </div>
    </div>
  );
};

export default ENSPage;
