// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICodeQuillRepositoryRegistry {
    function repoOwner(bytes32 repoId) external view returns (address);
    function repoContextId(bytes32 repoId) external view returns (bytes32);
}

interface ICodeQuillWorkspaceRegistry {
    function isMember(bytes32 contextId, address wallet) external view returns (bool);
}

interface ICodeQuillDelegation {
    function SCOPE_RELEASE() external view returns (uint256);

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 contextId
    ) external view returns (bool);
}

interface ICodeQuillSnapshotRegistry {
    function snapshotIndexByRoot(bytes32 repoId, bytes32 merkleRoot) external view returns (uint256);
}

/**
 * @title CodeQuillReleaseRegistry
 * @notice Anchors immutable records of project releases referencing snapshots with governance status.
 *
 * Hard guarantees (no backend trust):
 * - Release is bound to contextId (workspace).
 * - author + governanceAuthority must be workspace members for that contextId.
 * - Repos referenced must belong to the same contextId.
 * - Multi-owner releases are allowed, but only if the author is a workspace member.
 *   (Repo ownership is NOT required to build a release, by design.)
 *
 * Note:
 * - If you later want stronger repo-level authorization, add a rule in the loop.
 */
contract CodeQuillReleaseRegistry is Ownable {
    ICodeQuillRepositoryRegistry public immutable registry;
    ICodeQuillWorkspaceRegistry public immutable workspace;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillSnapshotRegistry public immutable snapshotRegistry;

    enum GouvernanceStatus { PENDING, ACCEPTED, REJECTED }

    struct Release {
        bytes32 id;
        bytes32 projectId;
        bytes32 contextId;
        string manifestCid;
        string name;
        uint256 timestamp;
        address author;
        address governanceAuthority;
        bytes32 supersededBy;
        bool revoked;
        GouvernanceStatus status;
        uint256 statusTimestamp;
        address statusAuthor;
    }

    mapping(bytes32 => Release) public releaseById;
    mapping(bytes32 => bytes32[]) private releasesOfProject;
    mapping(bytes32 => mapping(bytes32 => uint256)) public releaseIndexInProject;

    /// @notice Aragon DAO executor address allowed to accept/reject. address(0) means "DAO not configured".
    address public daoExecutor;

    event ReleaseAnchored(
        bytes32 indexed projectId,
        bytes32 indexed releaseId,
        bytes32 indexed contextId,
        address author,
        address governanceAuthority,
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

    event DaoExecutorSet(address indexed daoExecutor);

    constructor(
        address initialOwner,
        address registryAddr,
        address workspaceAddr,
        address delegationAddr,
        address snapshotRegistryAddr
    ) Ownable(initialOwner) {
        require(registryAddr != address(0), "zero registry");
        require(workspaceAddr != address(0), "zero workspace");
        require(delegationAddr != address(0), "zero delegation");
        require(snapshotRegistryAddr != address(0), "zero snapshotRegistry");

        registry = ICodeQuillRepositoryRegistry(registryAddr);
        workspace = ICodeQuillWorkspaceRegistry(workspaceAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
        snapshotRegistry = ICodeQuillSnapshotRegistry(snapshotRegistryAddr);
    }

    function setDaoExecutor(address daoExecutor_) external onlyOwner {
        daoExecutor = daoExecutor_;
        emit DaoExecutorSet(daoExecutor_);
    }

    modifier onlySelfOrDelegated(address authority, uint256 scope, bytes32 contextId) {
        require(contextId != bytes32(0), "zero context");
        if (msg.sender == authority) {
            _;
            return;
        }
        bool ok = delegation.isAuthorized(authority, msg.sender, scope, contextId);
        require(ok, "not authorized");
        _;
    }

    modifier onlyGovernance(bytes32 releaseId) {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");

        address exec = daoExecutor;
        if (exec != address(0) && msg.sender == exec) {
            _;
            return;
        }

        uint256 scope = delegation.SCOPE_RELEASE();
        if (msg.sender == r.governanceAuthority) {
            _;
            return;
        }

        bool ok = delegation.isAuthorized(r.governanceAuthority, msg.sender, scope, r.contextId);
        require(ok, "not governance");
        _;
    }

    function anchorRelease(
        bytes32 projectId,
        bytes32 releaseId,
        bytes32 contextId,
        string calldata manifestCid,
        string calldata name,
        address author,
        address governanceAuthority,
        bytes32[] calldata repoIds,
        bytes32[] calldata merkleRoots
    ) external onlySelfOrDelegated(author, delegation.SCOPE_RELEASE(), contextId) {
        require(projectId != bytes32(0), "zero projectId");
        require(releaseId != bytes32(0), "zero releaseId");
        require(releaseById[releaseId].timestamp == 0, "duplicate releaseId");
        require(repoIds.length > 0, "no snapshots");
        require(repoIds.length == merkleRoots.length, "length mismatch");
        require(bytes(manifestCid).length > 0, "empty CID");
        require(author != address(0), "zero author");
        require(governanceAuthority != address(0), "zero governanceAuthority");

        // NEW: author + governanceAuthority must be members of the workspace context
        require(workspace.isMember(contextId, author), "author not member");
        require(workspace.isMember(contextId, governanceAuthority), "governance not member");

        // Validate each snapshot and ensure repo belongs to same context
        for (uint256 i = 0; i < repoIds.length; i++) {
            bytes32 repoId = repoIds[i];
            bytes32 root = merkleRoots[i];

            require(snapshotRegistry.snapshotIndexByRoot(repoId, root) > 0, "snapshot not found");

            address rOwner = registry.repoOwner(repoId);
            require(rOwner != address(0), "repo not claimed");

            bytes32 repoCtx = registry.repoContextId(repoId);
            require(repoCtx == contextId, "repo wrong context");
        }

        releaseById[releaseId] = Release({
            id: releaseId,
            projectId: projectId,
            contextId: contextId,
            manifestCid: manifestCid,
            name: name,
            timestamp: block.timestamp,
            author: author,
            governanceAuthority: governanceAuthority,
            supersededBy: bytes32(0),
            revoked: false,
            status: GouvernanceStatus.PENDING,
            statusTimestamp: block.timestamp,
            statusAuthor: address(0)
        });

        releasesOfProject[projectId].push(releaseId);
        releaseIndexInProject[projectId][releaseId] = releasesOfProject[projectId].length;

        emit ReleaseAnchored(
            projectId,
            releaseId,
            contextId,
            author,
            governanceAuthority,
            manifestCid,
            name,
            block.timestamp
        );
    }

    function accept(bytes32 releaseId) external onlyGovernance(releaseId) {
        Release storage r = releaseById[releaseId];
        require(r.status == GouvernanceStatus.PENDING, "not in pending status");
        require(!r.revoked, "release revoked");

        r.status = GouvernanceStatus.ACCEPTED;
        r.statusTimestamp = block.timestamp;
        r.statusAuthor = msg.sender;

        emit GouvernanceStatusChanged(releaseId, GouvernanceStatus.ACCEPTED, msg.sender, block.timestamp);
    }

    function reject(bytes32 releaseId) external onlyGovernance(releaseId) {
        Release storage r = releaseById[releaseId];
        require(r.status == GouvernanceStatus.PENDING, "not in pending status");
        require(!r.revoked, "release revoked");

        r.status = GouvernanceStatus.REJECTED;
        r.statusTimestamp = block.timestamp;
        r.statusAuthor = msg.sender;

        emit GouvernanceStatusChanged(releaseId, GouvernanceStatus.REJECTED, msg.sender, block.timestamp);
    }

    function revokeRelease(bytes32 projectId, bytes32 releaseId, address author) external {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");
        require(r.projectId == projectId, "release not in project");
        require(r.author == author, "mismatched author");

        uint256 scope = delegation.SCOPE_RELEASE();
        if (msg.sender != author) {
            bool ok = delegation.isAuthorized(author, msg.sender, scope, r.contextId);
            require(ok, "not authorized");
        }

        r.revoked = true;
        emit ReleaseRevoked(projectId, releaseId, author, block.timestamp);
    }

    function supersedeRelease(bytes32 projectId, bytes32 oldReleaseId, bytes32 newReleaseId, address author) external {
        Release storage oldR = releaseById[oldReleaseId];
        require(oldR.timestamp != 0, "old release not found");
        require(oldR.projectId == projectId, "old release not in project");

        Release storage newR = releaseById[newReleaseId];
        require(newR.timestamp != 0, "new release not found");
        require(newR.projectId == projectId, "new release not in project");

        require(oldR.revoked, "old release must be revoked");
        require(oldR.supersededBy == bytes32(0), "already superseded");
        require(oldR.author == author, "mismatched author");

        uint256 scope = delegation.SCOPE_RELEASE();
        if (msg.sender != author) {
            bool ok = delegation.isAuthorized(author, msg.sender, scope, oldR.contextId);
            require(ok, "not authorized");
        }

        oldR.supersededBy = newReleaseId;
        emit ReleaseSuperseded(projectId, oldReleaseId, newReleaseId, author, block.timestamp);
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
        bytes32 contextId,
        string memory manifestCid,
        string memory name,
        uint256 timestamp,
        address author,
        address governanceAuthority,
        bytes32 supersededBy,
        bool revoked,
        GouvernanceStatus status,
        uint256 statusTimestamp,
        address statusAuthor
    )
    {
        require(index < releasesOfProject[projectId].length, "invalid index");
        bytes32 relId = releasesOfProject[projectId][index];
        Release storage r = releaseById[relId];
        return (
            r.id,
            r.projectId,
            r.contextId,
            r.manifestCid,
            r.name,
            r.timestamp,
            r.author,
            r.governanceAuthority,
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
        bytes32 contextId,
        string memory manifestCid,
        string memory name,
        uint256 timestamp,
        address author,
        address governanceAuthority,
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
            r.contextId,
            r.manifestCid,
            r.name,
            r.timestamp,
            r.author,
            r.governanceAuthority,
            r.supersededBy,
            r.revoked,
            r.status,
            r.statusTimestamp,
            r.statusAuthor
        );
    }

    function getGouvernanceStatus(bytes32 releaseId) external view returns (GouvernanceStatus status) {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");
        return r.status;
    }
}