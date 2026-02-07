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
    function SCOPE_BACKUP() external view returns (uint256);

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 contextId
    ) external view returns (bool);
}

interface ICodeQuillSnapshotRegistry {
    // returns index+1 (0 means not found)
    function snapshotIndexByRoot(bytes32 repoId, bytes32 merkleRoot) external view returns (uint256);
}

/// @title CodeQuillBackupRegistry
/// @notice Optional registry for anchoring existence of encrypted backups bound to a published snapshot.
/// @dev This anchors metadata only (hashes + optional CID). It does NOT store plaintext and does NOT prove build causality.
contract CodeQuillBackupRegistry {
    ICodeQuillRepositoryRegistry public immutable registry;
    ICodeQuillWorkspaceRegistry public immutable workspace;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillSnapshotRegistry public immutable snapshot;

    struct Backup {
        bytes32 snapshotMerkleRoot; // snapshot merkle root (must exist in CodeQuillSnapshotRegistry)
        bytes32 archiveSha256;      // sha256 of plaintext archive bytes (tar.gz) BEFORE encryption
        bytes32 metadataSha256;     // optional: sha256 of backup_metadata JSON (0x0 if unused)
        string  backupCid;          // optional: encrypted blob CID / locator (can be empty)
        uint256 timestamp;          // block.timestamp
        address author;             // repo owner (recorded for provenance)
    }

    // repoId => snapshotRoot => single backup (overwrite allowed)
    mapping(bytes32 => mapping(bytes32 => Backup)) private backupsOf;

    event BackupAnchored(
        bytes32 indexed repoId,
        bytes32 indexed snapshotMerkleRoot,
        bytes32 indexed archiveSha256,
        bytes32 contextId,
        address author,
        bytes32 metadataSha256,
        string backupCid,
        uint256 timestamp
    );

    constructor(
        address registryAddr,
        address workspaceAddr,
        address delegationAddr,
        address snapshotAddr
    ) {
        require(registryAddr != address(0), "zero registry");
        require(workspaceAddr != address(0), "zero workspace");
        require(delegationAddr != address(0), "zero delegation");
        require(snapshotAddr != address(0), "zero snapshot");

        registry = ICodeQuillRepositoryRegistry(registryAddr);
        workspace = ICodeQuillWorkspaceRegistry(workspaceAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
        snapshot = ICodeQuillSnapshotRegistry(snapshotAddr);
    }

    /// @notice Anchor a backup record for a snapshot root.
    /// @dev Works for:
    ///  - direct repo owner call (msg.sender == repoOwner), and
    ///  - relayed call where repo owner delegated SCOPE_BACKUP to msg.sender within contextId.
    ///
    /// Principles enforced:
    /// - repo must belong to contextId
    /// - repo owner must be a member of contextId
    /// - author must be repo owner (provenance)
    function anchorBackup(
        bytes32 repoId,
        bytes32 contextId,
        bytes32 snapshotMerkleRoot,
        bytes32 archiveSha256,
        bytes32 metadataSha256,
        string calldata backupCid,
        address author
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(snapshotMerkleRoot != bytes32(0), "zero snapshot root");
        require(archiveSha256 != bytes32(0), "zero archive sha");

        address owner_ = registry.repoOwner(repoId);
        require(owner_ != address(0), "repo not claimed");

        bytes32 repoCtx = registry.repoContextId(repoId);
        require(repoCtx == contextId, "repo wrong context");

        require(workspace.isMember(contextId, owner_), "owner not member");

        // provenance: author is repo owner
        require(author == owner_, "author must be repo owner");

        // Authorization: owner calls directly OR owner delegated caller for this context
        if (msg.sender != owner_) {
            bool isDelegated = delegation.isAuthorized(owner_, msg.sender, delegation.SCOPE_BACKUP(), contextId);
            require(isDelegated, "not authorized");
        }

        // Require the snapshot exists on-chain
        uint256 snapIdx1 = snapshot.snapshotIndexByRoot(repoId, snapshotMerkleRoot);
        require(snapIdx1 != 0, "snapshot not found");

        backupsOf[repoId][snapshotMerkleRoot] = Backup({
            snapshotMerkleRoot: snapshotMerkleRoot,
            archiveSha256: archiveSha256,
            metadataSha256: metadataSha256,
            backupCid: backupCid,
            timestamp: block.timestamp,
            author: author
        });

        emit BackupAnchored(
            repoId,
            snapshotMerkleRoot,
            archiveSha256,
            contextId,
            author,
            metadataSha256,
            backupCid,
            block.timestamp
        );
    }

    function hasBackup(bytes32 repoId, bytes32 snapshotMerkleRoot) external view returns (bool) {
        return backupsOf[repoId][snapshotMerkleRoot].timestamp != 0;
    }

    function getBackup(bytes32 repoId, bytes32 snapshotMerkleRoot)
    external
    view
    returns (
        bytes32 archiveSha256,
        bytes32 metadataSha256,
        string memory backupCid,
        uint256 timestamp,
        address author
    )
    {
        Backup storage b = backupsOf[repoId][snapshotMerkleRoot];
        require(b.timestamp != 0, "backup not found");
        return (b.archiveSha256, b.metadataSha256, b.backupCid, b.timestamp, b.author);
    }
}