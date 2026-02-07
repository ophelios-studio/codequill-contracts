// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICodeQuillWorkspaceRegistry {
    function isMember(bytes32 contextId, address wallet) external view returns (bool);
}

interface ICodeQuillDelegation {
    function SCOPE_ATTEST() external view returns (uint256);

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 contextId
    ) external view returns (bool);
}

interface ICodeQuillReleaseRegistry {
    enum GouvernanceStatus { PENDING, ACCEPTED, REJECTED }

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
    );
}

/// @title CodeQuillAttestationRegistry
/// @notice Registry for attestations (sha256 artifact digests) bound to an on-chain release.
/// @dev Uniqueness is keyed by (releaseId, artifactDigest).
contract CodeQuillAttestationRegistry is Ownable {
    ICodeQuillWorkspaceRegistry public immutable workspace;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillReleaseRegistry public immutable releaseRegistry;

    struct Attestation {
        bytes32 releaseId;      // release id (must exist in CodeQuillReleaseRegistry)
        bytes32 artifactDigest; // sha256 digest of attested artifact bytes
        string  attestationCid; // IPFS CID of privacy-safe attestation JSON
        uint256 timestamp;      // block.timestamp
        address author;         // workspace member (recorded)
        bool    revoked;        // whether this attestation has been revoked
    }

    mapping(bytes32 => Attestation[]) private attestationsByRelease;
    mapping(bytes32 => mapping(bytes32 => uint256)) public attestationIndexByReleaseDigest;

    event AttestationCreated(
        uint256 indexed attestationIndex,
        address indexed author,
        bytes32 indexed releaseId,
        bytes32 artifactDigest,
        string attestationCid,
        uint256 timestamp
    );

    event AttestationRevoked(
        bytes32 indexed releaseId,
        bytes32 indexed artifactDigest,
        address revokedBy,
        uint256 timestamp
    );

    constructor(
        address initialOwner,
        address workspaceAddr,
        address delegationAddr,
        address releaseRegistryAddr
    ) Ownable(initialOwner) {
        require(workspaceAddr != address(0), "zero workspace");
        require(delegationAddr != address(0), "zero delegation");
        require(releaseRegistryAddr != address(0), "zero releaseRegistry");

        workspace = ICodeQuillWorkspaceRegistry(workspaceAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
        releaseRegistry = ICodeQuillReleaseRegistry(releaseRegistryAddr);
    }

    /// @dev author must be self OR delegated, and must be a member of the release contextId.
    modifier onlySelfOrDelegatedMember(address author, bytes32 contextId) {
        require(contextId != bytes32(0), "zero context");
        require(author != address(0), "zero author");
        require(workspace.isMember(contextId, author), "author not member");

        if (msg.sender == author) {
            _;
            return;
        }

        bool ok = delegation.isAuthorized(author, msg.sender, delegation.SCOPE_ATTEST(), contextId);
        require(ok, "not authorized");
        _;
    }

    function createAttestation(
        bytes32 releaseId,
        bytes32 artifactDigest,
        string calldata attestationCid,
        address author
    ) external {
        require(releaseId != bytes32(0), "zero releaseId");
        require(artifactDigest != bytes32(0), "zero digest");
        require(bytes(attestationCid).length > 0, "empty CID");

        bytes32 id;
        bytes32 contextId;
        bool revoked;
        ICodeQuillReleaseRegistry.GouvernanceStatus status;
        address ignoredStatusAuthor;

        // Destructure only what we actually need.
        (id,, contextId, , , , , , , revoked, status, , ignoredStatusAuthor) = releaseRegistry
            .getReleaseById(releaseId);
        ignoredStatusAuthor;

        require(id != bytes32(0), "release not found");
        require(!revoked, "release revoked");
        require(status == ICodeQuillReleaseRegistry.GouvernanceStatus.ACCEPTED, "release not accepted");

        // enforce delegation + membership against the release context
        _requireSelfOrDelegatedMember(author, contextId);

        require(attestationIndexByReleaseDigest[releaseId][artifactDigest] == 0, "duplicate attestation");

        uint256 idx = attestationsByRelease[releaseId].length;

        attestationsByRelease[releaseId].push(
            Attestation({
                releaseId: releaseId,
                artifactDigest: artifactDigest,
                attestationCid: attestationCid,
                timestamp: block.timestamp,
                author: author,
                revoked: false
            })
        );

        attestationIndexByReleaseDigest[releaseId][artifactDigest] = idx + 1;

        emit AttestationCreated(
            idx,
            author,
            releaseId,
            artifactDigest,
            attestationCid,
            block.timestamp
        );
    }

    function revokeAttestation(
        bytes32 releaseId,
        bytes32 artifactDigest,
        address author
    ) external {
        require(releaseId != bytes32(0), "zero releaseId");
        require(artifactDigest != bytes32(0), "zero digest");

        uint256 idx1 = attestationIndexByReleaseDigest[releaseId][artifactDigest];
        require(idx1 != 0, "not found");

        // get release context to enforce membership + delegation
        bytes32 contextId;
        address ignoredStatusAuthor;
        (,, contextId, , , , , , , , , , ignoredStatusAuthor) = releaseRegistry.getReleaseById(
            releaseId
        );
        ignoredStatusAuthor;
        require(contextId != bytes32(0), "release not found");

        _requireSelfOrDelegatedMember(author, contextId);

        Attestation storage a = attestationsByRelease[releaseId][idx1 - 1];
        require(!a.revoked, "already revoked");

        a.revoked = true;

        emit AttestationRevoked(
            releaseId,
            artifactDigest,
            author,
            block.timestamp
        );
    }

    function _requireSelfOrDelegatedMember(address author, bytes32 contextId) internal view {
        require(contextId != bytes32(0), "zero context");
        require(author != address(0), "zero author");
        require(workspace.isMember(contextId, author), "author not member");

        if (msg.sender == author) return;

        bool ok = delegation.isAuthorized(author, msg.sender, delegation.SCOPE_ATTEST(), contextId);
        require(ok, "not authorized");
    }

    function isRevoked(bytes32 releaseId, bytes32 artifactDigest) external view returns (bool) {
        uint256 idx1 = attestationIndexByReleaseDigest[releaseId][artifactDigest];
        if (idx1 == 0) return false;
        return attestationsByRelease[releaseId][idx1 - 1].revoked;
    }

    function getAttestationsCount(bytes32 releaseId) external view returns (uint256) {
        return attestationsByRelease[releaseId].length;
    }

    function getAttestation(bytes32 releaseId, uint256 index)
    external
    view
    returns (
        bytes32 artifactDigest,
        string memory attestationCid,
        uint256 timestamp,
        address author,
        bool revoked
    )
    {
        require(index < attestationsByRelease[releaseId].length, "invalid index");
        Attestation storage a = attestationsByRelease[releaseId][index];
        return (a.artifactDigest, a.attestationCid, a.timestamp, a.author, a.revoked);
    }

    function getAttestationByDigest(bytes32 releaseId, bytes32 artifactDigest)
    external
    view
    returns (
        string memory attestationCid,
        uint256 timestamp,
        address author,
        uint256 index,
        bool revoked
    )
    {
        uint256 idx1 = attestationIndexByReleaseDigest[releaseId][artifactDigest];
        require(idx1 != 0, "not found");

        Attestation storage a = attestationsByRelease[releaseId][idx1 - 1];
        return (a.attestationCid, a.timestamp, a.author, idx1 - 1, a.revoked);
    }
}