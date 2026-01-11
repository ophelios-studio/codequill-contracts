// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICodeQuillRegistry {
    function repoOwner(bytes32 repoId) external view returns (address);
}

interface ICodeQuillDelegation {
    // If you don't want a new scope in your Delegation contract yet,
    // you can replace SCOPE_BACKUP() with SCOPE_ATTEST().
    function SCOPE_BACKUP() external view returns (uint256);

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 repoId
    ) external view returns (bool);
}

interface ICodeQuillSnapshot {
    // returns index+1 (0 means not found)
    function snapshotIndexByRoot(bytes32 repoId, bytes32 merkleRoot) external view returns (uint256);
}

/// @title CodeQuillBackupRegistry
/// @notice Optional registry for anchoring existence of encrypted backups bound to a published snapshot.
/// @dev This anchors metadata only (hashes + optional CID). It does NOT store plaintext and does NOT prove build causality.
contract CodeQuillBackupRegistry is Ownable {
    ICodeQuillRegistry public immutable registry;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillSnapshot public immutable snapshot;

    struct Backup {
        bytes32 snapshotMerkleRoot; // snapshot merkle root (must exist in CodeQuillSnapshot)
        bytes32 archiveSha256;      // sha256 of plaintext archive bytes (tar.gz) BEFORE encryption
        bytes32 metadataSha256;     // optional: sha256 of backup_metadata JSON (0x0 if unused)
        string  backupCid;          // optional: encrypted blob CID / locator (can be empty)
        uint256 timestamp;          // block.timestamp
        address author;             // authority wallet (repo owner) passed by backend
    }

    // repoId => snapshotRoot => backups[]
    mapping(bytes32 => mapping(bytes32 => Backup[])) private backupsOf;

    // repoId => snapshotRoot => archiveSha256 => index + 1  (0 means not found)
    mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => uint256))) public backupIndexByArchive;

    event BackupAnchored(
        bytes32 indexed repoId,
        bytes32 indexed snapshotMerkleRoot,
        bytes32 indexed archiveSha256,
        uint256 backupIndex,
        address author,
        bytes32 metadataSha256,
        string backupCid,
        uint256 timestamp
    );

    modifier onlyRepoOwnerOrDelegated(bytes32 repoId, address author) {
        address owner = registry.repoOwner(repoId);
        require(owner != address(0), "repo not claimed");

        bool isOwner = (author == owner);
        bool isDelegated = delegation.isAuthorized(owner, msg.sender, delegation.SCOPE_BACKUP(), repoId);

        require(isOwner || isDelegated, "not authorized");
        _;
    }

    constructor(
        address initialOwner,
        address registryAddr,
        address delegationAddr,
        address snapshotAddr
    ) Ownable(initialOwner) {
        require(registryAddr != address(0) && delegationAddr != address(0) && snapshotAddr != address(0), "zero addr");
        registry = ICodeQuillRegistry(registryAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
        snapshot = ICodeQuillSnapshot(snapshotAddr);
    }

    /// @notice Anchor a backup record for a snapshot root.
    /// @dev Only callable by backend relayer (owner). Authorization is checked against repo owner/delegation.
    /// @param metadataSha256 Optional sha256 of backup_metadata JSON (set to bytes32(0) if unused)
    /// @param backupCid Optional encrypted blob CID / locator (can be empty to reduce on-chain leakage)
    function anchorBackup(
        bytes32 repoId,
        bytes32 snapshotMerkleRoot,
        bytes32 archiveSha256,
        bytes32 metadataSha256,
        string calldata backupCid,
        address author
    )
    external
    onlyOwner
    onlyRepoOwnerOrDelegated(repoId, author)
    {
        require(snapshotMerkleRoot != bytes32(0), "zero snapshot root");
        require(archiveSha256 != bytes32(0), "zero archive sha");

        // Require the snapshot exists on-chain
        uint256 snapIdx1 = snapshot.snapshotIndexByRoot(repoId, snapshotMerkleRoot);
        require(snapIdx1 != 0, "snapshot not found");

        // Prevent duplicates for (repoId, snapshotRoot, archiveSha256)
        require(backupIndexByArchive[repoId][snapshotMerkleRoot][archiveSha256] == 0, "duplicate backup");

        uint256 idx = backupsOf[repoId][snapshotMerkleRoot].length;

        backupsOf[repoId][snapshotMerkleRoot].push(
            Backup({
                snapshotMerkleRoot: snapshotMerkleRoot,
                archiveSha256: archiveSha256,
                metadataSha256: metadataSha256,
                backupCid: backupCid,
                timestamp: block.timestamp,
                author: author
            })
        );

        backupIndexByArchive[repoId][snapshotMerkleRoot][archiveSha256] = idx + 1;

        emit BackupAnchored(
            repoId,
            snapshotMerkleRoot,
            archiveSha256,
            idx,
            author,
            metadataSha256,
            backupCid,
            block.timestamp
        );
    }

    /// @notice Number of backups anchored for a given (repoId, snapshotRoot).
    function getBackupsCount(bytes32 repoId, bytes32 snapshotMerkleRoot) external view returns (uint256) {
        return backupsOf[repoId][snapshotMerkleRoot].length;
    }

    /// @notice Read a backup by index for a given (repoId, snapshotRoot).
    function getBackup(bytes32 repoId, bytes32 snapshotMerkleRoot, uint256 index)
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
        require(index < backupsOf[repoId][snapshotMerkleRoot].length, "invalid index");
        Backup storage b = backupsOf[repoId][snapshotMerkleRoot][index];
        return (b.archiveSha256, b.metadataSha256, b.backupCid, b.timestamp, b.author);
    }

    /// @notice Read a backup by (repoId, snapshotRoot, archiveSha256).
    function getBackupByArchive(bytes32 repoId, bytes32 snapshotMerkleRoot, bytes32 archiveSha256)
    external
    view
    returns (
        bytes32 metadataSha256,
        string memory backupCid,
        uint256 timestamp,
        address author,
        uint256 index
    )
    {
        uint256 idx1 = backupIndexByArchive[repoId][snapshotMerkleRoot][archiveSha256];
        require(idx1 != 0, "not found");
        Backup storage b = backupsOf[repoId][snapshotMerkleRoot][idx1 - 1];
        return (b.metadataSha256, b.backupCid, b.timestamp, b.author, idx1 - 1);
    }
}