#[test_only]
module intent_protocol::intent_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::balance;
    use intent_protocol::intent::{Self, Intent, ProtocolConfig};

    // ==================== Test Coin Types ====================
    public struct USDC has drop {}
    public struct ETH has drop {}

    // ==================== Test Constants ====================
    const OWNER: address = @0xA;
    const SOLVER: address = @0xB;
    const OTHER_USER: address = @0xC;
    const ADMIN: address = @0x1;

    const INPUT_AMOUNT: u64 = 1000000000; // 1 SUI (9 decimals)
    const MIN_OUTPUT_AMOUNT: u64 = 95000000; // 95 USDC
    const TARGET_OUTPUT: u64 = 100000000; // 100 USDC
    const DEADLINE_MS: u64 = 3600000; // 1 hour

    // ==================== Helper Functions ====================
    
    fun setup_clock(scenario: &mut Scenario): Clock {
        ts::next_tx(scenario, OWNER);
        clock::create_for_testing(ts::ctx(scenario))
    }

    fun mint_sui(amount: u64, scenario: &mut Scenario): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ts::ctx(scenario))
    }

    fun mint_usdc(amount: u64, scenario: &mut Scenario): Coin<USDC> {
        coin::mint_for_testing<USDC>(amount, ts::ctx(scenario))
    }

    // ==================== Create Intent Tests ====================

    #[test]
    fun test_create_intent_success() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            
            assert!(intent::get_status(&intent) == intent::status_open(), 0);
            assert!(intent::get_input_amount(&intent) == INPUT_AMOUNT, 1);
            assert!(intent::get_min_output_amount(&intent) == MIN_OUTPUT_AMOUNT, 2);
            assert!(!intent::is_expired(&intent, &clock), 3);
            assert!(!intent::is_terminal(&intent), 4);
            
            ts::return_shared(intent);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::ESameAssetSwap)]
    fun test_create_intent_fails_same_asset() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            // SUI -> SUI swap should fail
            intent::create_intent<SUI, SUI>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::EZeroAmount)]
    fun test_create_intent_fails_zero_amount() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(0, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::EInvalidDeadline)]
    fun test_create_intent_fails_zero_deadline() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                0, // Zero deadline rejected in V2
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==================== Execute Intent Tests ====================

    #[test]
    fun test_execute_intent_success() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config(ts::ctx(&mut scenario));
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            assert!(intent::get_status(&intent) == intent::status_completed(), 0);
            assert!(intent::is_terminal(&intent), 1);
            assert!(intent::get_input_amount(&intent) == 0, 2);
            
            let input_coin = coin::from_balance(input_balance, ts::ctx(&mut scenario));
            assert!(coin::value(&input_coin) == INPUT_AMOUNT, 3);
            transfer::public_transfer(input_coin, SOLVER);
            
            ts::return_shared(intent);
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let received_coin = ts::take_from_sender<Coin<USDC>>(&scenario);
            assert!(coin::value(&received_coin) == TARGET_OUTPUT, 0);
            ts::return_to_sender(&scenario, received_coin);
        };

        ts::next_tx(&mut scenario, SOLVER);
        {
            let received_coin = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&received_coin) == INPUT_AMOUNT, 0);
            ts::return_to_sender(&scenario, received_coin);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::EInsufficientOutput)]
    fun test_execute_intent_fails_insufficient_output() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config(ts::ctx(&mut scenario));
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(MIN_OUTPUT_AMOUNT - 1, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            balance::destroy_for_testing(input_balance);
            ts::return_shared(intent);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::EIntentExpired)]
    fun test_execute_intent_fails_expired() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config(ts::ctx(&mut scenario));
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                1000, // 1 second
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        clock::increment_for_testing(&mut clock, 2000);

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            balance::destroy_for_testing(input_balance);
            ts::return_shared(intent);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::EInvalidStatus)]
    fun test_execute_intent_fails_already_executed() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config(ts::ctx(&mut scenario));
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            let input_coin = coin::from_balance(input_balance, ts::ctx(&mut scenario));
            transfer::public_transfer(input_coin, SOLVER);
            ts::return_shared(intent);
        };

        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            balance::destroy_for_testing(input_balance);
            ts::return_shared(intent);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==================== Cancel Intent Tests ====================

    #[test]
    fun test_cancel_intent_success() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            
            intent::cancel_intent_and_reclaim(&mut intent, ts::ctx(&mut scenario));
            
            assert!(intent::get_status(&intent) == intent::status_cancelled(), 0);
            assert!(intent::is_terminal(&intent), 1);
            assert!(intent::get_input_amount(&intent) == 0, 2);
            
            ts::return_shared(intent);
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let returned_coin = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&returned_coin) == INPUT_AMOUNT, 0);
            ts::return_to_sender(&scenario, returned_coin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::EInvalidOwner)]
    fun test_cancel_intent_fails_not_owner() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            intent::cancel_intent_and_reclaim(&mut intent, ts::ctx(&mut scenario));
            ts::return_shared(intent);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==================== Expiry Cleanup Tests ====================

    #[test]
    fun test_cleanup_expired_by_anyone() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                1000,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        clock::increment_for_testing(&mut clock, 2000);

        // ANY user can cleanup expired intent
        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            
            intent::cleanup_expired(&mut intent, &clock, ts::ctx(&mut scenario));
            
            assert!(intent::get_status(&intent) == intent::status_expired(), 0);
            assert!(intent::is_terminal(&intent), 1);
            
            ts::return_shared(intent);
        };

        // Verify OWNER (not cleanup caller) received funds
        ts::next_tx(&mut scenario, OWNER);
        {
            let returned_coin = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&returned_coin) == INPUT_AMOUNT, 0);
            ts::return_to_sender(&scenario, returned_coin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::EIntentNotExpired)]
    fun test_cleanup_fails_not_expired() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            intent::cleanup_expired(&mut intent, &clock, ts::ctx(&mut scenario));
            ts::return_shared(intent);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==================== Destroy Intent Tests ====================

    #[test]
    fun test_destroy_completed_intent() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config(ts::ctx(&mut scenario));
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            let input_coin = coin::from_balance(input_balance, ts::ctx(&mut scenario));
            transfer::public_transfer(input_coin, SOLVER);
            ts::return_shared(intent);
        };

        // Destroy to cleanup state
        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            intent::destroy_intent(intent);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_destroy_cancelled_intent() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            intent::cancel_intent_and_reclaim(&mut intent, ts::ctx(&mut scenario));
            ts::return_shared(intent);
        };

        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            intent::destroy_intent(intent);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==================== Protocol Fee Tests ====================

    #[test]
    fun test_execute_with_protocol_fee() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        // Create config with 1% fee (100 bps)
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config_with_fee(100, ADMIN, ts::ctx(&mut scenario));
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            // Solver gets input minus 1% fee
            let expected_solver_amount = INPUT_AMOUNT - (INPUT_AMOUNT / 100);
            assert!(balance::value(&input_balance) == expected_solver_amount, 0);
            
            let input_coin = coin::from_balance(input_balance, ts::ctx(&mut scenario));
            transfer::public_transfer(input_coin, SOLVER);
            ts::return_shared(intent);
        };

        // Verify fee recipient got the fee
        ts::next_tx(&mut scenario, ADMIN);
        {
            let fee_coin = ts::take_from_sender<Coin<SUI>>(&scenario);
            let expected_fee = INPUT_AMOUNT / 100;
            assert!(coin::value(&fee_coin) == expected_fee, 0);
            ts::return_to_sender(&scenario, fee_coin);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==================== Different Asset Types Tests ====================

    #[test]
    fun test_create_intent_different_asset_types() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = coin::mint_for_testing<ETH>(INPUT_AMOUNT, ts::ctx(&mut scenario));
            intent::create_intent<ETH, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let intent = ts::take_shared<Intent<ETH, USDC>>(&scenario);
            assert!(intent::get_status(&intent) == intent::status_open(), 0);
            assert!(intent::get_input_amount(&intent) == INPUT_AMOUNT, 1);
            ts::return_shared(intent);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_execute_intent_different_asset_types() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config(ts::ctx(&mut scenario));
        
        // Create ETH -> SUI intent
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = coin::mint_for_testing<ETH>(INPUT_AMOUNT, ts::ctx(&mut scenario));
            intent::create_intent<ETH, SUI>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<ETH, SUI>>(&scenario);
            let output_coin = mint_sui(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            assert!(intent::get_status(&intent) == intent::status_completed(), 0);
            
            let input_coin = coin::from_balance(input_balance, ts::ctx(&mut scenario));
            transfer::public_transfer(input_coin, SOLVER);
            ts::return_shared(intent);
        };

        // Verify owner got SUI
        ts::next_tx(&mut scenario, OWNER);
        {
            let received_coin = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&received_coin) == TARGET_OUTPUT, 0);
            ts::return_to_sender(&scenario, received_coin);
        };

        // Verify solver got ETH
        ts::next_tx(&mut scenario, SOLVER);
        {
            let received_coin = ts::take_from_sender<Coin<ETH>>(&scenario);
            assert!(coin::value(&received_coin) == INPUT_AMOUNT, 0);
            ts::return_to_sender(&scenario, received_coin);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==================== View Function Tests ====================

    #[test]
    fun test_is_expired_before_deadline() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            
            assert!(!intent::is_expired(&intent, &clock), 0);
            
            clock::increment_for_testing(&mut clock, DEADLINE_MS / 2);
            assert!(!intent::is_expired(&intent, &clock), 1);
            
            ts::return_shared(intent);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_is_expired_after_deadline() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        clock::increment_for_testing(&mut clock, DEADLINE_MS + 1);

        ts::next_tx(&mut scenario, OWNER);
        {
            let intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            assert!(intent::is_expired(&intent, &clock), 0);
            ts::return_shared(intent);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==================== Edge Case Tests ====================

    #[test]
    fun test_execute_at_exact_deadline() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config(ts::ctx(&mut scenario));
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        clock::increment_for_testing(&mut clock, DEADLINE_MS);

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            assert!(intent::get_status(&intent) == intent::status_completed(), 0);
            
            let input_coin = coin::from_balance(input_balance, ts::ctx(&mut scenario));
            transfer::public_transfer(input_coin, SOLVER);
            ts::return_shared(intent);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = intent::EInvalidStatus)]
    fun test_execute_cancelled_intent_fails() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup_clock(&mut scenario);
        
        ts::next_tx(&mut scenario, ADMIN);
        let config = intent::test_create_config(ts::ctx(&mut scenario));
        
        ts::next_tx(&mut scenario, OWNER);
        {
            let input_coin = mint_sui(INPUT_AMOUNT, &mut scenario);
            intent::create_intent<SUI, USDC>(
                input_coin,
                MIN_OUTPUT_AMOUNT,
                DEADLINE_MS,
                &clock,
                ts::ctx(&mut scenario)
            );
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            intent::cancel_intent_and_reclaim(&mut intent, ts::ctx(&mut scenario));
            ts::return_shared(intent);
        };

        ts::next_tx(&mut scenario, SOLVER);
        {
            let mut intent = ts::take_shared<Intent<SUI, USDC>>(&scenario);
            let output_coin = mint_usdc(TARGET_OUTPUT, &mut scenario);
            
            let input_balance = intent::execute_intent(
                &mut intent,
                output_coin,
                &config,
                &clock,
                ts::ctx(&mut scenario)
            );
            
            balance::destroy_for_testing(input_balance);
            ts::return_shared(intent);
        };

        intent::test_destroy_config(config);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
