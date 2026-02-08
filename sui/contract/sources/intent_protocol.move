module intent_protocol::intent {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::type_name::{Self, TypeName};

    const EInvalidStatus: u64 = 0;
    const EInvalidOwner: u64 = 1;
    const EInsufficientOutput: u64 = 2;
    const EIntentExpired: u64 = 3;
    const ESameAssetSwap: u64 = 4;
    const EIntentNotExpired: u64 = 5;
    const EIntentNotTerminal: u64 = 6;
    const EZeroAmount: u64 = 7;
    const EInvalidDeadline: u64 = 8;
    const EInvalidFee: u64 = 9;

    const STATUS_OPEN: u8 = 0;
    const STATUS_COMPLETED: u8 = 1;
    const STATUS_CANCELLED: u8 = 2;
    const STATUS_EXPIRED: u8 = 3;

    const MAX_FEE_BPS: u64 = 500; // Max 5% fee
    const BPS_DENOMINATOR: u64 = 10000;

    public struct ProtocolConfig has key {
        id: UID,
        fee_bps: u64, // Fee in basis points (100 = 1%)
        fee_recipient: address,
        paused: bool,
    }

    public struct AdminCap has key, store {
        id: UID,
    }

    public struct Intent<phantom InputAsset, phantom OutputAsset> has key, store {
        id: UID,
        owner: address,
        input_balance: Balance<InputAsset>,
        min_output_amount: u64, // Slippage protection - enforced
        deadline: u64, // Unix timestamp ms for expiry
        status: u8,
        solver: Option<address>, // Solver who executed (if completed)
        input_type: TypeName,
        output_type: TypeName,
    }

    public struct IntentCreated has copy, drop {
        intent_id: ID,
        owner: address,
        input_amount: u64,
        min_output_amount: u64,
        deadline: u64,
        input_type: TypeName,
        output_type: TypeName,
    }

    public struct IntentExecuted has copy, drop {
        intent_id: ID,
        solver: address,
        input_amount: u64,
        output_amount: u64,
        fee_amount: u64,
        execution_time: u64,
    }

    public struct IntentCancelled has copy, drop {
        intent_id: ID,
        owner: address,
    }

    public struct IntentExpired has copy, drop {
        intent_id: ID,
        owner: address,
        triggered_by: address,
        refund_amount: u64,
    }

    public struct IntentDestroyed has copy, drop {
        intent_id: ID,
    }

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        
        let config = ProtocolConfig {
            id: object::new(ctx),
            fee_bps: 0, // No fee by default
            fee_recipient: ctx.sender(),
            paused: false,
        };

        transfer::transfer(admin_cap, ctx.sender());
        transfer::share_object(config);
    }

    public fun set_fee(
        _: &AdminCap,
        config: &mut ProtocolConfig,
        new_fee_bps: u64,
    ) {
        assert!(new_fee_bps <= MAX_FEE_BPS, EInvalidFee);
        config.fee_bps = new_fee_bps;
    }

    public fun set_fee_recipient(
        _: &AdminCap,
        config: &mut ProtocolConfig,
        new_recipient: address,
    ) {
        config.fee_recipient = new_recipient;
    }

    public fun set_paused(
        _: &AdminCap,
        config: &mut ProtocolConfig,
        paused: bool,
    ) {
        config.paused = paused;
    }

    #[allow(deprecated_usage)]
    public fun create_intent<InputAsset, OutputAsset>(
        input_coin: Coin<InputAsset>,
        min_output_amount: u64,
        deadline_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let input_type = type_name::get<InputAsset>();
        let output_type = type_name::get<OutputAsset>();
        
        assert!(input_type != output_type, ESameAssetSwap);
        
        let input_amount = coin::value(&input_coin);
        assert!(input_amount > 0, EZeroAmount);
        assert!(deadline_ms > 0, EInvalidDeadline);
        
        let deadline = clock::timestamp_ms(clock) + deadline_ms;
        
        let input_balance = coin::into_balance(input_coin);
        let intent_id = object::new(ctx);
        let id_copy = object::uid_to_inner(&intent_id);

        let intent = Intent<InputAsset, OutputAsset> {
            id: intent_id,
            owner: ctx.sender(),
            input_balance,
            min_output_amount,
            deadline,
            status: STATUS_OPEN,
            solver: option::none(),
            input_type,
            output_type,
        };

        event::emit(IntentCreated {
            intent_id: id_copy,
            owner: ctx.sender(),
            input_amount,
            min_output_amount,
            deadline,
            input_type,
            output_type,
        });

        transfer::share_object(intent);
    }

    public fun execute_intent<InputAsset, OutputAsset>(
        intent: &mut Intent<InputAsset, OutputAsset>,
        output_coin: Coin<OutputAsset>,
        config: &ProtocolConfig,
        clock: &Clock,
        ctx: &mut TxContext
    ): Balance<InputAsset> {
        assert!(intent.status == STATUS_OPEN, EInvalidStatus);
        assert!(clock::timestamp_ms(clock) <= intent.deadline, EIntentExpired);
        
        let output_amount = coin::value(&output_coin);
        assert!(output_amount >= intent.min_output_amount, EInsufficientOutput);

        let solver_address = ctx.sender();
        let input_amount = balance::value(&intent.input_balance);
        
        let fee_amount = (input_amount * config.fee_bps) / BPS_DENOMINATOR;
        
        let mut input_balance = balance::withdraw_all(&mut intent.input_balance);
        
        if (fee_amount > 0) {
            let fee_balance = balance::split(&mut input_balance, fee_amount);
            let fee_coin = coin::from_balance(fee_balance, ctx);
            transfer::public_transfer(fee_coin, config.fee_recipient);
        };

        intent.status = STATUS_COMPLETED;
        intent.solver = option::some(solver_address);

        event::emit(IntentExecuted {
            intent_id: object::uid_to_inner(&intent.id),
            solver: solver_address,
            input_amount,
            output_amount,
            fee_amount,
            execution_time: clock::timestamp_ms(clock),
        });

        transfer::public_transfer(output_coin, intent.owner);

        input_balance
    }

    public fun cancel_intent<InputAsset, OutputAsset>(
        intent: &mut Intent<InputAsset, OutputAsset>,
        ctx: &mut TxContext
    ): Balance<InputAsset> {
        assert!(intent.owner == ctx.sender(), EInvalidOwner);
        assert!(intent.status == STATUS_OPEN, EInvalidStatus);

        intent.status = STATUS_CANCELLED;

        event::emit(IntentCancelled {
            intent_id: object::uid_to_inner(&intent.id),
            owner: intent.owner,
        });

        balance::withdraw_all(&mut intent.input_balance)
    }

    #[allow(lint(self_transfer))]
    public fun cancel_intent_and_reclaim<InputAsset, OutputAsset>(
        intent: &mut Intent<InputAsset, OutputAsset>,
        ctx: &mut TxContext
    ) {
        let balance = cancel_intent(intent, ctx);
        let coin = coin::from_balance(balance, ctx);
        transfer::public_transfer(coin, ctx.sender());
    }

    public fun cleanup_expired<InputAsset, OutputAsset>(
        intent: &mut Intent<InputAsset, OutputAsset>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(intent.status == STATUS_OPEN, EInvalidStatus);
        assert!(clock::timestamp_ms(clock) > intent.deadline, EIntentNotExpired);

        let refund_amount = balance::value(&intent.input_balance);
        intent.status = STATUS_EXPIRED;

        event::emit(IntentExpired {
            intent_id: object::uid_to_inner(&intent.id),
            owner: intent.owner,
            triggered_by: ctx.sender(),
            refund_amount,
        });

        let refund_balance = balance::withdraw_all(&mut intent.input_balance);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, intent.owner);
    }

    public fun destroy_intent<InputAsset, OutputAsset>(
        intent: Intent<InputAsset, OutputAsset>,
    ) {
        let Intent {
            id,
            owner: _,
            input_balance,
            min_output_amount: _,
            deadline: _,
            status,
            solver: _,
            input_type: _,
            output_type: _,
        } = intent;

        assert!(
            status == STATUS_COMPLETED || 
            status == STATUS_CANCELLED || 
            status == STATUS_EXPIRED,
            EIntentNotTerminal
        );

        balance::destroy_zero(input_balance);
        
        event::emit(IntentDestroyed {
            intent_id: object::uid_to_inner(&id),
        });
        
        object::delete(id);
    }

    public fun get_status<InputAsset, OutputAsset>(
        intent: &Intent<InputAsset, OutputAsset>
    ): u8 {
        intent.status
    }

    public fun get_input_amount<InputAsset, OutputAsset>(
        intent: &Intent<InputAsset, OutputAsset>
    ): u64 {
        balance::value(&intent.input_balance)
    }

    public fun get_min_output_amount<InputAsset, OutputAsset>(
        intent: &Intent<InputAsset, OutputAsset>
    ): u64 {
        intent.min_output_amount
    }

    public fun get_deadline<InputAsset, OutputAsset>(
        intent: &Intent<InputAsset, OutputAsset>
    ): u64 {
        intent.deadline
    }

    public fun get_owner<InputAsset, OutputAsset>(
        intent: &Intent<InputAsset, OutputAsset>
    ): address {
        intent.owner
    }

    public fun is_expired<InputAsset, OutputAsset>(
        intent: &Intent<InputAsset, OutputAsset>,
        clock: &Clock
    ): bool {
        clock::timestamp_ms(clock) > intent.deadline
    }

    public fun is_terminal<InputAsset, OutputAsset>(
        intent: &Intent<InputAsset, OutputAsset>
    ): bool {
        intent.status == STATUS_COMPLETED || 
        intent.status == STATUS_CANCELLED || 
        intent.status == STATUS_EXPIRED
    }

    public fun status_open(): u8 { STATUS_OPEN }
    public fun status_completed(): u8 { STATUS_COMPLETED }
    public fun status_cancelled(): u8 { STATUS_CANCELLED }
    public fun status_expired(): u8 { STATUS_EXPIRED }

    #[test_only]
    public fun test_create_config(ctx: &mut TxContext): ProtocolConfig {
        ProtocolConfig {
            id: object::new(ctx),
            fee_bps: 0,
            fee_recipient: ctx.sender(),
            paused: false,
        }
    }

    #[test_only]
    public fun test_create_config_with_fee(
        fee_bps: u64,
        fee_recipient: address,
        ctx: &mut TxContext
    ): ProtocolConfig {
        ProtocolConfig {
            id: object::new(ctx),
            fee_bps,
            fee_recipient,
            paused: false,
        }
    }

    #[test_only]
    public fun test_destroy_config(config: ProtocolConfig) {
        let ProtocolConfig { id, fee_bps: _, fee_recipient: _, paused: _ } = config;
        object::delete(id);
    }
}