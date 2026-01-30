// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICodeQuillRegistry {
    function repoOwner(bytes32 repoId) external view returns (address);
}

interface ICodeQuillDelegation {
    function SCOPE_ATTEST() external view returns (uint256);
    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 repoId
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
            string memory manifestCid,
            string memory name,
            uint256 timestamp,
            address author,
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
    ICodeQuillRegistry public immutable registry;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillReleaseRegistry public immutable releaseRegistry;

    struct Attestation {
        bytes32 releaseId;          // release id (must exist in CodeQuillReleaseRegistry)
        bytes32 artifactDigest;     // sha256 digest of attested artifact bytes
        string  attestationCid;     // IPFS CID of privacy-safe attestation JSON
        uint256 timestamp;          // block.timestamp
        address author;             // authority wallet passed by backend
        bool    revoked;            // whether this attestation has been revoked
    }

    // releaseId => attestations[]
    mapping(bytes32 => Attestation[]) private attestationsByRelease;

    // Uniqueness index:
    // releaseId => digest => attestation index + 1
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
        address registryAddr,
        address delegationAddr,
        address releaseRegistryAddr
    ) Ownable(initialOwner) {
        require(registryAddr != address(0) && delegationAddr != address(0) && releaseRegistryAddr != address(0), "zero addr");
        registry = ICodeQuillRegistry(registryAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
        releaseRegistry = ICodeQuillReleaseRegistry(releaseRegistryAddr);
    }

    /// @notice Create an attestation for an artifact digest, linked to an existing release.
    /// @dev Only callable by backend relayer (owner). Authorization is checked for all repos in the release.
    function createAttestation(
        bytes32 releaseId,
        bytes32 artifactDigest,      // sha256 digest (32 bytes)
        string calldata attestationCid,
        address author               // authority wallet, validated against repo owners
    )
    external
    onlyOwner
    {
        require(releaseId != bytes32(0), "zero releaseId");
        require(artifactDigest != bytes32(0), "zero digest");
        require(bytes(attestationCid).length > 0, "empty CID");

        // Require the release exists
        (bytes32 id, , , , , address rAuthor, , bool revoked, ICodeQuillReleaseRegistry.GouvernanceStatus status, , ) = releaseRegistry.getReleaseById(releaseId);
        require(id != bytes32(0), "release not found");
        require(!revoked, "release revoked");
        require(status == ICodeQuillReleaseRegistry.GouvernanceStatus.ACCEPTED, "release not accepted");

        // Validate author permission: must be release author or delegated by them for this release
        bool isReleaseAuthor = (author == rAuthor);
        bool isDelegated = delegation.isAuthorized(rAuthor, author, delegation.SCOPE_ATTEST(), releaseId);
        require(isReleaseAuthor || isDelegated, "not authorized");

        // Prevent duplicates for (releaseId, digest)
        require(
            attestationIndexByReleaseDigest[releaseId][artifactDigest] == 0,
            "duplicate attestation"
        );

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

    /// @notice Revoke an existing attestation key (releaseId, digest).
    /// @dev Records revocation state; does not delete. Only callable by backend relayer (owner).
    function revokeAttestation(
        bytes32 releaseId,
        bytes32 artifactDigest,
        address author
    )
    external
    onlyOwner
    {
        require(releaseId != bytes32(0), "zero releaseId");
        require(artifactDigest != bytes32(0), "zero digest");

        uint256 idx1 = attestationIndexByReleaseDigest[releaseId][artifactDigest];
        require(idx1 != 0, "not found");

        // Validate author permission: must be release author or delegated by them for this release
        (,,,,, address rAuthor,,,,,) = releaseRegistry.getReleaseById(releaseId);
        bool isReleaseAuthor = (author == rAuthor);
        bool isDelegated = delegation.isAuthorized(rAuthor, author, delegation.SCOPE_ATTEST(), releaseId);
        require(isReleaseAuthor || isDelegated, "not authorized");

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

    function isRevoked(bytes32 releaseId, bytes32 artifactDigest)
    external
    view
    returns (bool)
    {
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
        return (
            a.artifactDigest,
            a.attestationCid,
            a.timestamp,
            a.author,
            a.revoked
        );
    }

    /// @notice Fetch an attestation by its key (releaseId, digest), plus revocation info.
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

        return (
            a.attestationCid,
            a.timestamp,
            a.author,
            idx1 - 1,
            a.revoked
        );
    }
}