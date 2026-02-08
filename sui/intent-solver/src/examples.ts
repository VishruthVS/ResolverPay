/**
 * Intent Protocol - Usage Examples
 * 
 * Complete examples showing how to use the Intent Protocol SDK
 */

import 'dotenv/config';
import { SuiClient } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { IntentProtocolSDK } from './intent-protocol-sdk';
import SolverEngine from './solver-engine';

// ===== Configuration =====

const PACKAGE_ID = process.env.PACKAGE_ID || '0x...';
const PROTOCOL_CONFIG_ID = process.env.PROTOCOL_CONFIG_ID || '0x...';
const RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';

const SUI_TYPE = process.env.SUI_TYPE || '0x2::sui::SUI';
const USDC_TYPE = process.env.USDC_TYPE || '0x2::sui::SUI'; // Fallback to SUI for testing
const USDT_TYPE = process.env.USDT_TYPE || '0x2::sui::SUI'; // Fallback to SUI for testing

// ===== Example 1: Create an Intent (User) =====

async function example1_createIntent() {
  console.log('\n=== Example 1: Create Intent ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);
  
  const keypair = Ed25519Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(process.env.USER_PRIVATE_KEY!, 'hex'))
  );
  const address = keypair.getPublicKey().toSuiAddress();

  // Scenario: User wants to swap 1000 SUI for at least 2000 USDC
  // Deadline: 1 hour from now
  
  // Fetch a SUI coin from the user's wallet
  const coins = await client.getCoins({ owner: address, coinType: SUI_TYPE });
  if (coins.data.length === 0) {
    console.log('❌ No SUI coins found in wallet. Please fund the address:', address);
    return;
  }
  const inputCoinId = coins.data[0].coinObjectId;
  console.log('📍 User address:', address);
  console.log('💰 Using coin:', inputCoinId, `(${coins.data[0].balance} MIST)`);
  
  const minOutputAmount = '2000000000'; // 2000 USDC (assuming 6 decimals)
  const deadlineMs = (60 * 60 * 1000).toString(); // 1 hour

  const tx = sdk.createIntent(
    inputCoinId,
    SUI_TYPE,
    USDC_TYPE,
    minOutputAmount,
    deadlineMs
  );

  const result = await client.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    signer: keypair,
    options: {
      showEffects: true,
      showEvents: true,
    },
  });

  console.log('✅ Intent created!');
  console.log('Transaction:', result.digest);
  
  // Extract intent ID from events
  const intentCreatedEvent = result.events?.find(
    e => e.type.includes('IntentCreated')
  );
  
  if (intentCreatedEvent) {
    const intentId = (intentCreatedEvent.parsedJson as any).intent_id;
    console.log('Intent ID:', intentId);
  }
}

// ===== Example 2: Create Intent with Multiple Coins =====

async function example2_createIntentWithMultipleCoins() {
  console.log('\n=== Example 2: Create Intent with Multiple Coins ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);
  
  const keypair = Ed25519Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(process.env.USER_PRIVATE_KEY!, 'hex'))
  );

  // User has multiple small SUI coins that need to be merged
  const inputCoinIds = [
    '0x...coin1',
    '0x...coin2',
    '0x...coin3',
  ];

  const tx = sdk.createIntentWithMerge(
    inputCoinIds,
    SUI_TYPE,
    USDC_TYPE,
    '1000000000', // 1000 USDC
    (30 * 60 * 1000).toString() // 30 minutes
  );

  const result = await client.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  console.log('✅ Intent created with merged coins!');
  console.log('Transaction:', result.digest);
}

// ===== Example 3: Query Open Intents =====

async function example3_queryOpenIntents() {
  console.log('\n=== Example 3: Query Open Intents ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);

  // Get recent IntentCreated events
  const events = await sdk.queryIntentCreatedEvents(20);

  console.log(`Found ${events.length} intent events\n`);

  for (const event of events) {
    // Check if still open
    const intent = await sdk.getIntent(event.intent_id);
    
    if (intent && intent.status === 0) { // STATUS_OPEN
      console.log(`📋 Intent ${event.intent_id.slice(0, 8)}...`);
      console.log(`   Owner: ${intent.owner}`);
      console.log(`   Input: ${intent.input_amount}`);
      console.log(`   Min Output: ${intent.min_output_amount}`);
      console.log(`   Deadline: ${new Date(Number(intent.deadline)).toISOString()}`);
      console.log(`   Types: ${intent.input_type} -> ${intent.output_type}`);
      console.log('');
    }
  }
}

// ===== Example 4: Execute Intent (Solver) =====

async function example4_executeIntent() {
  console.log('\n=== Example 4: Execute Intent ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);
  
  const keypair = Ed25519Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(process.env.SOLVER_PRIVATE_KEY!, 'hex'))
  );

  const intentId = '0x...'; // Intent to execute
  const outputCoinId = '0x...'; // Solver's USDC coin to fulfill intent
  const solverAddress = keypair.getPublicKey().toSuiAddress();

  // Execute the intent
  const tx = sdk.executeIntent(
    intentId,
    outputCoinId,
    SUI_TYPE,
    USDC_TYPE,
    PROTOCOL_CONFIG_ID,
    '0x6', // clock
    solverAddress
  );

  const result = await client.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    signer: keypair,
    options: {
      showEffects: true,
      showEvents: true,
    },
  });

  console.log('✅ Intent executed!');
  console.log('Transaction:', result.digest);
  
  // Check events for execution details
  const executedEvent = result.events?.find(
    e => e.type.includes('IntentExecuted')
  );
  
  if (executedEvent) {
    const data = executedEvent.parsedJson as any;
    console.log('Solver:', data.solver);
    console.log('Input Amount:', data.input_amount);
    console.log('Output Amount:', data.output_amount);
    console.log('Fee Amount:', data.fee_amount);
  }
}

// ===== Example 5: Cancel Intent =====

async function example5_cancelIntent() {
  console.log('\n=== Example 5: Cancel Intent ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);
  
  const keypair = Ed25519Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(process.env.USER_PRIVATE_KEY!, 'hex'))
  );

  const intentId = '0x...'; // Intent to cancel

  // Cancel and reclaim funds
  const tx = sdk.cancelIntent(intentId, SUI_TYPE, USDC_TYPE);

  const result = await client.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  console.log('✅ Intent cancelled and funds reclaimed!');
  console.log('Transaction:', result.digest);
}

// ===== Example 6: Cleanup Expired Intent =====

async function example6_cleanupExpired() {
  console.log('\n=== Example 6: Cleanup Expired Intent ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);
  
  const keypair = Ed25519Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(process.env.ANY_PRIVATE_KEY!, 'hex'))
  );

  const intentId = '0x...'; // Expired intent

  // Anyone can cleanup expired intents
  const tx = sdk.cleanupExpired(intentId, SUI_TYPE, USDC_TYPE);

  const result = await client.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  console.log('✅ Expired intent cleaned up!');
  console.log('Transaction:', result.digest);
  console.log('(Funds returned to original owner)');
}

// ===== Example 7: Monitor Intent Events =====

async function example7_monitorEvents() {
  console.log('\n=== Example 7: Monitor Intent Events ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);

  console.log('👂 Listening for events...\n');

  // Subscribe to IntentCreated events
  await sdk.subscribeToIntentCreated((event) => {
    console.log('📬 New Intent Created:');
    console.log('   ID:', event.intent_id);
    console.log('   Owner:', event.owner);
    console.log('   Input:', event.input_amount);
    console.log('   Min Output:', event.min_output_amount);
    console.log('');
  });

  // Subscribe to IntentExecuted events
  await sdk.subscribeToIntentExecuted((event) => {
    console.log('✅ Intent Executed:');
    console.log('   ID:', event.intent_id);
    console.log('   Solver:', event.solver);
    console.log('   Output:', event.output_amount);
    console.log('   Fee:', event.fee_amount);
    console.log('');
  });

  // Keep running
  await new Promise(() => {});
}

// ===== Example 8: Admin Functions =====

async function example8_adminFunctions() {
  console.log('\n=== Example 8: Admin Functions ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);
  
  const keypair = Ed25519Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(process.env.ADMIN_PRIVATE_KEY!, 'hex'))
  );

  const adminCapId = '0x...'; // AdminCap object ID

  // Set protocol fee to 0.5% (50 basis points)
  const setFeeTx = sdk.setFee(adminCapId, PROTOCOL_CONFIG_ID, 50);
  
  await client.signAndExecuteTransactionBlock({
    transactionBlock: setFeeTx,
    signer: keypair,
  });

  console.log('✅ Protocol fee updated to 0.5%');

  // Update fee recipient
  const newRecipient = '0x...';
  const setRecipientTx = sdk.setFeeRecipient(
    adminCapId,
    PROTOCOL_CONFIG_ID,
    newRecipient
  );

  await client.signAndExecuteTransactionBlock({
    transactionBlock: setRecipientTx,
    signer: keypair,
  });

  console.log('✅ Fee recipient updated');

  // Pause protocol
  const pauseTx = sdk.setPaused(adminCapId, PROTOCOL_CONFIG_ID, true);
  
  await client.signAndExecuteTransactionBlock({
    transactionBlock: pauseTx,
    signer: keypair,
  });

  console.log('✅ Protocol paused');
}

// ===== Example 9: Run Solver Engine =====

async function example9_runSolver() {
  console.log('\n=== Example 9: Run Solver Engine ===\n');

  const solver = new SolverEngine({
    rpcUrl: RPC_URL,
    privateKey: process.env.SOLVER_PRIVATE_KEY!,
    packageId: PACKAGE_ID,
    protocolConfigId: PROTOCOL_CONFIG_ID,
    minProfitBps: 50, // 0.5% minimum profit
    maxGasPrice: 1_000_000_000, // 1 SUI
    pollingIntervalMs: 10_000, // 10 seconds
    enableEventSubscription: true,
  });

  // Register trading pools
  solver.registerPool({
    poolId: '0x...', // SUI/USDC pool
    baseType: SUI_TYPE,
    quoteType: USDC_TYPE,
    tickSize: 1,
    lotSize: 1000000,
    baseScalar: 1e9,
    quoteScalar: 1e6,
  });

  solver.registerPool({
    poolId: '0x...', // USDC/USDT pool
    baseType: USDC_TYPE,
    quoteType: USDT_TYPE,
    tickSize: 1,
    lotSize: 1000000,
    baseScalar: 1e6,
    quoteScalar: 1e6,
  });

  // Start solver
  await solver.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    solver.stop();
    process.exit(0);
  });
}

// ===== Example 10: Complete User Flow =====

async function example10_completeUserFlow() {
  console.log('\n=== Example 10: Complete User Flow ===\n');

  const client = new SuiClient({ url: RPC_URL });
  const sdk = new IntentProtocolSDK(client, PACKAGE_ID);
  
  const keypair = Ed25519Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(process.env.USER_PRIVATE_KEY!, 'hex'))
  );

  // Step 1: Create intent
  console.log('Step 1: Creating intent...');
  
  const tx1 = sdk.createIntent(
    '0x...coin',
    SUI_TYPE,
    USDC_TYPE,
    '1000000000',
    (60 * 60 * 1000).toString()
  );

  const result1 = await client.signAndExecuteTransactionBlock({
    transactionBlock: tx1,
    signer: keypair,
    options: { showEffects: true, showEvents: true },
  });

  const intentEvent = result1.events?.find(e => e.type.includes('IntentCreated'));
  const intentId = (intentEvent?.parsedJson as any)?.intent_id;

  console.log(`✅ Intent created: ${intentId}\n`);

  // Step 2: Monitor intent status
  console.log('Step 2: Monitoring intent...');
  
  let checkCount = 0;
  const checkInterval = setInterval(async () => {
    const intent = await sdk.getIntent(intentId);
    
    if (!intent) {
      console.log('Intent not found');
      clearInterval(checkInterval);
      return;
    }

    console.log(`Status: ${intent.status} (0=OPEN, 1=COMPLETED, 2=CANCELLED, 3=EXPIRED)`);

    if (intent.status !== 0) {
      console.log('\n✅ Intent finalized!');
      clearInterval(checkInterval);
      
      if (intent.status === 1) {
        console.log(`Executed by solver: ${intent.solver}`);
      }
    }

    checkCount++;
    if (checkCount > 60) { // 10 minutes max
      clearInterval(checkInterval);
      
      // Cancel if still open
      if (intent.status === 0) {
        console.log('\nStep 3: Cancelling intent...');
        const cancelTx = sdk.cancelIntent(intentId, SUI_TYPE, USDC_TYPE);
        await client.signAndExecuteTransactionBlock({
          transactionBlock: cancelTx,
          signer: keypair,
        });
        console.log('✅ Intent cancelled');
      }
    }
  }, 10_000);
}

// ===== Main Runner =====

async function main() {
  const examples = {
    '1': example1_createIntent,
    '2': example2_createIntentWithMultipleCoins,
    '3': example3_queryOpenIntents,
    '4': example4_executeIntent,
    '5': example5_cancelIntent,
    '6': example6_cleanupExpired,
    '7': example7_monitorEvents,
    '8': example8_adminFunctions,
    '9': example9_runSolver,
    '10': example10_completeUserFlow,
  };

  const exampleNum = process.argv[2] || '1';
  const exampleFn = examples[exampleNum as keyof typeof examples];

  if (!exampleFn) {
    console.log('Available examples:');
    console.log('  1: Create Intent');
    console.log('  2: Create Intent with Multiple Coins');
    console.log('  3: Query Open Intents');
    console.log('  4: Execute Intent (Solver)');
    console.log('  5: Cancel Intent');
    console.log('  6: Cleanup Expired Intent');
    console.log('  7: Monitor Events');
    console.log('  8: Admin Functions');
    console.log('  9: Run Solver Engine');
    console.log('  10: Complete User Flow');
    console.log('\nUsage: ts-node examples.ts <number>');
    return;
  }

  await exampleFn();
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
