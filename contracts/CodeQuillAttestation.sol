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
            bool revoked
        );
}

/// @title CodeQuillAttestationRegistry
/// @notice Registry for attestations (sha256 artifact digests) bound to an on-chain release.
/// @dev Uniqueness + revocations are keyed by (projectId, releaseId, artifactDigest).
///      We still store artifactType as metadata, but it is NOT part of the key.
contract CodeQuillAttestationRegistry is Ownable {
    ICodeQuillRegistry public immutable registry;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillReleaseRegistry public immutable releaseRegistry;

    // Keep v1 open-ended: types are just uint8 labels interpreted by off-chain tooling.
    // Suggested mapping (not enforced on-chain):
    // 0=file, 1=docker, 2=npm, 3=pip, 4=composer, 255=other
    struct Attestation {
        bytes32 releaseId;          // release id (must exist in CodeQuillReleaseRegistry)
        bytes32 artifactDigest;     // sha256 digest of attested artifact bytes
        uint8   artifactType;       // metadata label (NOT part of uniqueness key)
        string  attestationCid;     // IPFS CID of privacy-safe attestation JSON
        uint256 timestamp;          // block.timestamp
        address author;             // authority wallet passed by backend
    }

    // Revocation metadata (optional but helpful)
    // reason codes are NOT enforced; interpret off-chain.
    // Suggested mapping:
    // 0=unspecified, 1=compromised_key, 2=mistake, 3=superseded, 4=policy
    struct Revocation {
        bool    revoked;
        uint8   reason;
        uint256 timestamp;
        address revokedBy;          // authority wallet provided by backend (owner/delegated)
        string  noteCid;            // optional CID with public explanation / replacement pointer
    }

    // projectId => attestations[]
    mapping(bytes32 => Attestation[]) private attestationsOf;

    // Uniqueness index:
    // projectId => releaseId => digest => attestation index + 1
    mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => uint256)))
    public attestationIndexByReleaseDigest;

    // projectId => releaseId => digest => revocation info
    mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => Revocation)))
    private revocationsByKey;

    event AttestationCreated(
        bytes32 indexed projectId,
        uint256 indexed attestationIndex,
        address indexed author,
        bytes32 releaseId,
        bytes32 artifactDigest,
        uint8 artifactType,
        string attestationCid,
        uint256 timestamp
    );

    event AttestationRevoked(
        bytes32 indexed projectId,
        bytes32 indexed releaseId,
        bytes32 indexed artifactDigest,
        address revokedBy,
        uint8 reason,
        string noteCid,
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
        bytes32 projectId,
        bytes32 releaseId,
        bytes32 artifactDigest,      // sha256 digest (32 bytes)
        uint8 artifactType,          // metadata only (NOT part of uniqueness)
        string calldata attestationCid,
        address author               // authority wallet, validated against repo owners
    )
    external
    onlyOwner
    {
        require(releaseId != bytes32(0), "zero releaseId");
        require(artifactDigest != bytes32(0), "zero digest");
        require(bytes(attestationCid).length > 0, "empty CID");

        // Require the release exists and belongs to project
        (bytes32 id, bytes32 pId, , , , address rAuthor, , bool revoked) = releaseRegistry.getReleaseById(releaseId);
        require(id != bytes32(0), "release not found");
        require(pId == projectId, "mismatched project");
        require(!revoked, "release revoked");

        // Validate author permission: must be release author or delegated by them for this release
        bool isReleaseAuthor = (author == rAuthor);
        bool isDelegated = delegation.isAuthorized(rAuthor, author, delegation.SCOPE_ATTEST(), releaseId);
        require(isReleaseAuthor || isDelegated, "not authorized");

        // Prevent duplicates for (projectId, releaseId, digest)
        require(
            attestationIndexByReleaseDigest[projectId][releaseId][artifactDigest] == 0,
            "duplicate attestation"
        );

        uint256 idx = attestationsOf[projectId].length;

        attestationsOf[projectId].push(
            Attestation({
                releaseId: releaseId,
                artifactDigest: artifactDigest,
                artifactType: artifactType,
                attestationCid: attestationCid,
                timestamp: block.timestamp,
                author: author
            })
        );

        attestationIndexByReleaseDigest[projectId][releaseId][artifactDigest] = idx + 1;

        emit AttestationCreated(
            projectId,
            idx,
            author,
            releaseId,
            artifactDigest,
            artifactType,
            attestationCid,
            block.timestamp
        );
    }

    /// @notice Revoke an existing attestation key (projectId, releaseId, digest).
    /// @dev Records revocation state; does not delete. Only callable by backend relayer (owner).
    /// @param noteCid Optional CID to a public note (explanation / replacement reference).
    function revokeAttestation(
        bytes32 projectId,
        bytes32 releaseId,
        bytes32 artifactDigest,
        uint8 reason,
        string calldata noteCid,
        address author
    )
    external
    onlyOwner
    {
        require(releaseId != bytes32(0), "zero releaseId");
        require(artifactDigest != bytes32(0), "zero digest");

        uint256 idx1 = attestationIndexByReleaseDigest[projectId][releaseId][artifactDigest];
        require(idx1 != 0, "not found");

        // Validate author permission: must be release author or delegated by them for this release
        (,,,,, address rAuthor,,) = releaseRegistry.getReleaseById(releaseId);
        bool isReleaseAuthor = (author == rAuthor);
        bool isDelegated = delegation.isAuthorized(rAuthor, author, delegation.SCOPE_ATTEST(), releaseId);
        require(isReleaseAuthor || isDelegated, "not authorized");

        Revocation storage r = revocationsByKey[projectId][releaseId][artifactDigest];
        require(!r.revoked, "already revoked");

        r.revoked = true;
        r.reason = reason;
        r.timestamp = block.timestamp;
        r.revokedBy = author;
        r.noteCid = noteCid;

        emit AttestationRevoked(
            projectId,
            releaseId,
            artifactDigest,
            author,
            reason,
            noteCid,
            block.timestamp
        );
    }

    /// @notice Returns whether a given attestation key is revoked + metadata.
    function getRevocation(bytes32 projectId, bytes32 releaseId, bytes32 artifactDigest)
    external
    view
    returns (
        bool revoked,
        uint8 reason,
        uint256 timestamp,
        address revokedBy,
        string memory noteCid
    )
    {
        Revocation storage r = revocationsByKey[projectId][releaseId][artifactDigest];
        return (r.revoked, r.reason, r.timestamp, r.revokedBy, r.noteCid);
    }

    function isRevoked(bytes32 projectId, bytes32 releaseId, bytes32 artifactDigest)
    external
    view
    returns (bool)
    {
        return revocationsByKey[projectId][releaseId][artifactDigest].revoked;
    }

    function getAttestationsCount(bytes32 projectId) external view returns (uint256) {
        return attestationsOf[projectId].length;
    }

    function getAttestation(bytes32 projectId, uint256 index)
    external
    view
    returns (
        bytes32 releaseId,
        bytes32 artifactDigest,
        uint8 artifactType,
        string memory attestationCid,
        uint256 timestamp,
        address author
    )
    {
        require(index < attestationsOf[projectId].length, "invalid index");
        Attestation storage a = attestationsOf[projectId][index];
        return (
            a.releaseId,
            a.artifactDigest,
            a.artifactType,
            a.attestationCid,
            a.timestamp,
            a.author
        );
    }

    /// @notice Fetch an attestation by its key (projectId, releaseId, digest), plus revocation info.
    function getAttestationByDigest(bytes32 projectId, bytes32 releaseId, bytes32 artifactDigest)
    external
    view
    returns (
        string memory attestationCid,
        uint256 timestamp,
        address author,
        uint256 index,
        uint8 artifactType,
        bool revoked,
        uint8 revocationReason,
        uint256 revokedAt,
        address revokedBy,
        string memory revocationNoteCid
    )
    {
        uint256 idx1 = attestationIndexByReleaseDigest[projectId][releaseId][artifactDigest];
        require(idx1 != 0, "not found");

        Attestation storage a = attestationsOf[projectId][idx1 - 1];
        Revocation storage r = revocationsByKey[projectId][releaseId][artifactDigest];

        return (
            a.attestationCid,
            a.timestamp,
            a.author,
            idx1 - 1,
            a.artifactType,
            r.revoked,
            r.reason,
            r.timestamp,
            r.revokedBy,
            r.noteCid
        );
    }
}