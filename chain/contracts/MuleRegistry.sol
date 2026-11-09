// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MuleRegistry {
    struct Entry { uint8 kind; uint8 publisherBank; uint64 ts; bool active; address publisher; }
    address public immutable operator;
    mapping(address => uint8) public memberBank;
    mapping(bytes32 => Entry) private entries;

    event Published(bytes32 indexed fp, uint8 kind, uint8 bankId, uint64 ts);
    event Revoked(bytes32 indexed fp, uint64 ts);

    modifier onlyMember(uint8 bankId) {
        require(msg.sender == operator || (memberBank[msg.sender] != 0 && memberBank[msg.sender] == bankId), "MuleRegistry: not member");
        _;
    }

    constructor(address operator_, address[] memory members, uint8[] memory bankIds) {
        require(members.length == bankIds.length, "MuleRegistry: length mismatch");
        operator = operator_;
        for (uint256 i; i < members.length; i++) memberBank[members[i]] = bankIds[i];
    }

    function publish(bytes32 fp, uint8 kind, uint8 bankId) external onlyMember(bankId) {
        require(bankId != 0, "MuleRegistry: invalid bank");
        entries[fp] = Entry(kind, bankId, uint64(block.timestamp), true, msg.sender);
        emit Published(fp, kind, bankId, uint64(block.timestamp));
    }

    function revoke(bytes32 fp) external {
        Entry storage entry = entries[fp];
        require(entry.active, "MuleRegistry: not active");
        require(msg.sender == entry.publisher || (memberBank[msg.sender] != 0 && memberBank[msg.sender] == entry.publisherBank), "MuleRegistry: not publisher");
        entry.active = false;
        emit Revoked(fp, uint64(block.timestamp));
    }

    function isFlagged(bytes32 fp) external view returns (bool active, uint8 kind, uint64 ts) {
        Entry memory entry = entries[fp];
        return (entry.active, entry.kind, entry.ts);
    }
}
