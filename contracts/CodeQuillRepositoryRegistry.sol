// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICodeQuillDelegation {
    function SCOPE_CLAIM() external view returns (uint256);

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 contextId
    ) external view returns (bool);
}

interface ICodeQuillWorkspaceRegistry {
    function isMember(bytes32 contextId, address wallet) external view returns (bool);
}

/// @title CodeQuillRepositoryRegistry
/// @notice Repository claim registry (repoId -> owner wallet) with context-scoped relayer delegation.
/// @dev "contextId" is your workspace identifier (bytes32). No on-chain workspace registry required.
contract CodeQuillRepositoryRegistry is Ownable {
    /// @notice repoId (bytes32) -> owner (wallet)
    mapping(bytes32 => address) public repoOwner;

    /// @notice repoId (bytes32) -> contextId (workspace identifier)
    mapping(bytes32 => bytes32) public repoContextId;

    /// @dev Convenience list for UI/off-chain; not used for authorization
    mapping(address => bytes32[]) private reposByOwner;

    ICodeQuillDelegation public immutable delegation;
    ICodeQuillWorkspaceRegistry public immutable workspace;

    event RepoClaimed(bytes32 indexed repoId, address indexed owner, bytes32 indexed contextId, string meta);

    /// @notice Emitted when repo ownership and/or context changes.
    event RepoTransferred(
        bytes32 indexed repoId,
        address indexed oldOwner,
        address indexed newOwner,
        bytes32 oldContextId,
        bytes32 newContextId
    );

    constructor(
        address initialOwner,
        address delegationAddr,
        address workspaceAddr
    ) Ownable(initialOwner) {
        require(delegationAddr != address(0), "delegation zero");
        require(workspaceAddr != address(0), "workspace zero");
        delegation = ICodeQuillDelegation(delegationAddr);
        workspace = ICodeQuillWorkspaceRegistry(workspaceAddr);
    }

    /// @notice Check if a repoId has already been claimed.
    function isClaimed(bytes32 repoId) external view returns (bool) {
        return repoOwner[repoId] != address(0);
    }

    /// @notice Batch read: returns an owner address for each repoId (address(0) if unclaimed).
    /// @dev Designed for off-chain batch queries via a single eth_call.
    function repoOwners(bytes32[] calldata ids) external view returns (address[] memory owners) {
        owners = new address[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            owners[i] = repoOwner[ids[i]];
        }
    }

    /// @notice Claim a repo.
    /// @dev Works for both:
    ///  - direct EOA claim (msg.sender == owner_), and
    ///  - relayed claim (msg.sender delegated by owner_ for SCOPE_CLAIM in contextId).
    ///
    /// Membership enforcement:
    /// - owner_ must be a member of the workspace contextId.
    function claimRepo(
        bytes32 repoId,
        bytes32 contextId,
        string calldata meta,
        address owner_
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(owner_ != address(0), "zero owner");
        require(repoOwner[repoId] == address(0), "already claimed");

        require(workspace.isMember(contextId, owner_), "owner not member");

        if (msg.sender != owner_) {
            bool isDelegated = delegation.isAuthorized(owner_, msg.sender, delegation.SCOPE_CLAIM(), contextId);
            require(isDelegated, "not authorized");
        }

        repoOwner[repoId] = owner_;
        repoContextId[repoId] = contextId;

        reposByOwner[owner_].push(repoId);

        emit RepoClaimed(repoId, owner_, contextId, meta);
    }

    function getReposByOwner(address owner_) external view returns (bytes32[] memory) {
        return reposByOwner[owner_];
    }

    /// @notice Transfer a claimed repo to a new owner AND/OR move it to a new contextId.
    /// @dev Allowed if:
    ///  - msg.sender == current owner (direct), OR
    ///  - msg.sender is delegated by current owner for SCOPE_CLAIM in the CURRENT repo context.
    ///
    /// Membership enforcement:
    /// - newOwner must be a member of newContextId.
    ///
    /// No-op prevention:
    /// - disallow transfers that don't change owner AND don't change context.
    function transferRepo(
        bytes32 repoId,
        address newOwner,
        bytes32 newContextId
    ) external {
        require(newContextId != bytes32(0), "zero newContext");
        require(newOwner != address(0), "zero newOwner");

        address old = repoOwner[repoId];
        require(old != address(0), "not claimed");

        bytes32 oldContextId = repoContextId[repoId];
        require(oldContextId != bytes32(0), "missing context");

        require(newOwner != old || newContextId != oldContextId, "no change");

        if (msg.sender != old) {
            bool isDelegated = delegation.isAuthorized(old, msg.sender, delegation.SCOPE_CLAIM(), oldContextId);
            require(isDelegated, "not authorized");
        }

        require(workspace.isMember(newContextId, newOwner), "newOwner not member");

        repoOwner[repoId] = newOwner;
        repoContextId[repoId] = newContextId;

        reposByOwner[newOwner].push(repoId);

        emit RepoTransferred(repoId, old, newOwner, oldContextId, newContextId);
    }
}