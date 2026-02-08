/**
 * Intent Protocol - REST API Server
 *
 * Exposes DeepBook V3 swap quotes, order book data, and intent operations
 * as HTTP endpoints for frontend integration.
 *
 * Start:  npx ts-node src/api-server.ts
 * Or:     npm run api
 */

import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { Ed25519Keypair } from "@mysten/sui.js/keypairs/ed25519";
import {
  SolverEngine,
  SolverConfig,
  DEEPBOOK_PACKAGE_ID,
  DEEPBOOK_POOLS,
  SUI_TYPE,
  USDC_TYPE,
  USDC_TESTNET_TYPE,
  DEEP_TOKEN_TYPE,
} from "./solver-engine";
import {
  IntentProtocolSDK,
  STATUS_OPEN,
  STATUS_COMPLETED,
  STATUS_CANCELLED,
  STATUS_EXPIRED,
} from "./intent-protocol-sdk";
import { SuiClient } from "@mysten/sui.js/client";

// ===== Configuration =====

const PORT = Number(process.env.API_PORT || 3001);
const RPC_URL =
  process.env.SUI_RPC_URL || "https://fullnode.mainnet.sui.io:443";

// Token aliases for convenient API calls
// USDC  = DeepBook's DBUSDC (used by DeepBook pools)
// TUSDC = Real testnet USDC (0xa1ec...::usdc::USDC)
const TOKEN_ALIASES: Record<string, string> = {
  SUI: SUI_TYPE,
  USDC: USDC_TESTNET_TYPE, // Default USDC now points to the real testnet USDC
  DBUSDC: USDC_TYPE, // Explicitly use DBUSDC for DeepBook's token
  TUSDC: USDC_TESTNET_TYPE, // Alias for real testnet USDC
  DEEP: DEEP_TOKEN_TYPE,
};

// Token decimal places (for converting raw → human-readable)
const TOKEN_DECIMALS: Record<string, number> = {
  [SUI_TYPE]: 9,
  [USDC_TYPE]: 6,
  [USDC_TESTNET_TYPE]: 6,
  [DEEP_TOKEN_TYPE]: 6,
};

// ===== Helpers =====

/** Resolve a token alias (e.g. "SUI") or return the raw type string */
function resolveToken(token: string): string {
  return TOKEN_ALIASES[token.toUpperCase()] || token;
}

/** Get decimals for a token type */
function decimalsFor(tokenType: string): number {
  return TOKEN_DECIMALS[tokenType] || 9;
}

/** Convert human amount → raw smallest unit string */
function humanToRaw(amount: number, tokenType: string): string {
  return Math.round(amount * Math.pow(10, decimalsFor(tokenType))).toString();
}

/** Convert raw smallest unit → human number */
function rawToHuman(raw: string, tokenType: string): number {
  return Number(raw) / Math.pow(10, decimalsFor(tokenType));
}

/** Build a keypair from a 64-char hex private key */
function keypairFromHex(hex: string): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(Uint8Array.from(Buffer.from(hex, "hex")));
}

/** Map status code → readable label */
const STATUS_LABEL: Record<number, string> = {
  [STATUS_OPEN]: "open",
  [STATUS_COMPLETED]: "completed",
  [STATUS_CANCELLED]: "cancelled",
  [STATUS_EXPIRED]: "expired",
};

// ===== Bootstrap =====

async function main() {
  // --- Solver engine (read-only mode – no private key needed for quotes) ---
  const solverConfig: SolverConfig = {
    rpcUrl: RPC_URL,
    privateKey: process.env.SOLVER_PRIVATE_KEY || "0".repeat(64), // dummy for read-only
    packageId: process.env.PACKAGE_ID || "0x0",
    protocolConfigId: process.env.PROTOCOL_CONFIG_ID || "0x0",
    minProfitBps: Number(process.env.MIN_PROFIT_BPS || "50"),
    maxGasPrice: Number(process.env.MAX_GAS_PRICE || "1000000000"),
    pollingIntervalMs: 60_000,
    enableEventSubscription: false,
    balanceManagerId: process.env.BALANCE_MANAGER_ID,
    deepbookPackageId: process.env.DEEPBOOK_PACKAGE_ID,
  };

  const solver = new SolverEngine(solverConfig);
  const suiClient = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(suiClient, solverConfig.packageId);

  // --- Keypairs from env (for testing endpoints – NOT exposed to API callers) ---
  const USER_KEY = process.env.USER_PRIVATE_KEY;
  const SOLVER_KEY = process.env.SOLVER_PRIVATE_KEY;

  if (!USER_KEY)
    console.warn(
      "⚠️  USER_PRIVATE_KEY not set in .env – /api/intent/create and /cancel will fail"
    );
  if (!SOLVER_KEY)
    console.warn(
      "⚠️  SOLVER_PRIVATE_KEY not set in .env – /api/intent/execute will fail"
    );

  const userKeypair = USER_KEY ? keypairFromHex(USER_KEY) : null;
  const solverKeypair = SOLVER_KEY ? keypairFromHex(SOLVER_KEY) : null;
  const userAddress = userKeypair?.getPublicKey().toSuiAddress() ?? null;
  const solverAddress = solverKeypair?.getPublicKey().toSuiAddress() ?? null;

  // --- Express app ---
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ================================================================
  //  GET /api/health
  // ================================================================
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      rpcUrl: RPC_URL,
      deepbookPackage: DEEPBOOK_PACKAGE_ID,
      timestamp: new Date().toISOString(),
    });
  });

  // ================================================================
  //  GET /api/pools
  //  Returns the list of registered DeepBook V3 pools.
  // ================================================================
  app.get("/api/pools", (_req: Request, res: Response) => {
    res.json({
      pools: Object.entries(DEEPBOOK_POOLS).map(([name, poolId]) => ({
        name,
        poolId,
      })),
      tokenAliases: TOKEN_ALIASES,
    });
  });

  // ================================================================
  //  POST /api/quote
  //
  //  Get a real-time swap quote from DeepBook V3 order book.
  //
  //  Body (JSON):
  //    { "from": "SUI", "to": "USDC", "amount": 0.1 }
  //
  //  "amount" is always in human-readable units (e.g. 0.1 = 0.1 SUI).
  // ================================================================
  app.post(
    "/api/quote",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { from, to, amount } = req.body;

        if (!from || !to || amount === undefined || amount === null) {
          res.status(400).json({
            error: "Missing required fields in body: from, to, amount",
            example: { from: "SUI", to: "USDC", amount: 0.1 },
          });
          return;
        }

        const inputType = resolveToken(from as string);
        const outputType = resolveToken(to as string);

        // Convert human-readable amount → raw (smallest unit)
        const inputDecimals = TOKEN_DECIMALS[inputType] || 9;
        const outputDecimals = TOKEN_DECIMALS[outputType] || 9;
        const humanAmount = Number(amount);
        const rawInputAmount = Math.round(
          humanAmount * Math.pow(10, inputDecimals)
        ).toString();

        console.log(
          `📡 Quote request: ${humanAmount} ${from} -> ${to}  (raw ${rawInputAmount})`
        );

        const quote = await solver.getSwapQuote(
          inputType,
          outputType,
          rawInputAmount
        );

        // Convert raw output back to human-readable
        const outputHuman =
          Number(quote.outputAmount) / Math.pow(10, outputDecimals);

        res.json({
          success: true,
          quote: {
            inputToken: from,
            outputToken: to,
            inputAmount: humanAmount,
            outputAmount: outputHuman,
            inputAmountRaw: quote.inputAmount,
            outputAmountRaw: quote.outputAmount,
            midPrice: quote.midPrice,
            bestBid: quote.bestBid,
            bestAsk: quote.bestAsk,
            priceImpact: quote.priceImpact,
            route: quote.route,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/orderbook
  //
  //  Fetch Level 2 order book (bids & asks) from DeepBook V3.
  //
  //  Body (JSON):
  //    { "base": "SUI", "quote": "USDC" }
  // ================================================================
  app.post(
    "/api/orderbook",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { base, quote: quoteParam } = req.body;

        if (!base || !quoteParam) {
          res.status(400).json({
            error: "Missing required fields in body: base, quote",
            example: { base: "SUI", quote: "USDC" },
          });
          return;
        }

        const baseType = resolveToken(base as string);
        const quoteType = resolveToken(quoteParam as string);

        const pool = solver.findPool(baseType, quoteType);
        if (!pool) {
          res.status(404).json({
            error: `No pool registered for ${base}/${quoteParam}`,
          });
          return;
        }

        console.log(`📡 Orderbook request: ${base}/${quoteParam}`);

        const level2 = await solver.getLevel2Data(
          pool.poolId,
          pool.baseType,
          pool.quoteType
        );

        const bestBid = level2.bids[0] || null;
        const bestAsk = level2.asks[0] || null;
        const midPrice =
          bestBid && bestAsk ? (bestBid.price + bestAsk.price) / 2 : null;
        const spread =
          bestBid && bestAsk ? bestAsk.price - bestBid.price : null;

        res.json({
          success: true,
          pool: {
            poolId: pool.poolId,
            base,
            quote: quoteParam,
          },
          summary: {
            bestBid: bestBid?.price ?? null,
            bestAsk: bestAsk?.price ?? null,
            midPrice,
            spread,
            bidDepth: level2.bids.length,
            askDepth: level2.asks.length,
          },
          bids: level2.bids,
          asks: level2.asks,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/price
  //
  //  Quick mid-price lookup for a pair.
  //
  //  Body (JSON):
  //    { "pair": "SUI_USDC" }
  // ================================================================
  app.post(
    "/api/price",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { pair } = req.body;

        if (!pair) {
          res.status(400).json({
            error: "Missing required field in body: pair",
            example: { pair: "SUI_USDC" },
          });
          return;
        }

        const pairStr = (pair as string).toUpperCase();
        const poolId = (DEEPBOOK_POOLS as Record<string, string>)[pairStr];
        if (!poolId) {
          res.status(404).json({
            error: `Unknown pair: ${pairStr}. Available: ${Object.keys(DEEPBOOK_POOLS).join(", ")}`,
          });
          return;
        }

        // Determine base/quote types from pair name
        const [baseAlias, quoteAlias] = pairStr.split("_");
        const baseType = resolveToken(baseAlias);
        const quoteType = resolveToken(quoteAlias);

        console.log(`📡 Price request: ${pairStr}`);

        const level2 = await solver.getLevel2Data(poolId, baseType, quoteType);

        const bestBid = level2.bids[0]?.price ?? null;
        const bestAsk = level2.asks[0]?.price ?? null;
        const midPrice =
          bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;

        res.json({
          success: true,
          pair: pairStr,
          midPrice,
          bestBid,
          bestAsk,
          spread:
            bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/intent
  //
  //  Fetch a specific intent by object ID.
  //
  //  Body (JSON):
  //    { "id": "0x..." }
  // ================================================================
  app.post(
    "/api/intent",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.body;

        if (!id) {
          res.status(400).json({
            error: "Missing required field in body: id",
            example: { id: "0xabc123..." },
          });
          return;
        }

        const intent = await sdk.getIntent(id as string);

        if (!intent) {
          res.status(404).json({ error: "Intent not found" });
          return;
        }

        res.json({
          success: true,
          intent: {
            ...intent,
            statusLabel: STATUS_LABEL[intent.status] || "unknown",
            inputAmountHuman: rawToHuman(
              intent.input_amount,
              intent.input_type
            ),
            minOutputHuman: rawToHuman(
              intent.min_output_amount,
              intent.output_type
            ),
            deadlineISO: new Date(Number(intent.deadline)).toISOString(),
            expired: Date.now() > Number(intent.deadline),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/intent/create
  //
  //  Create a new swap intent (USER action).
  //  Uses USER_PRIVATE_KEY from .env — no private key in request.
  //
  //  Body (JSON):
  //    {
  //      "from":       "SUI",
  //      "to":         "USDC",
  //      "amount":     0.1,
  //      "minOutput":  0.09,
  //      "deadlineSeconds": 300
  //    }
  //
  //  All amounts are human-readable.
  // ================================================================
  app.post(
    "/api/intent/create",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!userKeypair || !userAddress) {
          res
            .status(500)
            .json({ error: "USER_PRIVATE_KEY not configured in .env" });
          return;
        }

        const { from, to, amount, minOutput, deadlineSeconds } = req.body;

        if (!from || !to || amount === undefined || minOutput === undefined) {
          res.status(400).json({
            error: "Missing required fields: from, to, amount, minOutput",
            example: {
              from: "SUI",
              to: "USDC",
              amount: 0.1,
              minOutput: 0.09,
              deadlineSeconds: 300,
            },
          });
          return;
        }

        const inputType = resolveToken(from as string);
        const outputType = resolveToken(to as string);
        const rawAmount = humanToRaw(Number(amount), inputType);
        const rawMinOutput = humanToRaw(Number(minOutput), outputType);
        // Pass duration only — the Move contract adds clock::timestamp_ms(clock) internally
        const deadlineMs = String((deadlineSeconds || 300) * 1000);

        const keypair = userKeypair;
        const sender = userAddress;

        console.log(
          `📡 Create intent: ${amount} ${from} → ${to} (min ${minOutput}) by ${sender.slice(0, 10)}...`
        );

        // Build transaction
        const tx = new TransactionBlock();

        // Split the required amount from gas (works for SUI input)
        if (inputType === SUI_TYPE) {
          const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(rawAmount)]);
          tx.moveCall({
            target: `${solverConfig.packageId}::intent::create_intent`,
            typeArguments: [inputType, outputType],
            arguments: [
              coin,
              tx.pure.u64(rawMinOutput),
              tx.pure.u64(deadlineMs),
              tx.object("0x6"),
            ],
          });
        } else {
          // For non-SUI tokens, find and merge coins
          const coins = await suiClient.getCoins({
            owner: sender,
            coinType: inputType,
          });
          if (!coins.data.length) {
            res
              .status(400)
              .json({ error: `No ${from} coins found in wallet ${sender}` });
            return;
          }
          const primaryCoin = tx.object(coins.data[0].coinObjectId);
          if (coins.data.length > 1) {
            tx.mergeCoins(
              primaryCoin,
              coins.data.slice(1).map((c) => tx.object(c.coinObjectId))
            );
          }
          const [splitCoin] = tx.splitCoins(primaryCoin, [
            tx.pure.u64(rawAmount),
          ]);

          tx.moveCall({
            target: `${solverConfig.packageId}::intent::create_intent`,
            typeArguments: [inputType, outputType],
            arguments: [
              splitCoin,
              tx.pure.u64(rawMinOutput),
              tx.pure.u64(deadlineMs),
              tx.object("0x6"),
            ],
          });
        }

        const result = await suiClient.signAndExecuteTransactionBlock({
          transactionBlock: tx,
          signer: keypair,
          options: { showEffects: true, showEvents: true },
        });

        // Extract intent ID from IntentCreated event
        const event = result.events?.find((e) =>
          e.type.includes("IntentCreated")
        );
        const intentId = (event?.parsedJson as any)?.intent_id || null;

        console.log(`✅ Intent created: ${intentId} | tx: ${result.digest}`);

        res.json({
          success: true,
          intentId,
          digest: result.digest,
          sender,
          inputToken: from,
          outputToken: to,
          inputAmount: Number(amount),
          minOutput: Number(minOutput),
          deadlineSeconds: deadlineSeconds || 300,
          explorerUrl: `https://suiscan.xyz/testnet/tx/${result.digest}`,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/intents/open
  //
  //  🔓 PUBLIC — no private key needed.
  //  Any solver can call this to see all fillable intents.
  //
  //  Queries IntentCreated events, checks each on-chain in parallel,
  //  and returns only those still open & not expired.
  //
  //  Body (JSON – all optional):
  //    { "limit": 50, "includeExpired": false }
  // ================================================================
  app.post(
    "/api/intents/open",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const limit = Number(req.body?.limit || 50);
        const includeExpired = req.body?.includeExpired === true;

        console.log(`📡 Listing open intents (limit ${limit})...`);

        // Query recent IntentCreated events
        const createdEvents = await sdk.queryIntentCreatedEvents(limit);

        // Check all intents in parallel for speed
        const results = await Promise.allSettled(
          createdEvents.map(async (ev) => {
            const intent = await sdk.getIntent(ev.intent_id);
            return intent;
          })
        );

        const now = Date.now();
        const openIntents = [];

        for (const r of results) {
          if (r.status !== "fulfilled" || !r.value) continue;
          const intent = r.value;
          if (intent.status !== STATUS_OPEN) continue;

          const expired = now > Number(intent.deadline);
          if (expired && !includeExpired) continue;

          const timeRemainingMs = Math.max(0, Number(intent.deadline) - now);

          openIntents.push({
            intentId: intent.objectId,
            owner: intent.owner,
            inputType: intent.input_type,
            outputType: intent.output_type,
            inputAmount: rawToHuman(intent.input_amount, intent.input_type),
            inputAmountRaw: intent.input_amount,
            minOutput: rawToHuman(intent.min_output_amount, intent.output_type),
            minOutputRaw: intent.min_output_amount,
            deadline: intent.deadline,
            deadlineISO: new Date(Number(intent.deadline)).toISOString(),
            timeRemainingMs,
            timeRemainingHuman:
              timeRemainingMs > 0
                ? `${Math.floor(timeRemainingMs / 60000)}m ${Math.floor((timeRemainingMs % 60000) / 1000)}s`
                : "expired",
            expired,
            status: "open",
          });
        }

        // Keep original event order (newest first) — no re-sort needed

        res.json({
          success: true,
          count: openIntents.length,
          intents: openIntents,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/intent/execute
  //
  //  Execute / fill an intent (SOLVER action).
  //  Uses SOLVER_PRIVATE_KEY from .env — no private key in request.
  //
  //  Body (JSON):
  //    { "intentId": "0x..." }
  //
  //  The solver's wallet must hold enough output tokens.
  // ================================================================
  app.post(
    "/api/intent/execute",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!solverKeypair || !solverAddress) {
          res
            .status(500)
            .json({ error: "SOLVER_PRIVATE_KEY not configured in .env" });
          return;
        }

        const { intentId } = req.body;

        if (!intentId) {
          res.status(400).json({
            error: "Missing required field: intentId",
            example: { intentId: "0x..." },
          });
          return;
        }

        // Fetch intent to know types and amounts
        const intent = await sdk.getIntent(intentId);
        if (!intent) {
          res
            .status(404)
            .json({ error: `Intent ${intentId} not found on-chain` });
          return;
        }
        if (intent.status !== STATUS_OPEN) {
          res
            .status(400)
            .json({
              error: `Intent is not open (status: ${STATUS_LABEL[intent.status]})`,
            });
          return;
        }
        if (Date.now() > Number(intent.deadline)) {
          res.status(400).json({ error: "Intent has expired" });
          return;
        }

        const keypair = solverKeypair;
        const solverAddr = solverAddress;
        const outputType = intent.output_type;
        const inputType = intent.input_type;

        console.log(
          `📡 Execute intent ${intentId.slice(0, 10)}... by solver ${solverAddr.slice(0, 10)}...`
        );

        // Determine how much output to provide (min_output_amount + small buffer for safety)
        const minOutput = BigInt(intent.min_output_amount);
        const outputToProvide = minOutput + (minOutput * 5n) / 100n; // +5% buffer

        // Get solver's output coins
        const outputCoins = await suiClient.getCoins({
          owner: solverAddr,
          coinType: outputType,
        });
        if (!outputCoins.data.length) {
          res.status(400).json({
            error: `Solver has no ${outputType} coins. Fund the solver wallet first.`,
          });
          return;
        }
        const totalOutputBalance = outputCoins.data.reduce(
          (s, c) => s + BigInt(c.balance),
          0n
        );
        if (totalOutputBalance < outputToProvide) {
          res.status(400).json({
            error: `Insufficient output balance. Have ${totalOutputBalance}, need ${outputToProvide}`,
          });
          return;
        }

        // Build transaction
        const tx = new TransactionBlock();

        // Prepare output coin
        let sourceCoin = tx.object(outputCoins.data[0].coinObjectId);
        if (outputCoins.data.length > 1) {
          tx.mergeCoins(
            sourceCoin,
            outputCoins.data.slice(1).map((c) => tx.object(c.coinObjectId))
          );
        }
        const [paymentCoin] = tx.splitCoins(sourceCoin, [
          tx.pure.u64(outputToProvide.toString()),
        ]);

        // Execute intent → returns Balance<InputAsset>
        const [inputBalance] = tx.moveCall({
          target: `${solverConfig.packageId}::intent::execute_intent`,
          typeArguments: [inputType, outputType],
          arguments: [
            tx.object(intentId),
            paymentCoin,
            tx.object(solverConfig.protocolConfigId),
            tx.object("0x6"),
          ],
        });

        // Convert balance to coin and transfer to solver
        const inputCoin = tx.moveCall({
          target: "0x2::coin::from_balance",
          typeArguments: [inputType],
          arguments: [inputBalance],
        });
        tx.transferObjects([inputCoin], tx.pure.address(solverAddr));

        const result = await suiClient.signAndExecuteTransactionBlock({
          transactionBlock: tx,
          signer: keypair,
          options: { showEffects: true, showEvents: true },
        });

        const execEvent = result.events?.find((e) =>
          e.type.includes("IntentExecuted")
        );
        const execData = execEvent?.parsedJson as any;

        console.log(
          `✅ Intent executed: ${intentId.slice(0, 10)}... | tx: ${result.digest}`
        );

        res.json({
          success: true,
          intentId,
          digest: result.digest,
          solver: solverAddr,
          inputReceived: execData?.input_amount
            ? rawToHuman(execData.input_amount, inputType)
            : null,
          outputProvided: execData?.output_amount
            ? rawToHuman(execData.output_amount, outputType)
            : null,
          feeAmount: execData?.fee_amount
            ? rawToHuman(execData.fee_amount, inputType)
            : null,
          inputReceivedRaw: execData?.input_amount || null,
          outputProvidedRaw: execData?.output_amount || null,
          feeAmountRaw: execData?.fee_amount || null,
          explorerUrl: `https://suiscan.xyz/testnet/tx/${result.digest}`,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/intent/cancel
  //
  //  Cancel an intent and reclaim deposited tokens (USER action).
  //  Uses USER_PRIVATE_KEY from .env — no private key in request.
  //
  //  Body (JSON):
  //    { "intentId": "0x..." }
  // ================================================================
  app.post(
    "/api/intent/cancel",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!userKeypair || !userAddress) {
          res
            .status(500)
            .json({ error: "USER_PRIVATE_KEY not configured in .env" });
          return;
        }

        const { intentId } = req.body;

        if (!intentId) {
          res.status(400).json({
            error: "Missing required field: intentId",
            example: { intentId: "0x..." },
          });
          return;
        }

        const intent = await sdk.getIntent(intentId);
        if (!intent) {
          res
            .status(404)
            .json({ error: `Intent ${intentId} not found on-chain` });
          return;
        }
        if (intent.status !== STATUS_OPEN) {
          res
            .status(400)
            .json({
              error: `Intent is not open (status: ${STATUS_LABEL[intent.status]})`,
            });
          return;
        }

        const keypair = userKeypair;
        const sender = userAddress;

        console.log(
          `📡 Cancel intent ${intentId.slice(0, 10)}... by ${sender.slice(0, 10)}...`
        );

        const tx = sdk.cancelIntentCustom(
          intentId,
          intent.input_type,
          intent.output_type,
          sender
        );

        const result = await suiClient.signAndExecuteTransactionBlock({
          transactionBlock: tx,
          signer: keypair,
          options: { showEffects: true, showEvents: true },
        });

        console.log(
          `✅ Intent cancelled: ${intentId.slice(0, 10)}... | tx: ${result.digest}`
        );

        res.json({
          success: true,
          intentId,
          digest: result.digest,
          refundedTo: sender,
          refundAmount: rawToHuman(intent.input_amount, intent.input_type),
          refundAmountRaw: intent.input_amount,
          explorerUrl: `https://suiscan.xyz/testnet/tx/${result.digest}`,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/wallet/balance
  //
  //  Check wallet balances for SUI, USDC, and DEEP.
  //
  //  Body (JSON):
  //    { "address": "0x..." }
  // ================================================================
  app.post(
    "/api/wallet/balance",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { address } = req.body;

        if (!address) {
          res.status(400).json({
            error: "Missing required field: address",
            example: { address: "0x..." },
          });
          return;
        }

        console.log(`📡 Balance check: ${(address as string).slice(0, 10)}...`);

        const balances: Record<string, { raw: string; human: number }> = {};

        for (const [alias, coinType] of Object.entries(TOKEN_ALIASES)) {
          try {
            const bal = await suiClient.getBalance({
              owner: address as string,
              coinType,
            });
            balances[alias] = {
              raw: bal.totalBalance,
              human: rawToHuman(bal.totalBalance, coinType),
            };
          } catch {
            balances[alias] = { raw: "0", human: 0 };
          }
        }

        res.json({ success: true, address, balances });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/intents/history
  //
  //  Query recent intent events (created + executed).
  //
  //  Body (JSON – all optional):
  //    { "limit": 20 }
  // ================================================================
  app.post(
    "/api/intents/history",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const limit = Number(req.body?.limit || 20);

        const [created, executed] = await Promise.all([
          sdk.queryIntentCreatedEvents(limit),
          sdk.queryIntentExecutedEvents(limit),
        ]);

        res.json({
          success: true,
          created: created.map((e) => ({
            ...e,
            inputAmountHuman: rawToHuman(e.input_amount, resolveToken("SUI")),
            minOutputHuman: rawToHuman(
              e.min_output_amount,
              resolveToken("USDC")
            ),
          })),
          executed: executed.map((e) => ({
            ...e,
            inputAmountHuman: rawToHuman(e.input_amount, resolveToken("SUI")),
            outputAmountHuman: rawToHuman(
              e.output_amount,
              resolveToken("USDC")
            ),
          })),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/config
  //
  //  Fetch the on-chain ProtocolConfig object.
  //  Body can optionally include { "configId": "0x..." } to override.
  // ================================================================
  app.post(
    "/api/config",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const configId = req.body?.configId || solverConfig.protocolConfigId;

        if (configId === "0x0") {
          res.status(400).json({
            error:
              "PROTOCOL_CONFIG_ID not set in environment and not provided in body",
            example: { configId: "0xabc123..." },
          });
          return;
        }

        const config = await sdk.getConfig(configId);

        if (!config) {
          res.status(404).json({ error: "ProtocolConfig not found on-chain" });
          return;
        }

        res.json({ success: true, config });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  GET /api/solver/metrics
  //
  //  Returns solver performance metrics.
  // ================================================================
  app.get("/api/solver/metrics", (_req: Request, res: Response) => {
    const m = solver.getMetrics();
    res.json({
      success: true,
      metrics: {
        intentsProcessed: m.intentsProcessed,
        intentsExecuted: m.intentsExecuted,
        intentsSkipped: m.intentsSkipped,
        totalProfit: m.totalProfit.toString(),
        totalGasSpent: m.totalGasSpent.toString(),
      },
    });
  });

  // ================================================================
  //  🔐  WALLET-SAFE ENDPOINTS (no private key needed)
  //
  //  These return serialized TransactionBlock bytes (base64).
  //  The frontend signs with a wallet (Sui Wallet, Suiet, Ethos, etc.)
  //  and then submits the signed tx via /api/tx/execute.
  //
  //  Flow:
  //    1. Frontend calls /api/intent/build/create → gets txBytes
  //    2. Frontend signs txBytes with wallet adapter
  //    3. Frontend calls /api/tx/execute { txBytes, signature }
  //       OR submits directly via @mysten/sui.js suiClient.executeTransactionBlock()
  // ================================================================

  // ================================================================
  //  POST /api/intent/build/create
  //
  //  Build an unsigned create-intent transaction.
  //
  //  Body (JSON):
  //    {
  //      "sender":          "0x...",
  //      "from":            "SUI",
  //      "to":              "USDC",
  //      "amount":          0.1,
  //      "minOutput":       0.09,
  //      "deadlineSeconds": 300
  //    }
  //
  //  Returns: { txBytes: "<base64>", txDigest: "..." }
  // ================================================================
  app.post(
    "/api/intent/build/create",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { sender, from, to, amount, minOutput, deadlineSeconds } =
          req.body;

        if (
          !sender ||
          !from ||
          !to ||
          amount === undefined ||
          minOutput === undefined
        ) {
          res.status(400).json({
            error:
              "Missing required fields: sender, from, to, amount, minOutput",
            example: {
              sender: "0xYourWalletAddress",
              from: "SUI",
              to: "USDC",
              amount: 0.1,
              minOutput: 0.09,
              deadlineSeconds: 300,
            },
          });
          return;
        }

        const inputType = resolveToken(from as string);
        const outputType = resolveToken(to as string);
        const rawAmount = humanToRaw(Number(amount), inputType);
        const rawMinOutput = humanToRaw(Number(minOutput), outputType);
        // Pass duration only — the Move contract adds clock::timestamp_ms(clock) internally
        const deadlineMs = String((deadlineSeconds || 300) * 1000);

        console.log(
          `📡 [build] Create intent: ${amount} ${from} → ${to} for ${(sender as string).slice(0, 10)}...`
        );

        const tx = new TransactionBlock();
        tx.setSender(sender as string);

        if (inputType === SUI_TYPE) {
          const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(rawAmount)]);
          tx.moveCall({
            target: `${solverConfig.packageId}::intent::create_intent`,
            typeArguments: [inputType, outputType],
            arguments: [
              coin,
              tx.pure.u64(rawMinOutput),
              tx.pure.u64(deadlineMs),
              tx.object("0x6"),
            ],
          });
        } else {
          // For non-SUI tokens, find coins owned by sender
          const coins = await suiClient.getCoins({
            owner: sender as string,
            coinType: inputType,
          });
          if (!coins.data.length) {
            res
              .status(400)
              .json({ error: `No ${from} coins found in wallet ${sender}` });
            return;
          }
          const primaryCoin = tx.object(coins.data[0].coinObjectId);
          if (coins.data.length > 1) {
            tx.mergeCoins(
              primaryCoin,
              coins.data.slice(1).map((c) => tx.object(c.coinObjectId))
            );
          }
          const [splitCoin] = tx.splitCoins(primaryCoin, [
            tx.pure.u64(rawAmount),
          ]);
          tx.moveCall({
            target: `${solverConfig.packageId}::intent::create_intent`,
            typeArguments: [inputType, outputType],
            arguments: [
              splitCoin,
              tx.pure.u64(rawMinOutput),
              tx.pure.u64(deadlineMs),
              tx.object("0x6"),
            ],
          });
        }

        // Serialize to bytes for wallet signing
        const builtTx = await tx.build({ client: suiClient });
        const txBytes = Buffer.from(builtTx).toString("base64");

        res.json({
          success: true,
          txBytes,
          message:
            "Sign this transaction with your wallet, then submit via /api/tx/execute or directly to Sui RPC.",
          details: {
            sender,
            inputToken: from,
            outputToken: to,
            inputAmount: Number(amount),
            minOutput: Number(minOutput),
            deadlineSeconds: deadlineSeconds || 300,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/intent/build/execute
  //
  //  Build an unsigned execute-intent transaction (for solvers).
  //
  //  Body (JSON):
  //    {
  //      "sender":   "0x...",
  //      "intentId": "0x..."
  //    }
  //
  //  Returns: { txBytes: "<base64>" }
  // ================================================================
  app.post(
    "/api/intent/build/execute",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { sender, intentId } = req.body;

        if (!sender || !intentId) {
          res.status(400).json({
            error: "Missing required fields: sender, intentId",
            example: { sender: "0xSolverAddress", intentId: "0x..." },
          });
          return;
        }

        const intent = await sdk.getIntent(intentId);
        if (!intent) {
          res
            .status(404)
            .json({ error: `Intent ${intentId} not found on-chain` });
          return;
        }
        if (intent.status !== STATUS_OPEN) {
          res
            .status(400)
            .json({
              error: `Intent is not open (status: ${STATUS_LABEL[intent.status]})`,
            });
          return;
        }
        if (Date.now() > Number(intent.deadline)) {
          res.status(400).json({ error: "Intent has expired" });
          return;
        }

        const solverAddr = sender as string;
        const outputType = intent.output_type;
        const inputType = intent.input_type;

        // Determine how much output to provide (+5% buffer)
        const minOutput = BigInt(intent.min_output_amount);
        const outputToProvide = minOutput + (minOutput * 5n) / 100n;

        // Get solver's output coins
        const outputCoins = await suiClient.getCoins({
          owner: solverAddr,
          coinType: outputType,
        });
        if (!outputCoins.data.length) {
          res.status(400).json({
            error: `Solver has no ${outputType} coins. Fund the solver wallet first.`,
          });
          return;
        }
        const totalOutputBalance = outputCoins.data.reduce(
          (s, c) => s + BigInt(c.balance),
          0n
        );
        if (totalOutputBalance < outputToProvide) {
          res.status(400).json({
            error: `Insufficient output balance. Have ${totalOutputBalance}, need ${outputToProvide}`,
          });
          return;
        }

        console.log(
          `📡 [build] Execute intent ${(intentId as string).slice(0, 10)}... for solver ${solverAddr.slice(0, 10)}...`
        );

        const tx = new TransactionBlock();
        tx.setSender(solverAddr);

        // Prepare output coin
        let sourceCoin = tx.object(outputCoins.data[0].coinObjectId);
        if (outputCoins.data.length > 1) {
          tx.mergeCoins(
            sourceCoin,
            outputCoins.data.slice(1).map((c) => tx.object(c.coinObjectId))
          );
        }
        const [paymentCoin] = tx.splitCoins(sourceCoin, [
          tx.pure.u64(outputToProvide.toString()),
        ]);

        // Execute intent → returns Balance<InputAsset>
        const [inputBalance] = tx.moveCall({
          target: `${solverConfig.packageId}::intent::execute_intent`,
          typeArguments: [inputType, outputType],
          arguments: [
            tx.object(intentId as string),
            paymentCoin,
            tx.object(solverConfig.protocolConfigId),
            tx.object("0x6"),
          ],
        });

        // Convert balance to coin and transfer to solver
        const inputCoin = tx.moveCall({
          target: "0x2::coin::from_balance",
          typeArguments: [inputType],
          arguments: [inputBalance],
        });
        tx.transferObjects([inputCoin], tx.pure.address(solverAddr));

        const builtTx = await tx.build({ client: suiClient });
        const txBytes = Buffer.from(builtTx).toString("base64");

        res.json({
          success: true,
          txBytes,
          message: "Sign this transaction with your wallet, then submit.",
          details: {
            intentId,
            solver: solverAddr,
            outputToProvide: outputToProvide.toString(),
            outputToProvideHuman: rawToHuman(
              outputToProvide.toString(),
              outputType
            ),
            inputType,
            outputType,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/intent/build/cancel
  //
  //  Build an unsigned cancel-intent transaction.
  //
  //  Body (JSON):
  //    {
  //      "sender":   "0x...",
  //      "intentId": "0x..."
  //    }
  //
  //  Returns: { txBytes: "<base64>" }
  // ================================================================
  app.post(
    "/api/intent/build/cancel",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { sender, intentId } = req.body;

        if (!sender || !intentId) {
          res.status(400).json({
            error: "Missing required fields: sender, intentId",
            example: { sender: "0xYourWalletAddress", intentId: "0x..." },
          });
          return;
        }

        const intent = await sdk.getIntent(intentId as string);
        if (!intent) {
          res
            .status(404)
            .json({ error: `Intent ${intentId} not found on-chain` });
          return;
        }
        if (intent.status !== STATUS_OPEN) {
          res
            .status(400)
            .json({
              error: `Intent is not open (status: ${STATUS_LABEL[intent.status]})`,
            });
          return;
        }

        console.log(
          `📡 [build] Cancel intent ${(intentId as string).slice(0, 10)}... for ${(sender as string).slice(0, 10)}...`
        );

        const tx = new TransactionBlock();
        tx.setSender(sender as string);

        const [balance] = tx.moveCall({
          target: `${solverConfig.packageId}::intent::cancel_intent`,
          typeArguments: [intent.input_type, intent.output_type],
          arguments: [tx.object(intentId as string)],
        });

        const coin = tx.moveCall({
          target: "0x2::coin::from_balance",
          typeArguments: [intent.input_type],
          arguments: [balance],
        });

        tx.transferObjects([coin], tx.pure.address(sender as string));

        const builtTx = await tx.build({ client: suiClient });
        const txBytes = Buffer.from(builtTx).toString("base64");

        res.json({
          success: true,
          txBytes,
          message: "Sign this transaction with your wallet, then submit.",
          details: {
            intentId,
            sender,
            refundAmount: rawToHuman(intent.input_amount, intent.input_type),
            refundAmountRaw: intent.input_amount,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  POST /api/tx/execute
  //
  //  Submit a wallet-signed transaction to the Sui network.
  //  The frontend signs the txBytes from /build/* endpoints, then
  //  sends the signature here.
  //
  //  Body (JSON):
  //    {
  //      "txBytes":   "<base64 transaction bytes>",
  //      "signature": "<base64 signature from wallet>"
  //    }
  //
  //  Returns: full transaction result with events.
  // ================================================================
  app.post(
    "/api/tx/execute",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { txBytes, signature } = req.body;

        if (!txBytes || !signature) {
          res.status(400).json({
            error: "Missing required fields: txBytes, signature",
            example: {
              txBytes: "<base64 from /api/intent/build/*>",
              signature: "<base64 from wallet.signTransactionBlock()>",
            },
          });
          return;
        }

        console.log(`📡 Submitting signed transaction...`);

        const result = await suiClient.executeTransactionBlock({
          transactionBlock: txBytes as string,
          signature: signature as string,
          options: {
            showEffects: true,
            showEvents: true,
            showObjectChanges: true,
          },
        });

        // Extract relevant events
        const intentCreated = result.events?.find((e) =>
          e.type.includes("IntentCreated")
        );
        const intentExecuted = result.events?.find((e) =>
          e.type.includes("IntentExecuted")
        );
        const intentCancelled = result.events?.find((e) =>
          e.type.includes("IntentCancelled")
        );

        const eventSummary: Record<string, any> = {};
        if (intentCreated) {
          const d = intentCreated.parsedJson as any;
          eventSummary.intentCreated = {
            intentId: d?.intent_id,
            owner: d?.owner,
            inputAmount: d?.input_amount,
            minOutputAmount: d?.min_output_amount,
          };
        }
        if (intentExecuted) {
          const d = intentExecuted.parsedJson as any;
          eventSummary.intentExecuted = {
            intentId: d?.intent_id,
            solver: d?.solver,
            inputAmount: d?.input_amount,
            outputAmount: d?.output_amount,
            feeAmount: d?.fee_amount,
          };
        }
        if (intentCancelled) {
          const d = intentCancelled.parsedJson as any;
          eventSummary.intentCancelled = {
            intentId: d?.intent_id,
            owner: d?.owner,
          };
        }

        res.json({
          success: true,
          digest: result.digest,
          events: eventSummary,
          explorerUrl: `https://suiscan.xyz/testnet/tx/${result.digest}`,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ================================================================
  //  Global error handler – returns the actual error message so you
  //  can debug DeepBook / RPC issues immediately.
  // ================================================================
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("❌ API Error:", err.message);
    console.error(err.stack);
    res.status(500).json({
      success: false,
      error: err.message,
      // Include stack in dev for easy debugging
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  });

  // ================================================================
  //  Start server
  // ================================================================
  app.listen(PORT, () => {
    console.log("");
    console.log("=".repeat(60));
    console.log("🚀 Intent Protocol API Server");
    console.log("=".repeat(60));
    console.log(`   URL:            http://localhost:${PORT}`);
    console.log(`   RPC:            ${RPC_URL}`);
    console.log(`   DeepBook Pkg:   ${DEEPBOOK_PACKAGE_ID}`);
    console.log(`   User address:   ${userAddress || "⚠️  NOT SET"}`);
    console.log(`   Solver address: ${solverAddress || "⚠️  NOT SET"}`);
    console.log("");
    console.log("📖 Endpoints:");
    console.log("");
    console.log("   ── Read-Only ──────────────────────────────────────────");
    console.log(`   GET  /api/health`);
    console.log(`   GET  /api/pools`);
    console.log(`   GET  /api/solver/metrics`);
    console.log("");
    console.log("   ── DeepBook Prices ────────────────────────────────────");
    console.log(`   POST /api/quote          { from, to, amount }`);
    console.log(`   POST /api/orderbook       { base, quote }`);
    console.log(`   POST /api/price           { pair }`);
    console.log("");
    console.log("   ── Intent Lifecycle (testing – keys from .env) ──────");
    console.log(
      `   POST /api/intent/create   { from, to, amount, minOutput, deadlineSeconds }  ← USER_PRIVATE_KEY`
    );
    console.log(`   POST /api/intents/open    { limit? }`);
    console.log(`   POST /api/intent          { id }`);
    console.log(
      `   POST /api/intent/execute  { intentId }                                      ← SOLVER_PRIVATE_KEY`
    );
    console.log(
      `   POST /api/intent/cancel   { intentId }                                      ← USER_PRIVATE_KEY`
    );
    console.log(`   POST /api/intents/history { limit? }`);
    console.log("");
    console.log("   ── 🔐 Wallet-Safe (frontend integration) ────────────");
    console.log(
      `   POST /api/intent/build/create   { sender, from, to, amount, minOutput, deadlineSeconds }`
    );
    console.log(`   POST /api/intent/build/execute   { sender, intentId }`);
    console.log(`   POST /api/intent/build/cancel    { sender, intentId }`);
    console.log(`   POST /api/tx/execute             { txBytes, signature }`);
    console.log("");
    console.log("   ── Wallet & Config ───────────────────────────────────");
    console.log(`   POST /api/wallet/balance  { address }`);
    console.log(`   POST /api/config          { configId? }`);
    console.log("");
    console.log("📝 Example – get quote:");
    console.log(`   curl -X POST http://localhost:${PORT}/api/quote \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"from":"SUI","to":"USDC","amount":0.1}'`);
    console.log("");
    console.log("📝 Example – build intent (wallet-safe):");
    console.log(
      `   curl -X POST http://localhost:${PORT}/api/intent/build/create \\`
    );
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(
      `     -d '{"sender":"0xYourAddress","from":"SUI","to":"USDC","amount":0.01,"minOutput":0.009,"deadlineSeconds":300}'`
    );
    console.log("=".repeat(60));
    console.log("");
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
