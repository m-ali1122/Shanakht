// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGraphRootLog { function rootOf(uint64 epoch) external view returns (bytes32); }

contract DecisionLog {
    struct Decision { bytes32 decisionHash; bytes32 modelVersion; bytes32 graphRoot; uint64 epoch; uint8 band; uint8 action; bytes32 approverHash; uint64 ts; }
    IGraphRootLog public immutable graphRootLog;
    uint256 public nextId;
    mapping(uint256 => Decision) private decisions;

    event Anchored(uint256 indexed id, bytes32 decisionHash, bytes32 modelVersion, bytes32 graphRoot, uint64 epoch, uint8 band, uint8 action, bytes32 approverHash, uint64 ts);

    constructor(address graphRootLog_) { graphRootLog = IGraphRootLog(graphRootLog_); }

    function anchor(bytes32 decisionHash, bytes32 modelVersion, bytes32 graphRoot, uint64 epoch, uint8 band, uint8 action, bytes32 approverHash) external returns (uint256 id) {
        require(graphRoot == graphRootLog.rootOf(epoch), "DecisionLog: root mismatch");
        id = nextId++;
        decisions[id] = Decision(decisionHash, modelVersion, graphRoot, epoch, band, action, approverHash, uint64(block.timestamp));
        emit Anchored(id, decisionHash, modelVersion, graphRoot, epoch, band, action, approverHash, uint64(block.timestamp));
    }

    function get(uint256 id) external view returns (Decision memory) {
        require(id < nextId, "DecisionLog: unknown id");
        return decisions[id];
    }
}
