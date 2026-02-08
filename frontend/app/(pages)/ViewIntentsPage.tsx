import { useState, useEffect } from "react";
import { Loader2, ExternalLink, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchOpenIntents, executeIntent, parseTokenName, msToHumanTime } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface Intent {
  intentId: string;
  owner: string;
  inputType: string;
  outputType: string;
  inputAmount: number;
  inputAmountRaw: string;
  minOutput: number;
  minOutputRaw: string;
  deadline: string;
  deadlineISO: string;
  timeRemainingMs: number;
  timeRemainingHuman: string;
  expired: boolean;
  status: string;
}

interface ExecuteResult {
  success: boolean;
  intentId: string;
  digest: string;
  solver: string;
  inputReceived: number;
  outputProvided: number;
  feeAmount: number;
  explorerUrl: string;
}

const ViewIntentsPage = () => {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIntent, setSelectedIntent] = useState<Intent | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<ExecuteResult | null>(null);

  const loadIntents = async () => {
    setLoading(true);
    try {
      const data = await fetchOpenIntents();
      if (data.success) setIntents(data.intents || []);
    } catch {
      toast({ title: "Error", description: "Could not fetch intents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntents();
  }, []);

  const handleExecute = async (intentId: string) => {
    setExecuting(true);
    setExecResult(null);
    try {
      const data = await executeIntent(intentId);
      if (data.success) {
        setExecResult(data);
        toast({ title: "Executed!", description: "Intent executed successfully." });
      } else {
        toast({ title: "Failed", description: "Execution failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not execute intent", variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold font-mono text-foreground">View Intents</h2>
          <p className="text-sm text-muted-foreground mt-1">{intents.length} open intents</p>
        </div>
        <Button
          variant="outline"
          onClick={loadIntents}
          className="border-border text-foreground hover:bg-secondary"
        >
          Refresh
        </Button>
      </div>

      {intents.length === 0 ? (
        <div className="text-center text-muted-foreground py-20">No open intents found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {intents.map((intent) => {
            const fromToken = parseTokenName(intent.inputType);
            const toToken = parseTokenName(intent.outputType);
            const isOpen = intent.status === "open";

            return (
              <button
                key={intent.intentId}
                onClick={() => {
                  setSelectedIntent(intent);
                  setExecResult(null);
                }}
                className={`text-left rounded-lg border p-4 transition-all hover:scale-[1.02] cursor-pointer ${
                  isOpen
                    ? "border-success/40 bg-success/5 hover:border-success/60 glow-success"
                    : "border-destructive/40 bg-destructive/5 hover:border-destructive/60 glow-destructive"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-sm font-bold text-foreground">
                    {fromToken} → {toToken}
                  </span>
                  <span
                    className={`text-xs font-mono px-2 py-0.5 rounded ${
                      isOpen ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"
                    }`}
                  >
                    {intent.status}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>
                    Amount:{" "}
                    <span className="text-foreground font-mono">
                      {intent.inputAmount} {fromToken}
                    </span>
                  </div>
                  <div>
                    Min Output:{" "}
                    <span className="text-foreground font-mono">
                      {intent.minOutput} {toToken}
                    </span>
                  </div>
                  <div>
                    Time Remaining:{" "}
                    <span className="text-foreground font-mono">
                      {msToHumanTime(intent.timeRemainingMs)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedIntent} onOpenChange={() => setSelectedIntent(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-primary">
              {selectedIntent &&
                `${parseTokenName(selectedIntent.inputType)} → ${parseTokenName(selectedIntent.outputType)}`}
            </DialogTitle>
          </DialogHeader>
          {selectedIntent && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Status</span>
                  <p
                    className={`font-mono ${selectedIntent.status === "open" ? "text-success" : "text-destructive"}`}
                  >
                    {selectedIntent.status}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Input Amount</span>
                  <p className="font-mono text-foreground">{selectedIntent.inputAmount}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Min Output</span>
                  <p className="font-mono text-foreground">{selectedIntent.minOutput}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Time Remaining</span>
                  <p className="font-mono text-foreground">
                    {msToHumanTime(selectedIntent.timeRemainingMs)}
                  </p>
                </div>
              </div>

              <div>
                <span className="text-xs text-muted-foreground">Intent ID</span>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs font-mono text-foreground break-all">
                    {selectedIntent.intentId}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => copyToClipboard(selectedIntent.intentId)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div>
                <span className="text-xs text-muted-foreground">Owner</span>
                <p className="text-xs font-mono text-foreground break-all mt-1">
                  {selectedIntent.owner}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted-foreground">Deadline</span>
                <p className="text-xs font-mono text-foreground mt-1">
                  {selectedIntent.deadlineISO}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Input Raw</span>
                  <p className="font-mono text-foreground">{selectedIntent.inputAmountRaw}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Output Raw</span>
                  <p className="font-mono text-foreground">{selectedIntent.minOutputRaw}</p>
                </div>
              </div>

              {/* Execute Button */}
              <Button
                onClick={() => handleExecute(selectedIntent.intentId)}
                disabled={executing}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono"
              >
                {executing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {executing ? "Executing..." : "Execute Intent"}
              </Button>

              {/* Execute Result */}
              {execResult && (
                <div className="rounded-lg border border-primary/30 bg-muted p-4 space-y-3 glow-primary">
                  <h4 className="text-xs font-mono text-primary uppercase tracking-wider">
                    Execution Result
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Input Received</span>
                      <p className="font-mono text-foreground">{execResult.inputReceived}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Output Provided</span>
                      <p className="font-mono text-foreground">{execResult.outputProvided}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Fee</span>
                      <p className="font-mono text-foreground">{execResult.feeAmount}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Solver</span>
                      <p className="font-mono text-foreground truncate">{execResult.solver}</p>
                    </div>
                  </div>
                  <a
                    href={execResult.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-mono"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View on Explorer
                  </a>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ViewIntentsPage;
