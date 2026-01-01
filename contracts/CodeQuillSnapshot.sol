
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICodeQuillRegistry {
    function repoOwner(bytes32 repoId) external view returns (address);
}

interface ICodeQuillDelegation {
    function SCOPE_SNAPSHOT() external view returns (uint256);
    function isAuthorized(address owner_, address relayer_, uint256 scope, bytes32 repoId) external view returns (bool);
}

/// @title CodeQuillSnapshot - lightweight snapshot via merkle roots + off-chain manifest
contract CodeQuillSnapshotRegistry is Ownable {
    ICodeQuillRegistry public immutable registry;
    ICodeQuillDelegation public immutable delegation;

    struct Snapshot {
        bytes32 commitHash;      // git commit
        bytes32 merkleRoot;      // merkle tree root of all file hashes
        string  manifestCid;     // IPFS CID of JSON manifest with file list
        uint256 timestamp;
        address author;
        uint256 fileCount;       // for UI display
    }

    // repoId → snapshots[]
    mapping(bytes32 => Snapshot[]) private snapshotsOf;

    // repoId → merkleRoot → snapshot index + 1
    mapping(bytes32 => mapping(bytes32 => uint256)) public snapshotIndexByRoot;

    event SnapshotCreated(
        bytes32 indexed repoId,
        uint256 indexed snapshotIndex,
        address indexed author,
        bytes32 commitHash,
        bytes32 merkleRoot,
        string manifestCid,
        uint256 timestamp,
        uint256 fileCount
    );

    modifier onlyRepoOwnerOrDelegated(bytes32 repoId, address author) {
        address owner = registry.repoOwner(repoId);
        require(owner != address(0), "repo not claimed");
        bool isOwner = (author == owner);
        bool isDelegated = delegation.isAuthorized(owner, msg.sender, delegation.SCOPE_SNAPSHOT(), repoId);
        require(isOwner || isDelegated, "not authorized");
        _;
    }

    constructor(address initialOwner, address registryAddr, address delegationAddr)
    Ownable(initialOwner) {
        require(registryAddr != address(0) && delegationAddr != address(0), "zero addr");
        registry = ICodeQuillRegistry(registryAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
    }

    /// @notice Create a snapshot
    function createSnapshot(
        bytes32 repoId,
        bytes32 commitHash,
        bytes32 merkleRoot,
        string calldata manifestCid,
        address author,
        uint256 fileCount
    )
    external
    onlyOwner
    onlyRepoOwnerOrDelegated(repoId, author)
    {
        require(merkleRoot != bytes32(0), "zero root");
        require(bytes(manifestCid).length > 0, "empty CID");
        require(snapshotIndexByRoot[repoId][merkleRoot] == 0, "duplicate root");

        uint256 idx = snapshotsOf[repoId].length;

        snapshotsOf[repoId].push(Snapshot({
            commitHash: commitHash,
            merkleRoot: merkleRoot,
            manifestCid: manifestCid,
            timestamp: block.timestamp,
            author: author,
            fileCount: fileCount
        }));

        snapshotIndexByRoot[repoId][merkleRoot] = idx + 1;

        emit SnapshotCreated(repoId, idx, author, commitHash, merkleRoot, manifestCid, block.timestamp, fileCount);
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
        address author,
        uint256 fileCount
    )
    {
        require(index < snapshotsOf[repoId].length, "invalid index");
        Snapshot storage s = snapshotsOf[repoId][index];
        return (s.commitHash, s.merkleRoot, s.manifestCid, s.timestamp, s.author, s.fileCount);
    }

    function getSnapshotByRoot(bytes32 repoId, bytes32 merkleRoot)
    external
    view
    returns (
        bytes32 commitHash,
        string memory manifestCid,
        uint256 timestamp,
        address author,
        uint256 index,
        uint256 fileCount
    )
    {
        uint256 idx1 = snapshotIndexByRoot[repoId][merkleRoot];
        require(idx1 != 0, "not found");
        Snapshot storage s = snapshotsOf[repoId][idx1 - 1];
        return (s.commitHash, s.manifestCid, s.timestamp, s.author, idx1 - 1, s.fileCount);
    }
}