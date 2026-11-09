// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract GraphRootLog {
    address public immutable operator;
    mapping(uint64 => bytes32) private roots;
    uint64 public latestEpoch;

    event Committed(uint64 indexed epoch, bytes32 root, uint32 nodeCount, uint32 edgeCount, uint64 ts);

    modifier onlyOperator() { require(msg.sender == operator, "GraphRootLog: not operator"); _; }

    constructor(address operator_) { operator = operator_; }

    function commit(uint64 epoch, bytes32 root, uint32 nodeCount, uint32 edgeCount) external onlyOperator {
        require(epoch > latestEpoch, "GraphRootLog: epoch not increasing");
        latestEpoch = epoch;
        roots[epoch] = root;
        emit Committed(epoch, root, nodeCount, edgeCount, uint64(block.timestamp));
    }

    function rootOf(uint64 epoch) external view returns (bytes32) { return roots[epoch]; }

    function latest() external view returns (uint64 epoch, bytes32 root) {
        return (latestEpoch, roots[latestEpoch]);
    }

    function verifyLeaf(uint64 epoch, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        return MerkleProof.verify(proof, roots[epoch], leaf);
    }
}
