// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DemoTreasuryAction {
    struct Action {
        address caller;
        uint8 actionType;
        uint256 amount;
        string memo;
        uint64 executedAt;
    }

    event DemoActionExecuted(
        bytes32 indexed sessionId, address indexed caller, uint8 actionType, uint256 amount, string memo
    );

    mapping(bytes32 sessionId => Action) public lastActionBySession;
    mapping(address caller => Action) public lastActionByCaller;

    function executeAction(bytes32 sessionId, uint8 actionType, uint256 amount, string calldata memo) external {
        Action memory action = Action({
            caller: msg.sender,
            actionType: actionType,
            amount: amount,
            memo: memo,
            executedAt: uint64(block.timestamp)
        });

        lastActionBySession[sessionId] = action;
        lastActionByCaller[msg.sender] = action;

        emit DemoActionExecuted(sessionId, msg.sender, actionType, amount, memo);
    }
}
