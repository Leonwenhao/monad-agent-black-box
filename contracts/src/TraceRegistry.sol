// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TraceRegistry {
    enum Severity {
        Info,
        Warning,
        Critical
    }

    enum TxStatus {
        Proposed,
        Submitted,
        Confirmed,
        Failed
    }

    struct Session {
        address owner;
        address agent;
        uint64 startedAt;
        uint32 eventCount;
        bytes32 goalHash;
        string goalUri;
        bool closed;
    }

    struct Execution {
        address target;
        bytes32 calldataHash;
        bytes32 txHash;
        TxStatus status;
        string uri;
    }

    event SessionStarted(
        bytes32 indexed sessionId,
        address indexed owner,
        address indexed agent,
        bytes32 goalHash,
        string goalUri,
        string metadataUri
    );

    event TraceEventRecorded(
        bytes32 indexed sessionId,
        uint32 indexed step,
        string eventType,
        bytes32 contentHash,
        string uri,
        Severity severity
    );

    event ExecutionLinked(
        bytes32 indexed sessionId,
        uint32 indexed step,
        address indexed target,
        bytes32 calldataHash,
        bytes32 txHash,
        TxStatus status,
        string uri
    );

    event SessionClosed(bytes32 indexed sessionId, uint32 eventCount, bytes32 summaryHash, string summaryUri);

    error DuplicateSession(bytes32 sessionId);
    error MissingSession(bytes32 sessionId);
    error SessionClosedError(bytes32 sessionId);
    error NotSessionOwner(bytes32 sessionId, address caller);
    error DuplicateStep(bytes32 sessionId, uint32 step);

    mapping(bytes32 sessionId => Session) public sessions;
    mapping(bytes32 sessionId => mapping(uint32 step => bool used)) public usedSteps;
    mapping(bytes32 sessionId => mapping(uint32 step => Execution)) public executions;

    function startSession(
        bytes32 sessionId,
        address agent,
        bytes32 goalHash,
        string calldata goalUri,
        string calldata metadataUri
    ) external {
        if (sessions[sessionId].owner != address(0)) {
            revert DuplicateSession(sessionId);
        }

        sessions[sessionId] = Session({
            owner: msg.sender,
            agent: agent,
            startedAt: uint64(block.timestamp),
            eventCount: 0,
            goalHash: goalHash,
            goalUri: goalUri,
            closed: false
        });

        emit SessionStarted(sessionId, msg.sender, agent, goalHash, goalUri, metadataUri);
    }

    function recordTrace(
        bytes32 sessionId,
        uint32 step,
        string calldata eventType,
        bytes32 contentHash,
        string calldata uri,
        Severity severity
    ) external onlyOpenOwnerSession(sessionId) {
        _markStep(sessionId, step);
        sessions[sessionId].eventCount += 1;

        emit TraceEventRecorded(sessionId, step, eventType, contentHash, uri, severity);
    }

    function linkExecution(
        bytes32 sessionId,
        uint32 step,
        address target,
        bytes32 calldataHash,
        bytes32 txHash,
        TxStatus status,
        string calldata uri
    ) external onlyOpenOwnerSession(sessionId) {
        _markStep(sessionId, step);
        sessions[sessionId].eventCount += 1;
        executions[sessionId][step] = Execution({
            target: target,
            calldataHash: calldataHash,
            txHash: txHash,
            status: status,
            uri: uri
        });

        emit ExecutionLinked(sessionId, step, target, calldataHash, txHash, status, uri);
    }

    function closeSession(bytes32 sessionId, bytes32 summaryHash, string calldata summaryUri)
        external
        onlyOpenOwnerSession(sessionId)
    {
        sessions[sessionId].closed = true;

        emit SessionClosed(sessionId, sessions[sessionId].eventCount, summaryHash, summaryUri);
    }

    modifier onlyOpenOwnerSession(bytes32 sessionId) {
        Session storage session = sessions[sessionId];
        if (session.owner == address(0)) {
            revert MissingSession(sessionId);
        }
        if (msg.sender != session.owner) {
            revert NotSessionOwner(sessionId, msg.sender);
        }
        if (session.closed) {
            revert SessionClosedError(sessionId);
        }
        _;
    }

    function _markStep(bytes32 sessionId, uint32 step) private {
        if (usedSteps[sessionId][step]) {
            revert DuplicateStep(sessionId, step);
        }
        usedSteps[sessionId][step] = true;
    }
}
