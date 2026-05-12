// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TraceRegistry} from "../src/TraceRegistry.sol";

contract TraceRegistryCaller {
    function recordTrace(
        TraceRegistry registry,
        bytes32 sessionId,
        uint32 step,
        string calldata eventType,
        bytes32 contentHash,
        string calldata uri,
        TraceRegistry.Severity severity
    ) external {
        registry.recordTrace(sessionId, step, eventType, contentHash, uri, severity);
    }

    function linkExecution(
        TraceRegistry registry,
        bytes32 sessionId,
        uint32 step,
        address target,
        bytes32 calldataHash,
        bytes32 txHash,
        TraceRegistry.TxStatus status,
        string calldata uri
    ) external {
        registry.linkExecution(sessionId, step, target, calldataHash, txHash, status, uri);
    }
}

contract TraceRegistryTest {
    TraceRegistry private registry;
    TraceRegistryCaller private caller;

    bytes32 private constant SESSION_ID = keccak256("session-1");
    bytes32 private constant GOAL_HASH = keccak256("goal");
    bytes32 private constant CONTENT_HASH = keccak256("trace-json");
    bytes32 private constant CALLDATA_HASH = keccak256("calldata");
    bytes32 private constant TX_HASH = keccak256("tx");

    function setUp() public {
        registry = new TraceRegistry();
        caller = new TraceRegistryCaller();
    }

    function testStartSessionStoresCompactMetadata() public {
        registry.startSession(SESSION_ID, address(0xA11CE), GOAL_HASH, "local://goal.json", "local://metadata.json");

        (
            address owner,
            address agent,
            uint64 startedAt,
            uint32 eventCount,
            bytes32 goalHash,
            string memory goalUri,
            bool closed
        ) = registry.sessions(SESSION_ID);

        require(owner == address(this), "owner");
        require(agent == address(0xA11CE), "agent");
        require(startedAt > 0, "startedAt");
        require(eventCount == 0, "eventCount");
        require(goalHash == GOAL_HASH, "goalHash");
        require(keccak256(bytes(goalUri)) == keccak256(bytes("local://goal.json")), "goalUri");
        require(!closed, "closed");
    }

    function testRecordTraceIncrementsCountAndMarksStep() public {
        _startSession();

        registry.recordTrace(
            SESSION_ID, 1, "goal.received", CONTENT_HASH, "local://traces/session-1/1.json", TraceRegistry.Severity.Info
        );

        (,,, uint32 eventCount,,,) = registry.sessions(SESSION_ID);
        require(eventCount == 1, "eventCount");
        require(registry.usedSteps(SESSION_ID, 1), "step");
    }

    function testLinkExecutionStoresFinalTransactionProof() public {
        _startSession();

        registry.linkExecution(
            SESSION_ID,
            7,
            address(0xCAFE),
            CALLDATA_HASH,
            TX_HASH,
            TraceRegistry.TxStatus.Confirmed,
            "local://traces/session-1/execution.json"
        );

        (,,, uint32 eventCount,,,) = registry.sessions(SESSION_ID);
        (address target, bytes32 calldataHash, bytes32 txHash, TraceRegistry.TxStatus status, string memory uri) =
            registry.executions(SESSION_ID, 7);

        require(eventCount == 1, "eventCount");
        require(target == address(0xCAFE), "target");
        require(calldataHash == CALLDATA_HASH, "calldataHash");
        require(txHash == TX_HASH, "txHash");
        require(status == TraceRegistry.TxStatus.Confirmed, "status");
        require(keccak256(bytes(uri)) == keccak256(bytes("local://traces/session-1/execution.json")), "uri");
    }

    function testCloseSessionClosesWithoutIncrementingTraceCount() public {
        _startSession();
        registry.recordTrace(
            SESSION_ID, 1, "session.summary", CONTENT_HASH, "local://traces/session-1/summary.json", TraceRegistry.Severity.Info
        );

        registry.closeSession(SESSION_ID, keccak256("summary"), "local://traces/session-1/summary.json");

        (,,, uint32 eventCount,,, bool closed) = registry.sessions(SESSION_ID);
        require(eventCount == 1, "eventCount");
        require(closed, "closed");
    }

    function testRejectsDuplicateSessionIds() public {
        _startSession();

        bytes memory callData = abi.encodeCall(
            registry.startSession, (SESSION_ID, address(0xA11CE), GOAL_HASH, "local://goal.json", "local://metadata.json")
        );

        _assertReverts(address(registry), callData, "duplicate session");
    }

    function testRejectsWritesByNonOwner() public {
        _startSession();

        bytes memory callData = abi.encodeCall(
            caller.recordTrace,
            (
                registry,
                SESSION_ID,
                1,
                "goal.received",
                CONTENT_HASH,
                "local://traces/session-1/1.json",
                TraceRegistry.Severity.Info
            )
        );

        _assertReverts(address(caller), callData, "non-owner record");
    }

    function testRejectsExecutionLinkByNonOwner() public {
        _startSession();

        bytes memory callData = abi.encodeCall(
            caller.linkExecution,
            (
                registry,
                SESSION_ID,
                7,
                address(0xCAFE),
                CALLDATA_HASH,
                TX_HASH,
                TraceRegistry.TxStatus.Submitted,
                "local://traces/session-1/execution.json"
            )
        );

        _assertReverts(address(caller), callData, "non-owner execution");
    }

    function testRejectsWritesToMissingSession() public {
        bytes memory recordCall = abi.encodeCall(
            registry.recordTrace,
            (
                SESSION_ID,
                1,
                "goal.received",
                CONTENT_HASH,
                "local://traces/session-1/1.json",
                TraceRegistry.Severity.Info
            )
        );
        bytes memory executionCall = abi.encodeCall(
            registry.linkExecution,
            (
                SESSION_ID,
                7,
                address(0xCAFE),
                CALLDATA_HASH,
                TX_HASH,
                TraceRegistry.TxStatus.Submitted,
                "local://traces/session-1/execution.json"
            )
        );

        _assertReverts(address(registry), recordCall, "missing record");
        _assertReverts(address(registry), executionCall, "missing execution");
    }

    function testRejectsWritesToClosedSession() public {
        _startSession();
        registry.closeSession(SESSION_ID, keccak256("summary"), "local://traces/session-1/summary.json");

        bytes memory recordCall = abi.encodeCall(
            registry.recordTrace,
            (
                SESSION_ID,
                1,
                "goal.received",
                CONTENT_HASH,
                "local://traces/session-1/1.json",
                TraceRegistry.Severity.Info
            )
        );
        bytes memory executionCall = abi.encodeCall(
            registry.linkExecution,
            (
                SESSION_ID,
                7,
                address(0xCAFE),
                CALLDATA_HASH,
                TX_HASH,
                TraceRegistry.TxStatus.Submitted,
                "local://traces/session-1/execution.json"
            )
        );

        _assertReverts(address(registry), recordCall, "closed record");
        _assertReverts(address(registry), executionCall, "closed execution");
    }

    function testRejectsDuplicateStepsAcrossTraceAndExecution() public {
        _startSession();
        registry.recordTrace(
            SESSION_ID, 1, "goal.received", CONTENT_HASH, "local://traces/session-1/1.json", TraceRegistry.Severity.Info
        );

        bytes memory recordCall = abi.encodeCall(
            registry.recordTrace,
            (
                SESSION_ID,
                1,
                "plan.created",
                CONTENT_HASH,
                "local://traces/session-1/1-duplicate.json",
                TraceRegistry.Severity.Info
            )
        );
        bytes memory executionCall = abi.encodeCall(
            registry.linkExecution,
            (
                SESSION_ID,
                1,
                address(0xCAFE),
                CALLDATA_HASH,
                TX_HASH,
                TraceRegistry.TxStatus.Submitted,
                "local://traces/session-1/execution.json"
            )
        );

        _assertReverts(address(registry), recordCall, "duplicate trace step");
        _assertReverts(address(registry), executionCall, "duplicate execution step");
    }

    function _startSession() private {
        registry.startSession(SESSION_ID, address(0xA11CE), GOAL_HASH, "local://goal.json", "local://metadata.json");
    }

    function _assertReverts(address target, bytes memory callData, string memory label) private {
        (bool ok,) = target.call(callData);
        require(!ok, label);
    }
}
