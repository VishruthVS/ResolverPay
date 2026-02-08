import { useState } from "react";
import { Zap, ExternalLink, Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { executeIntent } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface ExecuteResult {
  success: boolean;
  intentId: string;
  digest: string;
  solver: string;
  inputReceived: number;
  outputProvided: number;
  feeAmount: number;
  inputReceivedRaw: string;
  outputProvidedRaw: string;
  feeAmountRaw: string;
  explorerUrl: string;
}

const ExecuteIntentPage = () => {
  const [intentId, setIntentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const handleExecute = async () => {
    if (!intentId.trim()) {
      toast({ title: "Missing ID", description: "Please enter an intent ID", variant: "destructive" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await executeIntent(intentId.trim());
      if (data.success) {
        setResult(data);
        toast({ title: "Executed!", description: "Intent executed successfully." });
      } else {
        toast({ title: "Failed", description: "Execution failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not reach the API server", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!" });
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-mono text-foreground">Execute Intent</h2>
        <p className="text-sm text-muted-foreground mt-1">Execute a specific intent by its ID</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-5">
        <div>
          <Label className="text-muted-foreground text-xs uppercase tracking-wider">Intent ID</Label>
          <Input
            value={intentId}
            onChange={(e) => setIntentId(e.target.value)}
            className="mt-1.5 font-mono text-xs bg-muted border-border"
            placeholder="0x..."
          />
        </div>

        <Button
          onClick={handleExecute}
          disabled={loading}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          {loading ? "Executing..." : "Execute"}
        </Button>
      </div>

      {result && (
        <div className="rounded-lg border border-primary/30 bg-card p-6 space-y-4 glow-primary">
          <h3 className="text-sm font-mono text-primary uppercase tracking-wider">Execution Result</h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-muted-foreground">Intent ID</span>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-xs font-mono text-foreground break-all">{result.intentId}</code>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => copyToClipboard(result.intentId)}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Digest</span>
              <p className="text-xs font-mono text-foreground mt-1">{result.digest}</p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Input Received</span>
                <p className="font-mono text-foreground">{result.inputReceived}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Output Provided</span>
                <p className="font-mono text-foreground">{result.outputProvided}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Fee</span>
                <p className="font-mono text-foreground">{result.feeAmount}</p>
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Solver</span>
              <p className="text-xs font-mono text-foreground break-all mt-1">{result.solver}</p>
            </div>
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-mono"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View on Explorer
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExecuteIntentPage;
