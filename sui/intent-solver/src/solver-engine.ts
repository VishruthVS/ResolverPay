/**
 * Intent Protocol V2 - Solver Engine
 * 
 * This solver engine monitors and executes intents profitably using:
 * - Real-time event monitoring
 * - DeepBook V3 integration for swaps
 * - Profitability analysis
 * - Gas optimization
 */

import 'dotenv/config';
import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import {
  IntentProtocolSDK,
  Intent,
  STATUS_OPEN,
} from './intent-protocol-sdk';

// Note: DeepBook V3 SDK integration
// For full integration, the SDK should be used via:
// import { deepbook, DeepBookClient } from '@mysten/deepbook-v3';
// const client = new SuiGrpcClient({ network: 'mainnet' }).$extend(deepbook({ address: '...' }));
// However, we use devInspect calls for compatibility with @mysten/sui.js

// DeepBook V3 Constants – read from env, falling back to testnet defaults
export const DEEPBOOK_PACKAGE_ID = process.env.DEEPBOOK_PACKAGE_ID
  || '0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982';
export const DEEP_TOKEN_TYPE = process.env.DEEP_TOKEN_TYPE
  || '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP';
export const SUI_TYPE = process.env.SUI_TYPE || '0x2::sui::SUI';
export const USDC_TYPE = process.env.USDC_TYPE
  || '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';
// Real testnet USDC (different from DeepBook's DBUSDC)
export const USDC_TESTNET_TYPE = process.env.USDC_TESTNET_TYPE
  || '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

// DeepBook V3 Pool IDs – read from env, falling back to testnet defaults
export const DEEPBOOK_POOLS: Record<string, string> = {
  'SUI_USDC': process.env.SUI_USDC_DEEPBOOK_POOL_ID
    || '0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5',
  'DEEP_SUI': process.env.DEEP_SUI_POOL_ID
    || '0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622', // Actually DEEP/USDC on testnet
  'DEEP_USDC': process.env.DEEP_USDC_POOL_ID
    || '0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622',
};

// ===== Configuration =====

export interface SolverConfig {
  rpcUrl: string;
  privateKey: string;
  packageId: string;
  protocolConfigId: string;
  minProfitBps: number; // Minimum profit in basis points (e.g., 50 = 0.5%)
  maxGasPrice: number; // Maximum gas price willing to pay
  pollingIntervalMs: number; // Interval for checking open intents
  enableEventSubscription: boolean; // Whether to use real-time events
  // DeepBook V3 specific config
  balanceManagerId?: string; // Optional: existing balance manager
  deepbookPackageId?: string; // Optional: override DeepBook package ID
}

export interface PoolConfig {
  poolId: string;
  baseType: string;
  quoteType: string;
  tickSize: number;
  lotSize: number; // Minimum order size
  baseScalar: number; // Decimal adjustment for base token
  quoteScalar: number; // Decimal adjustment for quote token
}

export interface SwapQuote {
  inputAmount: string;
  outputAmount: string;
  priceImpact: number;
  route: string[]; // Pool IDs used
  midPrice: number; // Current mid price from order book
  bestBid: number;
  bestAsk: number;
}

export interface Level2Data {
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
}

// ===== Solver Engine =====

export class SolverEngine {
  private client: SuiClient;
  private sdk: IntentProtocolSDK;
  private keypair: Ed25519Keypair;
  private address: string;
  private config: SolverConfig;
  
  // Pool registry for routing
  private pools: Map<string, PoolConfig> = new Map();
  
  // Pool name mapping for DeepBook SDK queries
  private poolNameMap: Map<string, string> = new Map();
  
  // Track intents being processed to avoid duplicates
  private processingIntents: Set<string> = new Set();
  
  // DeepBook V3 balance manager ID (created on first use)
  private balanceManagerId: string | null = null;
  
  // Performance metrics
  private metrics = {
    intentsProcessed: 0,
    intentsExecuted: 0,
    intentsSkipped: 0,
    totalProfit: BigInt(0),
    totalGasSpent: BigInt(0),
  };

  constructor(config: SolverConfig) {
    this.config = config;
    this.client = new SuiClient({ url: config.rpcUrl });
    this.sdk = new IntentProtocolSDK(this.client, config.packageId);
    
    this.keypair = Ed25519Keypair.fromSecretKey(
      Uint8Array.from(Buffer.from(config.privateKey, 'hex'))
    );
    this.address = this.keypair.getPublicKey().toSuiAddress();
    
    // Use existing balance manager if provided
    if (config.balanceManagerId) {
      this.balanceManagerId = config.balanceManagerId;
    }
    
    // Register default DeepBook V3 pools
    this.registerDefaultPools();
  }

  // ===== DeepBook V3 Initialization =====

  /**
   * Register default DeepBook V3 pools (reads types from env / constants)
   */
  private registerDefaultPools(): void {
    // SUI/USDC pool (on testnet: SUI/DBUSDC)
    this.registerPool({
      poolId: DEEPBOOK_POOLS['SUI_USDC'],
      baseType: SUI_TYPE,
      quoteType: USDC_TYPE,
      tickSize: 1,
      lotSize: 1000000, // 0.001 SUI minimum
      baseScalar: 1e9, // 9 decimals
      quoteScalar: 1e6, // 6 decimals
    });
    this.poolNameMap.set(`${SUI_TYPE}/${USDC_TYPE}`, 'SUI_USDC');
    this.poolNameMap.set(`${USDC_TYPE}/${SUI_TYPE}`, 'SUI_USDC');

    // DEEP/USDC pool (on testnet: DEEP/DBUSDC)
    this.registerPool({
      poolId: DEEPBOOK_POOLS['DEEP_USDC'],
      baseType: DEEP_TOKEN_TYPE,
      quoteType: USDC_TYPE,
      tickSize: 1,
      lotSize: 1000000,
      baseScalar: 1e6,
      quoteScalar: 1e6,
    });
    this.poolNameMap.set(`${DEEP_TOKEN_TYPE}/${USDC_TYPE}`, 'DEEP_USDC');
    this.poolNameMap.set(`${USDC_TYPE}/${DEEP_TOKEN_TYPE}`, 'DEEP_USDC');

    // DEEP/SUI pool – only register if a distinct pool exists
    // On testnet, no DEEP/SUI pool exists; DEEP_SUI env var may point to DEEP/USDC pool
    if (DEEPBOOK_POOLS['DEEP_SUI'] !== DEEPBOOK_POOLS['DEEP_USDC']) {
      this.registerPool({
        poolId: DEEPBOOK_POOLS['DEEP_SUI'],
        baseType: DEEP_TOKEN_TYPE,
        quoteType: SUI_TYPE,
        tickSize: 1,
        lotSize: 1000000,
        baseScalar: 1e6,
        quoteScalar: 1e9,
      });
      this.poolNameMap.set(`${DEEP_TOKEN_TYPE}/${SUI_TYPE}`, 'DEEP_SUI');
      this.poolNameMap.set(`${SUI_TYPE}/${DEEP_TOKEN_TYPE}`, 'DEEP_SUI');
    }
  }

  /**
   * Create a DeepBook V3 Balance Manager (required for trading)
   */
  async createBalanceManager(): Promise<string> {
    console.log('📦 Creating DeepBook V3 Balance Manager...');
    
    const tx = new TransactionBlock();
    const deepbookPackage = this.config.deepbookPackageId || DEEPBOOK_PACKAGE_ID;
    
    tx.moveCall({
      target: `${deepbookPackage}::balance_manager::new`,
      arguments: [],
    });

    const result = await this.client.signAndExecuteTransactionBlock({
      transactionBlock: tx,
      signer: this.keypair,
      options: { showEffects: true, showObjectChanges: true },
    });

    // Find the created BalanceManager object
    const createdObject = result.objectChanges?.find(
      (change) => change.type === 'created' && 
        change.objectType?.includes('BalanceManager')
    );

    if (createdObject && createdObject.type === 'created') {
      this.balanceManagerId = createdObject.objectId;
      console.log(`✅ Balance Manager created: ${this.balanceManagerId}`);
      return this.balanceManagerId;
    }

    throw new Error('Failed to create Balance Manager');
  }

  /**
   * Deposit funds into Balance Manager for trading
   */
  async depositToBalanceManager(coinType: string, amount: string): Promise<void> {
    if (!this.balanceManagerId) {
      await this.createBalanceManager();
    }

    console.log(`💰 Depositing ${amount} ${this.formatType(coinType)} to Balance Manager...`);
    
    const tx = new TransactionBlock();
    const deepbookPackage = this.config.deepbookPackageId || DEEPBOOK_PACKAGE_ID;
    
    // Get coins to deposit
    const coins = await this.getCoins(coinType, amount);
    if (coins.length === 0) {
      throw new Error('Insufficient balance for deposit');
    }

    let coinToDeposit = tx.object(coins[0]);
    if (coins.length > 1) {
      tx.mergeCoins(coinToDeposit, coins.slice(1).map(id => tx.object(id)));
    }

    // Split exact amount
    const [depositCoin] = tx.splitCoins(coinToDeposit, [tx.pure.u64(amount)]);

    tx.moveCall({
      target: `${deepbookPackage}::balance_manager::deposit`,
      typeArguments: [coinType],
      arguments: [
        tx.object(this.balanceManagerId!),
        depositCoin,
      ],
    });

    await this.client.signAndExecuteTransactionBlock({
      transactionBlock: tx,
      signer: this.keypair,
      options: { showEffects: true },
    });

    console.log(`✅ Deposited successfully`);
  }

  // ===== Pool Management =====

  /**
   * Register a liquidity pool for routing
   */
  registerPool(config: PoolConfig): void {
    const key = `${config.baseType}/${config.quoteType}`;
    this.pools.set(key, config);
    console.log(`📊 Registered pool: ${key}`);
  }

  /**
   * Find pool for a given token pair
   */
  public findPool(inputType: string, outputType: string): PoolConfig | null {
    const directKey = `${inputType}/${outputType}`;
    const reverseKey = `${outputType}/${inputType}`;
    
    return this.pools.get(directKey) || this.pools.get(reverseKey) || null;
  }

  // ===== Intent Monitoring =====

  /**
   * Start the solver engine
   */
  async start(): Promise<void> {
    console.log('\n🤖 Solver Engine Starting...');
    console.log(`📍 Solver Address: ${this.address}`);
    console.log(`📦 Intent Package ID: ${this.config.packageId}`);
    console.log(`⚙️  Min Profit: ${this.config.minProfitBps} bps (${this.config.minProfitBps / 100}%)`);
    console.log(`⛽ Max Gas: ${this.config.maxGasPrice}`);
    console.log('');

    // Test DeepBook V3 connection by querying a pool - errors will propagate
    console.log('🔗 Testing DeepBook V3 connection...');
    try {
      const testQuote = await this.getSwapQuote(SUI_TYPE, USDC_TYPE, '1000000000'); // 1 SUI
      console.log(`✅ DeepBook V3 connected! SUI/USDC mid price: $${testQuote.midPrice.toFixed(4)}`);
    } catch (error) {
      console.error('❌ DeepBook V3 connection test FAILED. Fix this before proceeding:', error);
      throw error; // Do not silently ignore - DeepBook must be reachable
    }

    // Subscribe to real-time events if enabled
    if (this.config.enableEventSubscription) {
      await this.subscribeToEvents();
    }

    // Start polling for open intents
    await this.startPolling();
  }

  /**
   * Subscribe to IntentCreated events
   */
  private async subscribeToEvents(): Promise<void> {
    console.log('👂 Subscribing to IntentCreated events...');

    await this.sdk.subscribeToIntentCreated(async (event) => {
      console.log(`\n📬 New Intent: ${event.intent_id}`);
      console.log(`   Owner: ${event.owner}`);
      console.log(`   Input: ${event.input_amount} ${this.formatType(event.input_type)}`);
      console.log(`   Min Output: ${event.min_output_amount} ${this.formatType(event.output_type)}`);
      
      // Process the intent
      await this.processIntent(event.intent_id);
    });

    console.log('✅ Event subscription active\n');
  }

  /**
   * Poll for open intents periodically
   */
  private async startPolling(): Promise<void> {
    console.log(`🔄 Starting polling (interval: ${this.config.pollingIntervalMs}ms)\n`);

    setInterval(async () => {
      try {
        await this.scanOpenIntents();
      } catch (error) {
        console.error('❌ Polling error:', error);
      }
    }, this.config.pollingIntervalMs);

    // Run once immediately
    await this.scanOpenIntents();
  }

  /**
   * Scan all open intents from events
   */
  private async scanOpenIntents(): Promise<void> {
    const events = await this.sdk.queryIntentCreatedEvents(100);
    
    let openCount = 0;
    for (const event of events) {
      // Check if intent is still open
      const intent = await this.sdk.getIntent(event.intent_id);
      
      if (intent && intent.status === STATUS_OPEN && !this.processingIntents.has(event.intent_id)) {
        openCount++;
        await this.processIntent(event.intent_id);
      }
    }

    if (openCount > 0) {
      console.log(`🔍 Scanned ${events.length} events, found ${openCount} open intents`);
    }
  }

  // ===== Intent Execution =====

  /**
   * Process a single intent
   */
  private async processIntent(intentId: string): Promise<void> {
    // Prevent duplicate processing
    if (this.processingIntents.has(intentId)) {
      return;
    }

    this.processingIntents.add(intentId);
    this.metrics.intentsProcessed++;

    try {
      // Fetch intent details
      const intent = await this.sdk.getIntent(intentId);
      if (!intent) {
        console.log(`⚠️  Intent ${intentId} not found`);
        return;
      }

      // Validate intent state
      if (intent.status !== STATUS_OPEN) {
        console.log(`⏭️  Intent ${intentId} not open (status: ${intent.status})`);
        return;
      }

      // Check if expired
      if (this.sdk.isIntentExpired(intent, Date.now())) {
        console.log(`⏰ Intent ${intentId} expired, cleaning up...`);
        await this.cleanupExpiredIntent(intent);
        return;
      }

      // Check profitability
      const profitability = await this.analyzeProfitability(intent);
      
      if (!profitability.isProfitable) {
        console.log(`📉 Intent ${intentId} not profitable: ${profitability.profitBps.toFixed(2)} bps (min: ${this.config.minProfitBps})`);
        this.metrics.intentsSkipped++;
        return;
      }

      // Execute the intent
      console.log(`\n💰 Executing profitable intent ${intentId}`);
      console.log(`   Profit: ${profitability.profitBps.toFixed(2)} bps`);
      console.log(`   Expected: ${profitability.expectedProfit} (${profitability.profitToken})`);
      
      await this.executeIntent(intent, profitability);

    } catch (error) {
      console.error(`❌ Error processing intent ${intentId}:`, error);
    } finally {
      this.processingIntents.delete(intentId);
    }
  }

  /**
   * Analyze profitability of an intent
   */
  private async analyzeProfitability(intent: Intent): Promise<{
    isProfitable: boolean;
    profitBps: number;
    expectedProfit: string;
    profitToken: string;
    quote: SwapQuote;
  }> {
    try {
      // Get swap quote from market - throws on failure, no fallback
      const quote = await this.getSwapQuote(
        intent.input_type,
        intent.output_type,
        intent.input_amount
      );

      // Calculate profit
      const outputReceived = BigInt(quote.outputAmount);
      const outputRequired = BigInt(intent.min_output_amount);
      const inputProvided = BigInt(intent.input_amount);

      // Get protocol fee (for future profitability calculations)
      // const config = await this.sdk.getConfig(this.config.protocolConfigId);
      // const feeAmount = config 
      //   ? (inputProvided * BigInt(config.fee_bps)) / BigInt(10000)
      //   : BigInt(0);
      // const inputAfterFee = inputProvided - feeAmount;

      // Profit = (output we can get) - (min output required by intent owner)
      // If we can get more output than required, we profit the difference
      const profitInOutput = outputReceived > outputRequired 
        ? outputReceived - outputRequired 
        : BigInt(0);

      // Calculate profit in basis points relative to input
      const profitBps = Number((profitInOutput * BigInt(10000)) / inputProvided);

      return {
        isProfitable: profitBps >= this.config.minProfitBps,
        profitBps,
        expectedProfit: profitInOutput.toString(),
        profitToken: intent.output_type,
        quote,
      };

    } catch (error) {
      console.error('❌ Error analyzing profitability:', error);
      throw error; // Propagate error - no silent fallback
    }
  }

  /**
   * Execute an intent using PTB (Programmable Transaction Block)
   */
  private async executeIntent(
    intent: Intent,
    _profitability: { quote: SwapQuote }
  ): Promise<void> {
    const tx = new TransactionBlock();

    try {
      // Step 1: Get coins for the swap (solver provides output)
      const outputCoins = await this.getCoins(intent.output_type, intent.min_output_amount);
      
      if (outputCoins.length === 0) {
        throw new Error('Insufficient balance for output token');
      }

      // Step 2: Merge coins if multiple
      let outputCoin = tx.object(outputCoins[0]);
      if (outputCoins.length > 1) {
        tx.mergeCoins(
          outputCoin,
          outputCoins.slice(1).map(id => tx.object(id))
        );
      }

      // Step 3: Execute the intent - this returns the input balance
      const [inputBalance] = tx.moveCall({
        target: `${this.config.packageId}::intent::execute_intent`,
        typeArguments: [intent.input_type, intent.output_type],
        arguments: [
          tx.object(intent.objectId),
          outputCoin,
          tx.object(this.config.protocolConfigId),
          tx.object('0x6'), // Clock
        ],
      });

      // Step 4: Convert balance to coin
      const inputCoin = tx.moveCall({
        target: '0x2::coin::from_balance',
        typeArguments: [intent.input_type],
        arguments: [inputBalance],
      });

      // Step 5: Swap the received input back to output (to realize profit)
      const swapResult = await this.addSwapToTransaction(
        tx,
        inputCoin,
        intent.input_type,
        intent.output_type
      );

      // Step 6: Transfer final coins to solver
      tx.transferObjects([swapResult], tx.pure.address(this.address));

      // Set gas budget
      tx.setGasBudget(this.config.maxGasPrice);

      // Execute transaction
      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        signer: this.keypair,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        const gasUsed = BigInt(result.effects.gasUsed.computationCost);
        
        console.log(`✅ Intent executed successfully!`);
        console.log(`   Transaction: ${result.digest}`);
        console.log(`   Gas used: ${gasUsed}`);
        
        this.metrics.intentsExecuted++;
        this.metrics.totalGasSpent += gasUsed;
        
        this.printMetrics();
      } else {
        throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
      }

    } catch (error) {
      console.error(`❌ Failed to execute intent:`, error);
      throw error;
    }
  }

  /**
   * Add DeepBook V3 swap to transaction (REAL IMPLEMENTATION)
   * Uses actual DeepBook V3 Move calls
   */
  private async addSwapToTransaction(
    tx: TransactionBlock,
    inputCoin: any,
    inputType: string,
    outputType: string
  ): Promise<any> {
    const pool = this.findPool(inputType, outputType);
    
    if (!pool) {
      throw new Error(`No pool found for ${inputType} -> ${outputType}`);
    }

    const deepbookPackage = this.config.deepbookPackageId || DEEPBOOK_PACKAGE_ID;
    const isSellBase = inputType === pool.baseType;

    console.log(`🔄 Adding DeepBook V3 swap: ${this.formatType(inputType)} -> ${this.formatType(outputType)}`);

    if (isSellBase) {
      // Selling base for quote: swap_exact_base_for_quote
      // Need DEEP tokens for fees
      const deepCoins = await this.getCoins(DEEP_TOKEN_TYPE, '1000000'); // 1 DEEP for fees
      let deepCoin = deepCoins.length > 0 ? tx.object(deepCoins[0]) : null;
      
      if (!deepCoin) {
        throw new Error('No DEEP tokens available for DeepBook V3 swap fees. Acquire DEEP tokens before swapping.');
      }

      const [baseCoinResult, quoteCoinResult, deepCoinResult] = tx.moveCall({
        target: `${deepbookPackage}::pool::swap_exact_base_for_quote`,
        typeArguments: [pool.baseType, pool.quoteType],
        arguments: [
          tx.object(pool.poolId), // Pool
          inputCoin, // Base coin to sell
          deepCoin, // DEEP for fees
          tx.pure.u64('0'), // Min quote out (we checked profitability already)
          tx.object('0x6'), // Clock
        ],
      });

      // Transfer leftover base and deep back to solver
      tx.transferObjects([baseCoinResult, deepCoinResult], tx.pure.address(this.address));
      
      return quoteCoinResult;
    } else {
      // Buying base with quote: swap_exact_quote_for_base
      const deepCoins = await this.getCoins(DEEP_TOKEN_TYPE, '1000000');
      if (deepCoins.length === 0) {
        throw new Error('No DEEP tokens available for DeepBook V3 swap fees. Acquire DEEP tokens before swapping.');
      }
      const deepCoin = tx.object(deepCoins[0]);

      const [baseCoinResult, quoteCoinResult, deepCoinResult] = tx.moveCall({
        target: `${deepbookPackage}::pool::swap_exact_quote_for_base`,
        typeArguments: [pool.baseType, pool.quoteType],
        arguments: [
          tx.object(pool.poolId), // Pool
          inputCoin, // Quote coin to spend
          deepCoin, // DEEP for fees
          tx.pure.u64('0'), // Min base out
          tx.object('0x6'), // Clock
        ],
      });

      // Transfer leftover quote and deep back
      tx.transferObjects([quoteCoinResult, deepCoinResult], tx.pure.address(this.address));
      
      return baseCoinResult;
    }
  }

  /**
   * Swap using Balance Manager (more gas efficient for repeated swaps)
   * Call createBalanceManager() and depositToBalanceManager() first
   */
  public async swapWithBalanceManager(
    tx: TransactionBlock,
    inputAmount: string,
    inputType: string,
    outputType: string,
    minOutput: string
  ): Promise<void> {
    if (!this.balanceManagerId) {
      throw new Error('Balance Manager not initialized. Call createBalanceManager() first.');
    }

    const pool = this.findPool(inputType, outputType);
    if (!pool) {
      throw new Error(`No pool found for ${inputType} -> ${outputType}`);
    }

    const deepbookPackage = this.config.deepbookPackageId || DEEPBOOK_PACKAGE_ID;
    const isSellBase = inputType === pool.baseType;

    // Generate trade proof from balance manager
    const [tradeProof] = tx.moveCall({
      target: `${deepbookPackage}::balance_manager::generate_proof_as_owner`,
      arguments: [tx.object(this.balanceManagerId)],
    });

    if (isSellBase) {
      tx.moveCall({
        target: `${deepbookPackage}::pool::swap_exact_base_for_quote_with_manager`,
        typeArguments: [pool.baseType, pool.quoteType],
        arguments: [
          tx.object(pool.poolId),
          tx.object(this.balanceManagerId),
          tradeProof,
          tx.pure.u64(inputAmount),
          tx.pure.u64(minOutput),
          tx.object('0x6'), // Clock
        ],
      });
    } else {
      tx.moveCall({
        target: `${deepbookPackage}::pool::swap_exact_quote_for_base_with_manager`,
        typeArguments: [pool.baseType, pool.quoteType],
        arguments: [
          tx.object(pool.poolId),
          tx.object(this.balanceManagerId),
          tradeProof,
          tx.pure.u64(inputAmount),
          tx.pure.u64(minOutput),
          tx.object('0x6'), // Clock
        ],
      });
    }
  }

  /**
   * Get swap quote from DeepBook V3 order book (REAL IMPLEMENTATION)
   * Queries actual order book data for accurate pricing
   */
  public async getSwapQuote(
    inputType: string,
    outputType: string,
    inputAmount: string
  ): Promise<SwapQuote> {
    const pool = this.findPool(inputType, outputType);
    
    if (!pool) {
      throw new Error(`No DeepBook pool found for ${this.formatType(inputType)} -> ${this.formatType(outputType)}. Register the pool first.`);
    }

    try {
      // Query DeepBook V3 order book Level 2 data
      const level2 = await this.getLevel2Data(pool.poolId, pool.baseType, pool.quoteType);
      
      if (!level2 || (level2.bids.length === 0 && level2.asks.length === 0)) {
        throw new Error(`No liquidity data returned from DeepBook pool ${pool.poolId}`);
      }

      // Determine if we're selling base (inputType is base) or buying base (inputType is quote)
      const isSellBase = inputType === pool.baseType;
      const inputAmountRaw = Number(inputAmount);

      // Convert raw input to human-readable units
      // Order book prices & quantities are already in human units
      const inputScalar = isSellBase ? pool.baseScalar : pool.quoteScalar;
      const outputScalar = isSellBase ? pool.quoteScalar : pool.baseScalar;
      const inputAmountHuman = inputAmountRaw / inputScalar;
      
      let outputAmountHuman: number;
      let priceImpact: number;
      let midPrice: number;
      
      if (level2.bids.length === 0) {
        throw new Error(`DeepBook: No bids available in order book for pool. Cannot determine price.`);
      }
      if (level2.asks.length === 0) {
        throw new Error(`DeepBook: No asks available in order book for pool. Cannot determine price.`);
      }
      const bestBid = level2.bids[0].price;
      const bestAsk = level2.asks[0].price;
      midPrice = (bestBid + bestAsk) / 2;

      if (isSellBase) {
        // Selling base for quote - walk through bids (human units)
        const result = this.simulateMarketSell(level2.bids, inputAmountHuman, pool);
        outputAmountHuman = result.outputAmount;
        priceImpact = result.priceImpact;
      } else {
        // Buying base with quote - walk through asks (human units)
        const result = this.simulateMarketBuy(level2.asks, inputAmountHuman, pool);
        outputAmountHuman = result.outputAmount;
        priceImpact = result.priceImpact;
      }

      // Convert output back to raw (smallest) units
      const outputAmountRaw = Math.floor(outputAmountHuman * outputScalar);

      console.log(`📊 DeepBook Quote: ${inputAmountHuman} ${this.formatType(inputType)} -> ${outputAmountHuman.toFixed(6)} ${this.formatType(outputType)}`);
      console.log(`   Mid Price: ${midPrice.toFixed(6)} | Impact: ${priceImpact.toFixed(2)}%`);
      console.log(`   Raw units: ${inputAmountRaw} -> ${outputAmountRaw}`);

      return {
        inputAmount,
        outputAmount: outputAmountRaw.toString(),
        priceImpact,
        route: [pool.poolId],
        midPrice,
        bestBid,
        bestAsk,
      };

    } catch (error) {
      console.error('❌ Error getting DeepBook swap quote:', error);
      throw error; // Propagate error - no silent fallback
    }
  }

  /**
   * Get Level 2 order book data from DeepBook V3 using devInspect
   * Queries the on-chain order book for real prices - no hardcoded values
   */
  public async getLevel2Data(poolId: string, baseType: string, quoteType: string): Promise<Level2Data> {
    const deepbookPackage = this.config.deepbookPackageId || DEEPBOOK_PACKAGE_ID;
    
    try {
      // Query DeepBook V3 order book using get_level2_ticks_from_mid
      // This returns: (bid_prices, bid_quantities, ask_prices, ask_quantities)
      const tx = new TransactionBlock();
      tx.moveCall({
        target: `${deepbookPackage}::pool::get_level2_ticks_from_mid`,
        typeArguments: [baseType, quoteType],
        arguments: [
          tx.object(poolId),
          tx.pure.u64(100), // Get up to 100 ticks from mid price
          tx.object('0x6'), // Clock
        ],
      });

      const result = await this.client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: this.address,
      });

      if (!result.results?.[0]?.returnValues || result.results[0].returnValues.length < 4) {
        throw new Error(`DeepBook devInspect returned no data for pool ${poolId}. Check pool ID, base/quote types, and network connectivity.`);
      }

      // Parse the BCS-encoded vectors from the return values
      const returnValues = result.results[0].returnValues;
      
      // Decode the u64 vectors - each returnValue is [bcsBytes, typeString]
      const decodeU64Vector = (returnValue: [number[], string]): bigint[] => {
        const bytes = new Uint8Array(returnValue[0]);
        // BCS format: length (uleb128) followed by u64 values (8 bytes each, little endian)
        const result: bigint[] = [];
        let offset = 0;
        
        // Read ULEB128 length
        let length = 0;
        let shift = 0;
        while (offset < bytes.length) {
          const byte = bytes[offset++];
          length |= (byte & 0x7f) << shift;
          if ((byte & 0x80) === 0) break;
          shift += 7;
        }
        
        // Read u64 values
        for (let i = 0; i < length && offset + 8 <= bytes.length; i++) {
          let value = BigInt(0);
          for (let j = 0; j < 8; j++) {
            value |= BigInt(bytes[offset + j]) << BigInt(j * 8);
          }
          result.push(value);
          offset += 8;
        }
        
        return result;
      };

      const bidPrices = decodeU64Vector(returnValues[0] as [number[], string]);
      const bidQuantities = decodeU64Vector(returnValues[1] as [number[], string]);
      const askPrices = decodeU64Vector(returnValues[2] as [number[], string]);
      const askQuantities = decodeU64Vector(returnValues[3] as [number[], string]);

      // Get pool config for scalar values
      const pool = this.findPool(baseType, quoteType);
      if (!pool) {
        throw new Error(`Pool config not found for ${baseType}/${quoteType}. Register the pool first.`);
      }

      const FLOAT_SCALAR = 1_000_000_000; // DeepBook uses 1e9 for price scaling

      // Convert to our format with proper price scaling
      const bids: { price: number; quantity: number }[] = [];
      const asks: { price: number; quantity: number }[] = [];

      for (let i = 0; i < bidPrices.length && i < bidQuantities.length; i++) {
        // Price conversion: (rawPrice / FLOAT_SCALAR / quoteScalar) * baseScalar
        const price = Number(bidPrices[i]) / FLOAT_SCALAR / pool.quoteScalar * pool.baseScalar;
        const quantity = Number(bidQuantities[i]) / pool.baseScalar;
        if (price > 0 && quantity > 0) {
          bids.push({ price, quantity });
        }
      }

      for (let i = 0; i < askPrices.length && i < askQuantities.length; i++) {
        const price = Number(askPrices[i]) / FLOAT_SCALAR / pool.quoteScalar * pool.baseScalar;
        const quantity = Number(askQuantities[i]) / pool.baseScalar;
        if (price > 0 && quantity > 0) {
          asks.push({ price, quantity });
        }
      }

      // Bids should be sorted descending, asks ascending (already sorted from contract)
      bids.sort((a, b) => b.price - a.price);
      asks.sort((a, b) => a.price - b.price);

      if (bids.length === 0 && asks.length === 0) {
        throw new Error(`No liquidity found in DeepBook pool ${poolId}. The pool may be empty or the price parsing failed.`);
      }

      console.log(`📖 Order book data retrieved from DeepBook V3: ${bids.length} bids, ${asks.length} asks`);
      if (bids.length > 0) console.log(`   Best bid: $${bids[0].price.toFixed(6)}`);
      if (asks.length > 0) console.log(`   Best ask: $${asks[0].price.toFixed(6)}`);
      
      return { bids, asks };

    } catch (error) {
      console.error('❌ Error fetching Level 2 data from DeepBook V3:', error);
      throw error; // Propagate error - no silent fallback
    }
  }

  /**
   * Simulate selling base token through the order book
   */
  private simulateMarketSell(
    bids: { price: number; quantity: number }[],
    inputAmount: number,
    _pool: PoolConfig
  ): { outputAmount: number; priceImpact: number } {
    if (bids.length === 0) {
      throw new Error('Cannot simulate market sell: no bids in order book');
    }
    let remainingInput = inputAmount;
    let totalOutput = 0;
    const startPrice = bids[0].price;

    for (const bid of bids) {
      if (remainingInput <= 0) break;
      
      const fillAmount = Math.min(remainingInput, bid.quantity);
      totalOutput += fillAmount * bid.price;
      remainingInput -= fillAmount;
    }

    // Calculate price impact
    const endPrice = bids[bids.length - 1]?.price || startPrice;
    const priceImpact = startPrice > 0 ? ((startPrice - endPrice) / startPrice) * 100 : 0;

    return { outputAmount: totalOutput, priceImpact };
  }

  /**
   * Simulate buying base token through the order book
   */
  private simulateMarketBuy(
    asks: { price: number; quantity: number }[],
    inputAmount: number, // in quote token
    _pool: PoolConfig
  ): { outputAmount: number; priceImpact: number } {
    if (asks.length === 0) {
      throw new Error('Cannot simulate market buy: no asks in order book');
    }
    let remainingInput = inputAmount;
    let totalOutput = 0;
    const startPrice = asks[0].price;

    for (const ask of asks) {
      if (remainingInput <= 0) break;
      
      const maxBuyable = remainingInput / ask.price;
      const fillAmount = Math.min(maxBuyable, ask.quantity);
      totalOutput += fillAmount;
      remainingInput -= fillAmount * ask.price;
    }

    // Calculate price impact
    const endPrice = asks[asks.length - 1]?.price || startPrice;
    const priceImpact = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

    return { outputAmount: totalOutput, priceImpact };
  }

  /**
   * Get coins owned by solver
   */
  private async getCoins(coinType: string, minAmount: string): Promise<string[]> {
    try {
      const coins = await this.client.getCoins({
        owner: this.address,
        coinType,
      });

      // Filter coins that have enough balance
      let totalBalance = BigInt(0);
      const selectedCoins: string[] = [];

      for (const coin of coins.data) {
        selectedCoins.push(coin.coinObjectId);
        totalBalance += BigInt(coin.balance);
        
        if (totalBalance >= BigInt(minAmount)) {
          break;
        }
      }

      if (totalBalance < BigInt(minAmount)) {
        throw new Error(`Insufficient balance: have ${totalBalance}, need ${minAmount}`);
      }

      return selectedCoins;
    } catch (error) {
      console.error('❌ Error getting coins:', error);
      throw error; // Propagate error - no silent fallback
    }
  }

  // ===== Cleanup Functions =====

  /**
   * Clean up an expired intent
   */
  private async cleanupExpiredIntent(intent: Intent): Promise<void> {
    try {
      const tx = this.sdk.cleanupExpired(
        intent.objectId,
        intent.input_type,
        intent.output_type
      );

      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        signer: this.keypair,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`🧹 Cleaned up expired intent: ${intent.objectId}`);
      }
    } catch (error) {
      console.error('Error cleaning up expired intent:', error);
    }
  }

  // ===== Utility Functions =====

  /**
   * Format type name for display
   */
  public formatType(type: string): string {
    const parts = type.split('::');
    return parts.length >= 2 ? parts[parts.length - 1] : type;
  }

  /**
   * Print current metrics
   */
  private printMetrics(): void {
    console.log(`\n📊 Solver Metrics:`);
    console.log(`   Processed: ${this.metrics.intentsProcessed}`);
    console.log(`   Executed: ${this.metrics.intentsExecuted}`);
    console.log(`   Skipped: ${this.metrics.intentsSkipped}`);
    console.log(`   Success Rate: ${this.metrics.intentsProcessed > 0 ? ((this.metrics.intentsExecuted / this.metrics.intentsProcessed) * 100).toFixed(2) : 0}%`);
    console.log(`   Total Gas: ${this.metrics.totalGasSpent}\n`);
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Stop the solver engine
   */
  stop(): void {
    console.log('\n🛑 Stopping solver engine...');
    this.printMetrics();
    console.log('✅ Solver stopped\n');
  }
}

// ===== Example Usage =====

async function main() {
  console.log('🚀 Intent Protocol Solver with DeepBook V3 Integration');
  console.log('='.repeat(60));
  
  // Configuration
  const config: SolverConfig = {
    rpcUrl: process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443',
    privateKey: process.env.SOLVER_PRIVATE_KEY!,
    packageId: process.env.PACKAGE_ID!,
    protocolConfigId: process.env.PROTOCOL_CONFIG_ID!,
    minProfitBps: Number(process.env.MIN_PROFIT_BPS || '50'), // 0.5%
    maxGasPrice: Number(process.env.MAX_GAS_PRICE || '1000000000'), // 1 SUI
    pollingIntervalMs: Number(process.env.POLLING_INTERVAL || '10000'), // 10 seconds
    enableEventSubscription: process.env.ENABLE_EVENTS !== 'false',
    // DeepBook V3 config
    balanceManagerId: process.env.BALANCE_MANAGER_ID,
    deepbookPackageId: process.env.DEEPBOOK_PACKAGE_ID,
  };

  // Validate required config
  if (!config.privateKey) {
    console.error('❌ SOLVER_PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  // Create solver
  const solver = new SolverEngine(config);

  // Log DeepBook V3 info
  console.log('\n📊 DeepBook V3 Configuration:');
  console.log(`   Package: ${config.deepbookPackageId || DEEPBOOK_PACKAGE_ID}`);
  console.log(`   Balance Manager: ${config.balanceManagerId || 'Will create on first trade'}`);
  console.log('\n📈 Registered Pools:');
  console.log('   - SUI/USDC');
  console.log('   - DEEP/SUI');
  console.log('   - DEEP/USDC');

  // Optionally register additional custom pools
  // solver.registerPool({
  //   poolId: '0x...',
  //   baseType: '0x...::token::TOKEN',
  //   quoteType: USDC_TYPE,
  //   tickSize: 1,
  //   lotSize: 1000000,
  //   baseScalar: 1e9,
  //   quoteScalar: 1e6,
  // });

  // Start solver
  await solver.start();

  // Handle shutdown gracefully
  process.on('SIGINT', () => {
    solver.stop();
    process.exit(0);
  });
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default SolverEngine;
