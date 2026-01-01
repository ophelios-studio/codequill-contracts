// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICodeQuillDelegation {
    function SCOPE_CLAIM() external view returns (uint256);
    function isAuthorized(address owner_, address relayer_, uint256 scope, bytes32 repoId) external view returns (bool);
}

/// @title CodeQuillRegistry - repo → owner mapping with relayer/delegation support
contract CodeQuillRegistry is Ownable {
    /// @notice repoId (bytes32) -> owner (wallet)
    mapping(bytes32 => address) public repoOwner;
    mapping(address => bytes32[]) private reposByOwner;

    ICodeQuillDelegation public immutable delegation;

    event RepoClaimed(bytes32 indexed repoId, address indexed owner, string meta);
    event RepoTransferred(bytes32 indexed repoId, address indexed oldOwner, address indexed newOwner);

    constructor(address initialOwner, address delegationAddr) Ownable(initialOwner) {
        require(delegationAddr != address(0), "delegation zero");
        delegation = ICodeQuillDelegation(delegationAddr);
    }

    /// @notice Check if a repoId has already been claimed.
    function isClaimed(bytes32 repoId) external view returns (bool) {
        return repoOwner[repoId] != address(0);
    }

    /// @notice Batch read: returns an owner address for each repoId (address(0) if unclaimed).
    /// @dev This is designed for off-chain batch queries via a single eth_call.
    function repoOwners(bytes32[] calldata ids) external view returns (address[] memory owners) {
        owners = new address[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            owners[i] = repoOwner[ids[i]];
        }
        return owners;
    }

    /// @notice Direct claim: wallet calls it themselves (no relayer).
    function claimRepo(bytes32 repoId, string calldata meta) external {
        require(repoOwner[repoId] == address(0), "already claimed");
        repoOwner[repoId] = msg.sender;
        reposByOwner[msg.sender].push(repoId);
        emit RepoClaimed(repoId, msg.sender, meta);
    }

    /// @notice Relayer/delegation claim.
    /// Allowed if:
    /// - msg.sender is the contract owner (admin relayer), OR
    /// - Delegation contract says owner_ has authorized msg.sender for SCOPE_CLAIM on repoId (or wildcard).
    function claimRepoFor(bytes32 repoId, string calldata meta, address owner_) external {
        require(owner_ != address(0), "zero owner");
        require(repoOwner[repoId] == address(0), "already claimed");

        bool isOwner = msg.sender == owner();
        bool isDelegated = delegation.isAuthorized(owner_, msg.sender, delegation.SCOPE_CLAIM(), repoId);

        require(isOwner || isDelegated, "not authorized");

        repoOwner[repoId] = owner_;
        reposByOwner[owner_].push(repoId);
        emit RepoClaimed(repoId, owner_, meta);
    }

    function getReposByOwner(address owner_) external view returns (bytes32[] memory) {
        return reposByOwner[owner_];
    }

    /// @notice Controlled transfer.
    /// Allowed if owner() or delegated with SCOPE_CLAIM for this repoId (treat as admin action).
    function transferRepo(bytes32 repoId, address newOwner) external {
        address old = repoOwner[repoId];
        require(old != address(0), "not claimed");
        require(newOwner != address(0), "zero newOwner");

        bool isOwner = msg.sender == owner();
        bool isDelegated = delegation.isAuthorized(old, msg.sender, delegation.SCOPE_CLAIM(), repoId);
        require(isOwner || isDelegated, "not authorized");

        repoOwner[repoId] = newOwner;
        emit RepoTransferred(repoId, old, newOwner);
    }
}