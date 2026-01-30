// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICodeQuillRegistry {
    function repoOwner(bytes32 repoId) external view returns (address);
}

interface ICodeQuillDelegation {
    function SCOPE_RELEASE() external view returns (uint256);
    function isAuthorized(address owner_, address relayer_, uint256 scope, bytes32 repoId) external view returns (bool);
}

interface ICodeQuillSnapshotRegistry {
    function snapshotIndexByRoot(bytes32 repoId, bytes32 merkleRoot) external view returns (uint256);
}

/**
 * @title CodeQuillReleaseRegistry
 * @notice Anchors immutable records of project releases referencing snapshots with governance status.
 */
contract CodeQuillReleaseRegistry is Ownable {
    ICodeQuillRegistry public immutable registry;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillSnapshotRegistry public immutable snapshotRegistry;

    enum GouvernanceStatus { PENDING, ACCEPTED, REJECTED }

    struct Release {
        bytes32 id;              // release id
        bytes32 projectId;       // project identifier (logical grouping)
        string  manifestCid;     // IPFS CID for release manifest
        string  name;            // human label (e.g. "v0.1.0")
        uint256 timestamp;
        address author;          // authority that created it
        bytes32 supersededBy;    // releaseId that replaced it
        bool    revoked;
        GouvernanceStatus status;    // governance status: PENDING, ACCEPTED, REJECTED
        uint256 statusTimestamp; // block.timestamp when status changed
        address statusAuthor;    // who set the status (delegated wallet or app)
    }

    // releaseId -> release
    mapping(bytes32 => Release) public releaseById;

    // projectId -> releaseIds
    mapping(bytes32 => bytes32[]) private releasesOfProject;
    // projectId -> releaseId -> index + 1
    mapping(bytes32 => mapping(bytes32 => uint256)) public releaseIndexInProject;

    event ReleaseAnchored(
        bytes32 indexed projectId,
        bytes32 indexed releaseId,
        address indexed author,
        string manifestCid,
        string name,
        uint256 timestamp
    );
    event ReleaseSuperseded(
        bytes32 indexed projectId,
        bytes32 indexed oldReleaseId,
        bytes32 indexed newReleaseId,
        address author,
        uint256 timestamp
    );
    event ReleaseRevoked(
        bytes32 indexed projectId,
        bytes32 indexed releaseId,
        address indexed author,
        uint256 timestamp
    );
    event GouvernanceStatusChanged(
        bytes32 indexed releaseId,
        GouvernanceStatus newStatus,
        address indexed statusAuthor,
        uint256 timestamp
    );

    constructor(
        address initialOwner,
        address registryAddr,
        address delegationAddr,
        address snapshotRegistryAddr
    ) Ownable(initialOwner) {
        require(
            registryAddr != address(0) &&
            delegationAddr != address(0) &&
            snapshotRegistryAddr != address(0),
            "zero addr"
        );
        registry = ICodeQuillRegistry(registryAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
        snapshotRegistry = ICodeQuillSnapshotRegistry(snapshotRegistryAddr);
    }

    /**
     * @notice Anchor a new release.
     * @param projectId The project identifier.
     * @param releaseId Unique identifier for the release.
     * @param manifestCid IPFS CID for the release manifest.
     * @param name Optional label or version name.
     * @param author The authority address authoring this release.
     * @param repoIds Repositories included in this release.
     * @param merkleRoots Merkle roots of snapshots included in this release.
     */
    function anchorRelease(
        bytes32 projectId,
        bytes32 releaseId,
        string calldata manifestCid,
        string calldata name,
        address author,
        bytes32[] calldata repoIds,
        bytes32[] calldata merkleRoots
    ) external onlyOwner {
        require(releaseId != bytes32(0), "zero releaseId");
        require(releaseById[releaseId].timestamp == 0, "duplicate releaseId");
        require(repoIds.length > 0, "no snapshots");
        require(repoIds.length == merkleRoots.length, "length mismatch");
        require(bytes(manifestCid).length > 0, "empty CID");

        // Validate each snapshot and author's permission on each repo
        for (uint256 i = 0; i < repoIds.length; i++) {
            bytes32 repoId = repoIds[i];
            bytes32 root = merkleRoots[i];

            // Verify snapshot exists
            require(snapshotRegistry.snapshotIndexByRoot(repoId, root) > 0, "snapshot not found");

            // Verify author has permission on repo
            address rOwner = registry.repoOwner(repoId);
            require(rOwner != address(0), "repo not claimed");

            bool isRepoOwner = (author == rOwner);
            bool isDelegated = delegation.isAuthorized(rOwner, author, delegation.SCOPE_RELEASE(), repoId);
            require(isRepoOwner || isDelegated, "author not authorized for repo");
        }

        // Record release with PENDING status
        Release memory newRelease = Release({
            id: releaseId,
            projectId: projectId,
            manifestCid: manifestCid,
            name: name,
            timestamp: block.timestamp,
            author: author,
            supersededBy: bytes32(0),
            revoked: false,
            status: GouvernanceStatus.PENDING,
            statusTimestamp: block.timestamp,
            statusAuthor: address(0)
        });

        releaseById[releaseId] = newRelease;
        releasesOfProject[projectId].push(releaseId);
        releaseIndexInProject[projectId][releaseId] = releasesOfProject[projectId].length;

        emit ReleaseAnchored(projectId, releaseId, author, manifestCid, name, block.timestamp);
    }

    /**
     * @notice Accept a release (owner or delegated wallet only).
     * @param releaseId The release to accept.
     */
    function accept(
        bytes32 releaseId
    ) external onlyOwner {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");
        require(r.status == GouvernanceStatus.PENDING, "not in pending status");
        require(!r.revoked, "release revoked");

        r.status = GouvernanceStatus.ACCEPTED;
        r.statusTimestamp = block.timestamp;
        r.statusAuthor = msg.sender;

        emit GouvernanceStatusChanged(releaseId, GouvernanceStatus.ACCEPTED, msg.sender, block.timestamp);
    }

    /**
     * @notice Reject a release (owner or delegated wallet only).
     * @param releaseId The release to reject.
     */
    function reject(
        bytes32 releaseId
    ) external onlyOwner {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");
        require(r.status == GouvernanceStatus.PENDING, "not in pending status");
        require(!r.revoked, "release revoked");

        r.status = GouvernanceStatus.REJECTED;
        r.statusTimestamp = block.timestamp;
        r.statusAuthor = msg.sender;

        emit GouvernanceStatusChanged(releaseId, GouvernanceStatus.REJECTED, msg.sender, block.timestamp);
    }

    /**
     * @notice Mark a release as superseded.
     */
    function supersedeRelease(
        bytes32 projectId,
        bytes32 oldReleaseId,
        bytes32 newReleaseId,
        address author
    ) external onlyOwner {
        Release storage oldR = releaseById[oldReleaseId];
        require(oldR.projectId == projectId, "old release not in project");
        require(releaseById[newReleaseId].projectId == projectId, "new release not in project");
        require(oldR.revoked, "old release must be revoked");
        require(oldR.supersededBy == bytes32(0), "already superseded");
        require(oldR.author == author, "mismatched author");

        oldR.supersededBy = newReleaseId;

        emit ReleaseSuperseded(projectId, oldReleaseId, newReleaseId, author, block.timestamp);
    }

    /**
     * @notice Revoke a release.
     */
    function revokeRelease(
        bytes32 projectId,
        bytes32 releaseId,
        address author
    ) external onlyOwner {
        Release storage r = releaseById[releaseId];
        require(r.projectId == projectId, "release not in project");
        require(r.author == author, "mismatched author");

        r.revoked = true;

        emit ReleaseRevoked(projectId, releaseId, author, block.timestamp);
    }

    // ---- Views ----

    function getReleasesCount(bytes32 projectId) external view returns (uint256) {
        return releasesOfProject[projectId].length;
    }

    function getReleaseByIndex(bytes32 projectId, uint256 index)
    external
    view
    returns (
        bytes32 id,
        bytes32 pId,
        string memory manifestCid,
        string memory name,
        uint256 timestamp,
        address author,
        bytes32 supersededBy,
        bool revoked,
        GouvernanceStatus status,
        uint256 statusTimestamp,
        address statusAuthor
    )
    {
        require(index < releasesOfProject[projectId].length, "invalid index");
        bytes32 releaseId = releasesOfProject[projectId][index];
        Release storage r = releaseById[releaseId];
        return (
            r.id,
            r.projectId,
            r.manifestCid,
            r.name,
            r.timestamp,
            r.author,
            r.supersededBy,
            r.revoked,
            r.status,
            r.statusTimestamp,
            r.statusAuthor
        );
    }

    function getReleaseById(bytes32 releaseId)
    external
    view
    returns (
        bytes32 id,
        bytes32 projectId,
        string memory manifestCid,
        string memory name,
        uint256 timestamp,
        address author,
        bytes32 supersededBy,
        bool revoked,
        GouvernanceStatus status,
        uint256 statusTimestamp,
        address statusAuthor
    )
    {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "not found");
        return (
            r.id,
            r.projectId,
            r.manifestCid,
            r.name,
            r.timestamp,
            r.author,
            r.supersededBy,
            r.revoked,
            r.status,
            r.statusTimestamp,
            r.statusAuthor
        );
    }

    /**
     * @notice Get the status of a release.
     */
    function getGouvernanceStatus(bytes32 releaseId)
    external
    view
    returns (GouvernanceStatus status)
    {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");
        return r.status;
    }
}