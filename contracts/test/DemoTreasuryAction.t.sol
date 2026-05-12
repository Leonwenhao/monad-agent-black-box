// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DemoTreasuryAction} from "../src/DemoTreasuryAction.sol";
import {TraceRegistry} from "../src/TraceRegistry.sol";

interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory entries);
}

contract RunnerWallet {
    function execute(
        DemoTreasuryAction action,
        bytes32 sessionId,
        uint8 actionType,
        uint256 amount,
        string calldata memo
    ) external {
        action.executeAction(sessionId, actionType, amount, memo);
    }
}

contract DemoTreasuryActionTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    DemoTreasuryAction private action;
    TraceRegistry private registry;
    RunnerWallet private runnerWallet;

    bytes32 private constant SESSION_ID = keccak256("session-1");
    bytes32 private constant GOAL_HASH = keccak256("goal");
    bytes32 private constant TX_HASH = keccak256("demo-action-tx");

    function setUp() public {
        action = new DemoTreasuryAction();
        registry = new TraceRegistry();
        runnerWallet = new RunnerWallet();
    }

    function testExecuteActionEmitsDemoActionExecuted() public {
        vm.recordLogs();

        action.executeAction(SESSION_ID, 2, 1_000 ether, "rebalance demo treasury safely");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        require(logs.length == 1, "log count");
        require(logs[0].emitter == address(action), "emitter");
        require(logs[0].topics[0] == DemoTreasuryAction.DemoActionExecuted.selector, "event selector");
        require(logs[0].topics[1] == SESSION_ID, "session topic");
        require(address(uint160(uint256(logs[0].topics[2]))) == address(this), "caller topic");

        (uint8 actionType, uint256 amount, string memory memo) = abi.decode(logs[0].data, (uint8, uint256, string));
        require(actionType == 2, "action type");
        require(amount == 1_000 ether, "amount");
        require(keccak256(bytes(memo)) == keccak256(bytes("rebalance demo treasury safely")), "memo");
    }

    function testActionStoresSessionIdCallerTypeAmountAndMemo() public {
        action.executeAction(SESSION_ID, 1, 42, "safe demo action");

        (address caller, uint8 actionType, uint256 amount, string memory memo, uint64 executedAt) =
            action.lastActionBySession(SESSION_ID);

        require(caller == address(this), "caller");
        require(actionType == 1, "action type");
        require(amount == 42, "amount");
        require(keccak256(bytes(memo)) == keccak256(bytes("safe demo action")), "memo");
        require(executedAt > 0, "executedAt");
    }

    function testRunnerWalletCanCallActionWithoutSpecialSetup() public {
        runnerWallet.execute(action, SESSION_ID, 3, 777, "runner wallet action");

        (address caller, uint8 actionType, uint256 amount, string memory memo, uint64 executedAt) =
            action.lastActionBySession(SESSION_ID);
        (address callerByWallet, uint8 actionTypeByWallet, uint256 amountByWallet, string memory memoByWallet,) =
            action.lastActionByCaller(address(runnerWallet));

        require(caller == address(runnerWallet), "session caller");
        require(actionType == 3, "session actionType");
        require(amount == 777, "session amount");
        require(keccak256(bytes(memo)) == keccak256(bytes("runner wallet action")), "session memo");
        require(executedAt > 0, "session executedAt");
        require(callerByWallet == address(runnerWallet), "wallet caller");
        require(actionTypeByWallet == 3, "wallet actionType");
        require(amountByWallet == 777, "wallet amount");
        require(keccak256(bytes(memoByWallet)) == keccak256(bytes("runner wallet action")), "wallet memo");
    }

    function testEmittedActionCanBeLinkedBackToTraceRegistry() public {
        registry.startSession(SESSION_ID, address(runnerWallet), GOAL_HASH, "local://goal.json", "local://metadata.json");

        bytes memory actionCallData = abi.encodeCall(
            action.executeAction, (SESSION_ID, uint8(1), uint256(500), "execute approved treasury demo action")
        );
        bytes32 calldataHash = keccak256(actionCallData);

        runnerWallet.execute(action, SESSION_ID, 1, 500, "execute approved treasury demo action");

        registry.linkExecution(
            SESSION_ID,
            7,
            address(action),
            calldataHash,
            TX_HASH,
            TraceRegistry.TxStatus.Confirmed,
            "local://traces/session-1/execution.json"
        );

        (address target, bytes32 storedCalldataHash, bytes32 storedTxHash, TraceRegistry.TxStatus status, string memory uri)
        = registry.executions(SESSION_ID, 7);

        require(target == address(action), "target");
        require(storedCalldataHash == calldataHash, "calldataHash");
        require(storedTxHash == TX_HASH, "txHash");
        require(status == TraceRegistry.TxStatus.Confirmed, "status");
        require(keccak256(bytes(uri)) == keccak256(bytes("local://traces/session-1/execution.json")), "uri");
    }
}
