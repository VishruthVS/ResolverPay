import { useState } from "react";
import { ArrowDownUp, ExternalLink, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createIntent, TOKENS } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface CreateResult {
  success: boolean;
  intentId: string;
  digest: string;
  explorerUrl: string;
  sender: string;
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  minOutput: number;
  deadlineSeconds: number;
}

const CreateIntentPage = () => {
  const [fromToken, setFromToken] = useState("SUI");
  const [toToken, setToToken] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [minOutput, setMinOutput] = useState("");
  const [deadline, setDeadline] = useState("300");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);

  const handleSwap = () => {
    setFromToken(toToken);
    setToToken(fromToken);
  };

  const handleSubmit = async () => {
    if (!amount || !minOutput || !deadline) {
      toast({
        title: "Missing fields",
        description: "Please fill all fields",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const data = await createIntent({
        from: fromToken,
        to: toToken,
        amount: parseFloat(amount),
        minOutput: parseFloat(minOutput),
        deadlineSeconds: parseInt(deadline),
      });
      if (data.success) {
        setResult(data);
        toast({ title: "Intent Created", description: "Your intent was created successfully." });
      } else {
        toast({ title: "Error", description: "Failed to create intent", variant: "destructive" });
      }
    } catch {
      toast({
        title: "Network Error",
        description: "Could not reach the API server",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: "Copied to clipboard" });
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-mono text-foreground">Create Intent</h2>
        <p className="text-sm text-muted-foreground mt-1">Build and submit a new swap intent</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-5">
        {/* From Token */}
        <div>
          <Label className="text-muted-foreground text-xs uppercase tracking-wider">From</Label>
          <Select value={fromToken} onValueChange={setFromToken}>
            <SelectTrigger className="mt-1.5 bg-muted border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {TOKENS.map((t) => (
                <SelectItem key={t.symbol} value={t.symbol}>
                  {t.symbol} — {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Swap Button */}
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSwap}
            className="text-primary hover:bg-secondary"
          >
            <ArrowDownUp className="h-5 w-5" />
          </Button>
        </div>

        {/* To Token */}
        <div>
          <Label className="text-muted-foreground text-xs uppercase tracking-wider">To</Label>
          <Select value={toToken} onValueChange={setToToken}>
            <SelectTrigger className="mt-1.5 bg-muted border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {TOKENS.map((t) => (
                <SelectItem key={t.symbol} value={t.symbol}>
                  {t.symbol} — {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Amount */}
        <div>
          <Label className="text-muted-foreground text-xs uppercase tracking-wider">Amount</Label>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1.5 bg-muted border-border"
            placeholder="0.00"
          />
        </div>

        {/* Min Output */}
        <div>
          <Label className="text-muted-foreground text-xs uppercase tracking-wider">
            Min Output
          </Label>
          <Input
            type="number"
            value={minOutput}
            onChange={(e) => setMinOutput(e.target.value)}
            className="mt-1.5 bg-muted border-border"
            placeholder="0.00"
          />
        </div>

        {/* Deadline */}
        <div>
          <Label className="text-muted-foreground text-xs uppercase tracking-wider">
            Deadline (seconds)
          </Label>
          <Input
            type="number"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="mt-1.5 bg-muted border-border"
            placeholder="300"
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {loading ? "Creating..." : "Create Intent"}
        </Button>
      </div>

      {/* Result */}
      {result && (
        <div className="rounded-lg border border-primary/30 bg-card p-6 space-y-4 glow-primary">
          <h3 className="text-sm font-mono text-primary uppercase tracking-wider">
            Intent Created
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-muted-foreground">Intent ID</span>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-xs font-mono text-foreground break-all">
                  {result.intentId}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => copyToClipboard(result.intentId)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Digest</span>
              <p className="text-xs font-mono text-foreground mt-1">{result.digest}</p>
            </div>
            <div className="flex gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">From</span>
                <p className="text-foreground font-mono">
                  {result.inputAmount} {result.inputToken}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Min Output</span>
                <p className="text-foreground font-mono">
                  {result.minOutput} {result.outputToken}
                </p>
              </div>
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

export default CreateIntentPage;
