/**
 * Intent Protocol V2 - TypeScript SDK
 * 
 * This SDK provides type-safe interactions with the Intent Protocol smart contract on Sui.
 */

import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SuiClient } from '@mysten/sui.js/client';

// ===== Constants =====

export const STATUS_OPEN = 0;
export const STATUS_COMPLETED = 1;
export const STATUS_CANCELLED = 2;
export const STATUS_EXPIRED = 3;

export const MAX_FEE_BPS = 500; // 5%
export const BPS_DENOMINATOR = 10000;

// ===== Types =====

export interface ProtocolConfig {
  objectId: string;
  fee_bps: number;
  fee_recipient: string;
  paused: boolean;
}

export interface Intent {
  objectId: string;
  owner: string;
  input_amount: string;
  min_output_amount: string;
  deadline: string;
  status: number;
  solver?: string;
  input_type: string;
  output_type: string;
}

export interface IntentCreatedEvent {
  intent_id: string;
  owner: string;
  input_amount: string;
  min_output_amount: string;
  deadline: string;
  input_type: string;
  output_type: string;
}

export interface IntentExecutedEvent {
  intent_id: string;
  solver: string;
  input_amount: string;
  output_amount: string;
  fee_amount: string;
  execution_time: string;
}

export interface IntentCancelledEvent {
  intent_id: string;
  owner: string;
}

export interface IntentExpiredEvent {
  intent_id: string;
  owner: string;
  triggered_by: string;
  refund_amount: string;
}

// ===== SDK Class =====

export class IntentProtocolSDK {
  private client: SuiClient;
  private packageId: string;

  constructor(client: SuiClient, packageId: string) {
    this.client = client;
    this.packageId = packageId;
  }

  // ===== Intent Creation =====

  /**
   * Create a new intent
   * @param inputCoinId - Object ID of the input coin
   * @param inputCoinType - Full type of input coin (e.g., "0x2::sui::SUI")
   * @param outputCoinType - Full type of output coin
   * @param minOutputAmount - Minimum acceptable output amount (slippage protection)
   * @param deadlineMs - Deadline in milliseconds from now
   * @param clockId - Object ID of the Clock object (typically "0x6")
   * @returns TransactionBlock ready to be signed and executed
   */
  createIntent(
    inputCoinId: string,
    inputCoinType: string,
    outputCoinType: string,
    minOutputAmount: string,
    deadlineMs: string,
    clockId: string = '0x6'
  ): TransactionBlock {
    const tx = new TransactionBlock();

    tx.moveCall({
      target: `${this.packageId}::intent::create_intent`,
      typeArguments: [inputCoinType, outputCoinType],
      arguments: [
        tx.object(inputCoinId),
        tx.pure(minOutputAmount, 'u64'),
        tx.pure(deadlineMs, 'u64'),
        tx.object(clockId),
      ],
    });

    return tx;
  }

  /**
   * Create intent with multiple coins merged
   */
  createIntentWithMerge(
    inputCoinIds: string[],
    inputCoinType: string,
    outputCoinType: string,
    minOutputAmount: string,
    deadlineMs: string,
    clockId: string = '0x6'
  ): TransactionBlock {
    const tx = new TransactionBlock();

    // Merge all coins into the first one
    const [primaryCoin, ...restCoins] = inputCoinIds;
    if (restCoins.length > 0) {
      tx.mergeCoins(
        tx.object(primaryCoin),
        restCoins.map(id => tx.object(id))
      );
    }

    tx.moveCall({
      target: `${this.packageId}::intent::create_intent`,
      typeArguments: [inputCoinType, outputCoinType],
      arguments: [
        tx.object(primaryCoin),
        tx.pure(minOutputAmount, 'u64'),
        tx.pure(deadlineMs, 'u64'),
        tx.object(clockId),
      ],
    });

    return tx;
  }

  // ===== Intent Execution =====

  /**
   * Execute an intent as a solver
   * @param intentId - Object ID of the intent to execute
   * @param outputCoinId - Object ID of the output coin to provide
   * @param inputCoinType - Type of input asset
   * @param outputCoinType - Type of output asset
   * @param configId - Object ID of the ProtocolConfig
   * @param clockId - Object ID of the Clock object
   * @param sender - Address to receive the input coins
   * @returns TransactionBlock that receives the input balance
   */
  executeIntent(
    intentId: string,
    outputCoinId: string,
    inputCoinType: string,
    outputCoinType: string,
    configId: string,
    clockId: string = '0x6',
    sender: string
  ): TransactionBlock {
    const tx = new TransactionBlock();

    // Execute intent - returns Balance<InputAsset>
    const [inputBalance] = tx.moveCall({
      target: `${this.packageId}::intent::execute_intent`,
      typeArguments: [inputCoinType, outputCoinType],
      arguments: [
        tx.object(intentId),
        tx.object(outputCoinId),
        tx.object(configId),
        tx.object(clockId),
      ],
    });

    // Convert balance to coin
    const inputCoin = tx.moveCall({
      target: '0x2::coin::from_balance',
      typeArguments: [inputCoinType],
      arguments: [inputBalance],
    });

    // Transfer to solver (caller)
    tx.transferObjects([inputCoin], tx.pure.address(sender));

    return tx;
  }

  // ===== Intent Cancellation =====

  /**
   * Cancel an intent and reclaim funds
   */
  cancelIntent(
    intentId: string,
    inputCoinType: string,
    outputCoinType: string
  ): TransactionBlock {
    const tx = new TransactionBlock();

    tx.moveCall({
      target: `${this.packageId}::intent::cancel_intent_and_reclaim`,
      typeArguments: [inputCoinType, outputCoinType],
      arguments: [tx.object(intentId)],
    });

    return tx;
  }

  /**
   * Cancel intent with custom balance handling
   */
  cancelIntentCustom(
    intentId: string,
    inputCoinType: string,
    outputCoinType: string,
    sender: string
  ): TransactionBlock {
    const tx = new TransactionBlock();

    const [balance] = tx.moveCall({
      target: `${this.packageId}::intent::cancel_intent`,
      typeArguments: [inputCoinType, outputCoinType],
      arguments: [tx.object(intentId)],
    });

    // Convert balance to coin
    const coin = tx.moveCall({
      target: '0x2::coin::from_balance',
      typeArguments: [inputCoinType],
      arguments: [balance],
    });

    tx.transferObjects([coin], tx.pure.address(sender));

    return tx;
  }

  // ===== Expiry Cleanup =====

  /**
   * Clean up an expired intent (anyone can call)
   */
  cleanupExpired(
    intentId: string,
    inputCoinType: string,
    outputCoinType: string,
    clockId: string = '0x6'
  ): TransactionBlock {
    const tx = new TransactionBlock();

    tx.moveCall({
      target: `${this.packageId}::intent::cleanup_expired`,
      typeArguments: [inputCoinType, outputCoinType],
      arguments: [
        tx.object(intentId),
        tx.object(clockId),
      ],
    });

    return tx;
  }

  // ===== Intent Destruction =====

  /**
   * Destroy a terminal intent to clean up state
   */
  destroyIntent(
    intentId: string,
    inputCoinType: string,
    outputCoinType: string
  ): TransactionBlock {
    const tx = new TransactionBlock();

    tx.moveCall({
      target: `${this.packageId}::intent::destroy_intent`,
      typeArguments: [inputCoinType, outputCoinType],
      arguments: [tx.object(intentId)],
    });

    return tx;
  }

  // ===== Admin Functions =====

  /**
   * Set protocol fee (admin only)
   */
  setFee(
    adminCapId: string,
    configId: string,
    newFeeBps: number
  ): TransactionBlock {
    const tx = new TransactionBlock();

    tx.moveCall({
      target: `${this.packageId}::intent::set_fee`,
      arguments: [
        tx.object(adminCapId),
        tx.object(configId),
        tx.pure(newFeeBps, 'u64'),
      ],
    });

    return tx;
  }

  /**
   * Set fee recipient (admin only)
   */
  setFeeRecipient(
    adminCapId: string,
    configId: string,
    newRecipient: string
  ): TransactionBlock {
    const tx = new TransactionBlock();

    tx.moveCall({
      target: `${this.packageId}::intent::set_fee_recipient`,
      arguments: [
        tx.object(adminCapId),
        tx.object(configId),
        tx.pure.address(newRecipient),
      ],
    });

    return tx;
  }

  /**
   * Pause/unpause protocol (admin only)
   */
  setPaused(
    adminCapId: string,
    configId: string,
    paused: boolean
  ): TransactionBlock {
    const tx = new TransactionBlock();

    tx.moveCall({
      target: `${this.packageId}::intent::set_paused`,
      arguments: [
        tx.object(adminCapId),
        tx.object(configId),
        tx.pure.bool(paused),
      ],
    });

    return tx;
  }

  // ===== Query Functions =====

  /**
   * Get intent details
   */
  async getIntent(intentId: string): Promise<Intent | null> {
    try {
      const object = await this.client.getObject({
        id: intentId,
        options: {
          showContent: true,
          showType: true,
        },
      });

      if (!object.data || object.data.content?.dataType !== 'moveObject') {
        return null;
      }

      const fields = object.data.content.fields as any;
      const type = object.data.type as string;

      // Extract type parameters from the type string
      const typeMatch = type.match(/<(.+), (.+)>/);
      const inputType = typeMatch ? typeMatch[1] : '';
      const outputType = typeMatch ? typeMatch[2] : '';

      // input_balance can be serialised as a flat string (common for Balance<T>)
      // or as a nested object { fields: { value: "..." } } depending on RPC version.
      const rawBalance = typeof fields.input_balance === 'object'
        ? fields.input_balance?.fields?.value || '0'
        : String(fields.input_balance ?? '0');

      return {
        objectId: intentId,
        owner: fields.owner,
        input_amount: rawBalance,
        min_output_amount: fields.min_output_amount,
        deadline: fields.deadline,
        status: fields.status,
        solver: fields.solver?.fields?.vec?.[0],
        input_type: inputType,
        output_type: outputType,
      };
    } catch (error) {
      console.error('Error fetching intent:', error);
      return null;
    }
  }

  /**
   * Get protocol config
   */
  async getConfig(configId: string): Promise<ProtocolConfig | null> {
    try {
      const object = await this.client.getObject({
        id: configId,
        options: { showContent: true },
      });

      if (!object.data || object.data.content?.dataType !== 'moveObject') {
        return null;
      }

      const fields = object.data.content.fields as any;

      return {
        objectId: configId,
        fee_bps: Number(fields.fee_bps),
        fee_recipient: fields.fee_recipient,
        paused: fields.paused,
      };
    } catch (error) {
      console.error('Error fetching config:', error);
      return null;
    }
  }

  /**
   * Query IntentCreated events
   */
  async queryIntentCreatedEvents(
    limit: number = 50
  ): Promise<IntentCreatedEvent[]> {
    const events = await this.client.queryEvents({
      query: {
        MoveEventType: `${this.packageId}::intent::IntentCreated`,
      },
      order: 'descending',
      limit,
    });

    return events.data.map((event) => {
      const fields = event.parsedJson as any;
      return {
        intent_id: fields.intent_id,
        owner: fields.owner,
        input_amount: fields.input_amount,
        min_output_amount: fields.min_output_amount,
        deadline: fields.deadline,
        input_type: fields.input_type?.name || '',
        output_type: fields.output_type?.name || '',
      };
    });
  }

  /**
   * Query IntentExecuted events
   */
  async queryIntentExecutedEvents(
    limit: number = 50
  ): Promise<IntentExecutedEvent[]> {
    const events = await this.client.queryEvents({
      query: {
        MoveEventType: `${this.packageId}::intent::IntentExecuted`,
      },
      order: 'descending',
      limit,
    });

    return events.data.map((event) => {
      const fields = event.parsedJson as any;
      return {
        intent_id: fields.intent_id,
        solver: fields.solver,
        input_amount: fields.input_amount,
        output_amount: fields.output_amount,
        fee_amount: fields.fee_amount,
        execution_time: fields.execution_time,
      };
    });
  }

  /**
   * Subscribe to IntentCreated events
   */
  async subscribeToIntentCreated(
    callback: (event: IntentCreatedEvent) => void
  ): Promise<() => Promise<boolean>> {
    return this.client.subscribeEvent({
      filter: {
        MoveEventType: `${this.packageId}::intent::IntentCreated`,
      },
      onMessage: (event) => {
        const fields = event.parsedJson as any;
        callback({
          intent_id: fields.intent_id,
          owner: fields.owner,
          input_amount: fields.input_amount,
          min_output_amount: fields.min_output_amount,
          deadline: fields.deadline,
          input_type: fields.input_type?.name || '',
          output_type: fields.output_type?.name || '',
        });
      },
    });
  }

  /**
   * Subscribe to IntentExecuted events
   */
  async subscribeToIntentExecuted(
    callback: (event: IntentExecutedEvent) => void
  ): Promise<() => Promise<boolean>> {
    return this.client.subscribeEvent({
      filter: {
        MoveEventType: `${this.packageId}::intent::IntentExecuted`,
      },
      onMessage: (event) => {
        const fields = event.parsedJson as any;
        callback({
          intent_id: fields.intent_id,
          solver: fields.solver,
          input_amount: fields.input_amount,
          output_amount: fields.output_amount,
          fee_amount: fields.fee_amount,
          execution_time: fields.execution_time,
        });
      },
    });
  }

  // ===== Helper Functions =====

  /**
   * Check if an intent is expired
   */
  isIntentExpired(intent: Intent, currentTimeMs: number): boolean {
    return currentTimeMs > Number(intent.deadline);
  }

  /**
   * Check if an intent is in terminal state
   */
  isIntentTerminal(intent: Intent): boolean {
    return (
      intent.status === STATUS_COMPLETED ||
      intent.status === STATUS_CANCELLED ||
      intent.status === STATUS_EXPIRED
    );
  }

  /**
   * Calculate fee amount
   */
  calculateFee(amount: string, feeBps: number): string {
    const amountBN = BigInt(amount);
    const fee = (amountBN * BigInt(feeBps)) / BigInt(BPS_DENOMINATOR);
    return fee.toString();
  }

  /**
   * Calculate net amount after fee
   */
  calculateNetAmount(amount: string, feeBps: number): string {
    const amountBN = BigInt(amount);
    const fee = (amountBN * BigInt(feeBps)) / BigInt(BPS_DENOMINATOR);
    return (amountBN - fee).toString();
  }
}

// ===== Utility Functions =====

/**
 * Parse type parameters from Intent object type
 */
export function parseIntentTypes(objectType: string): {
  inputType: string;
  outputType: string;
} | null {
  const match = objectType.match(/<(.+), (.+)>/);
  if (!match) return null;

  return {
    inputType: match[1].trim(),
    outputType: match[2].trim(),
  };
}

/**
 * Format deadline to human readable
 */
export function formatDeadline(deadlineMs: string): string {
  const date = new Date(Number(deadlineMs));
  return date.toISOString();
}

/**
 * Get time remaining until deadline
 */
export function getTimeRemaining(deadlineMs: string): number {
  return Number(deadlineMs) - Date.now();
}

/**
 * Check if deadline is approaching (within threshold)
 */
export function isDeadlineApproaching(
  deadlineMs: string,
  thresholdMs: number = 60000 // 1 minute
): boolean {
  const remaining = getTimeRemaining(deadlineMs);
  return remaining > 0 && remaining <= thresholdMs;
}
