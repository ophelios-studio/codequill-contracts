// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICodeQuillRepositoryRegistry {
    function repoOwner(bytes32 repoId) external view returns (address);
    function repoContextId(bytes32 repoId) external view returns (bytes32);
}

interface ICodeQuillWorkspaceRegistry {
    function isMember(bytes32 contextId, address wallet) external view returns (bool);
}

interface ICodeQuillDelegation {
    function SCOPE_SNAPSHOT() external view returns (uint256);

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 contextId
    ) external view returns (bool);
}

/// @title CodeQuillSnapshotRegistry - lightweight snapshot via merkle roots + off-chain manifest
/// @notice Snapshot creation is allowed for repo owner OR relayer delegated by repo owner within a contextId (workspace).
contract CodeQuillSnapshotRegistry {
    ICodeQuillRepositoryRegistry public immutable registry;
    ICodeQuillWorkspaceRegistry public immutable workspace;
    ICodeQuillDelegation public immutable delegation;

    struct Snapshot {
        bytes32 commitHash;  // git commit
        bytes32 merkleRoot;  // merkle tree root of all file hashes
        string  manifestCid; // IPFS CID of JSON manifest with file list
        uint256 timestamp;
        address author;      // repo owner (recorded for provenance)
    }

    mapping(bytes32 => Snapshot[]) private snapshotsOf;
    mapping(bytes32 => mapping(bytes32 => uint256)) public snapshotIndexByRoot;

    event SnapshotCreated(
        bytes32 indexed repoId,
        uint256 indexed snapshotIndex,
        bytes32 indexed contextId,
        address author,
        bytes32 commitHash,
        bytes32 merkleRoot,
        string manifestCid,
        uint256 timestamp
    );

    constructor(
        address registryAddr,
        address workspaceAddr,
        address delegationAddr
    ) {
        require(registryAddr != address(0), "zero registry");
        require(workspaceAddr != address(0), "zero workspace");
        require(delegationAddr != address(0), "zero delegation");

        registry = ICodeQuillRepositoryRegistry(registryAddr);
        workspace = ICodeQuillWorkspaceRegistry(workspaceAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
    }

    /// @notice Create a snapshot
    /// @dev Works for:
    ///  - direct repo owner call (msg.sender == repoOwner), and
    ///  - relayed call where repo owner delegated SCOPE_SNAPSHOT to msg.sender within contextId.
    ///
    /// @param author Logical author wallet to record on-chain. Must be the repo owner.
    function createSnapshot(
        bytes32 repoId,
        bytes32 contextId,
        bytes32 commitHash,
        bytes32 merkleRoot,
        string calldata manifestCid,
        address author
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(merkleRoot != bytes32(0), "zero root");
        require(bytes(manifestCid).length > 0, "empty CID");
        require(snapshotIndexByRoot[repoId][merkleRoot] == 0, "duplicate root");

        address owner_ = registry.repoOwner(repoId);
        require(owner_ != address(0), "repo not claimed");

        // Repo must belong to this workspace context
        bytes32 repoCtx = registry.repoContextId(repoId);
        require(repoCtx == contextId, "repo wrong context");

        // Snapshot provenance: author must be repo owner
        require(author == owner_, "author must be repo owner");

        // Membership enforcement: repo owner must be a member of the workspace context
        require(workspace.isMember(contextId, owner_), "owner not member");

        // Authorization: owner calls directly OR owner delegated caller for this context
        if (msg.sender != owner_) {
            bool isDelegated = delegation.isAuthorized(owner_, msg.sender, delegation.SCOPE_SNAPSHOT(), contextId);
            require(isDelegated, "not authorized");
        }

        uint256 idx = snapshotsOf[repoId].length;

        snapshotsOf[repoId].push(Snapshot({
            commitHash: commitHash,
            merkleRoot: merkleRoot,
            manifestCid: manifestCid,
            timestamp: block.timestamp,
            author: author
        }));

        snapshotIndexByRoot[repoId][merkleRoot] = idx + 1;

        emit SnapshotCreated(
            repoId,
            idx,
            contextId,
            author,
            commitHash,
            merkleRoot,
            manifestCid,
            block.timestamp
        );
    }

    function getSnapshotsCount(bytes32 repoId) external view returns (uint256) {
        return snapshotsOf[repoId].length;
    }

    function getSnapshot(bytes32 repoId, uint256 index)
    external
    view
    returns (
        bytes32 commitHash,
        bytes32 merkleRoot,
        string memory manifestCid,
        uint256 timestamp,
        address author
    )
    {
        require(index < snapshotsOf[repoId].length, "invalid index");
        Snapshot storage s = snapshotsOf[repoId][index];
        return (s.commitHash, s.merkleRoot, s.manifestCid, s.timestamp, s.author);
    }

    function getSnapshotByRoot(bytes32 repoId, bytes32 merkleRoot)
    external
    view
    returns (
        bytes32 commitHash,
        string memory manifestCid,
        uint256 timestamp,
        address author,
        uint256 index
    )
    {
        uint256 idx1 = snapshotIndexByRoot[repoId][merkleRoot];
        require(idx1 != 0, "not found");
        Snapshot storage s = snapshotsOf[repoId][idx1 - 1];
        return (s.commitHash, s.manifestCid, s.timestamp, s.author, idx1 - 1);
    }
}