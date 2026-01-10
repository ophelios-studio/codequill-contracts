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

interface ICodeQuillSnapshot {
    // returns index+1 (0 means not found)
    function snapshotIndexByRoot(bytes32 repoId, bytes32 merkleRoot) external view returns (uint256);
}

/// @title CodeQuillAttestationRegistry
/// @notice Registry for supply-chain attestations (sha256 artifact digests) bound to an on-chain snapshot.
/// @dev Revocations do not delete attestations; they add verifiable "revoked" state keyed by (repoId, digest, type).
contract CodeQuillAttestationRegistry is Ownable {
    ICodeQuillRegistry public immutable registry;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillSnapshot public immutable snapshot;

    // Keep v1 open-ended: types are just uint8 labels interpreted by off-chain tooling.
    // Suggested mapping (not enforced on-chain):
    // 0=file, 1=docker, 2=npm, 3=pip, 4=composer, 255=other
    struct Attestation {
        bytes32 snapshotMerkleRoot; // snapshot merkle root (must exist in CodeQuillSnapshot)
        bytes32 artifactDigest;     // sha256 digest of attested artifact bytes (or canonical bytes for the type)
        uint8   artifactType;       // semantic type label
        string  attestationCid;     // IPFS CID of privacy-safe attestation JSON
        uint256 timestamp;          // block.timestamp
        address author;             // authority wallet (repo owner) passed by backend
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

    // repoId => attestations[]
    mapping(bytes32 => Attestation[]) private attestationsOf;

    // repoId => digest => type => attestation index + 1
    mapping(bytes32 => mapping(bytes32 => mapping(uint8 => uint256))) public attestationIndexByDigest;

    // repoId => digest => type => revocation info
    mapping(bytes32 => mapping(bytes32 => mapping(uint8 => Revocation))) private revocationsByKey;

    event AttestationCreated(
        bytes32 indexed repoId,
        uint256 indexed attestationIndex,
        address indexed author,
        bytes32 snapshotMerkleRoot,
        bytes32 artifactDigest,
        uint8 artifactType,
        string attestationCid,
        uint256 timestamp
    );

    event AttestationRevoked(
        bytes32 indexed repoId,
        bytes32 indexed artifactDigest,
        uint8 indexed artifactType,
        address revokedBy,
        uint8 reason,
        string noteCid,
        uint256 timestamp
    );

    modifier onlyRepoOwnerOrDelegated(bytes32 repoId, address author) {
        address owner = registry.repoOwner(repoId);
        require(owner != address(0), "repo not claimed");

        bool isOwner = (author == owner);
        bool isDelegated = delegation.isAuthorized(owner, msg.sender, delegation.SCOPE_ATTEST(), repoId);

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

    /// @notice Create an attestation for an artifact digest, linked to an existing snapshot merkle root.
    /// @dev Only callable by backend relayer (owner). Authorization is checked against repo owner/delegation.
    function createAttestation(
        bytes32 repoId,
        bytes32 snapshotMerkleRoot,
        bytes32 artifactDigest,      // sha256 digest (32 bytes)
        uint8 artifactType,
        string calldata attestationCid,
        address author               // repo owner wallet (authority), validated
    )
    external
    onlyOwner
    onlyRepoOwnerOrDelegated(repoId, author)
    {
        require(snapshotMerkleRoot != bytes32(0), "zero snapshot root");
        require(artifactDigest != bytes32(0), "zero digest");
        require(bytes(attestationCid).length > 0, "empty CID");

        // Require the snapshot exists on-chain (must be created already)
        uint256 snapIdx1 = snapshot.snapshotIndexByRoot(repoId, snapshotMerkleRoot);
        require(snapIdx1 != 0, "snapshot not found");

        // Prevent duplicates for (repoId, digest, type)
        require(attestationIndexByDigest[repoId][artifactDigest][artifactType] == 0, "duplicate attestation");

        uint256 idx = attestationsOf[repoId].length;

        attestationsOf[repoId].push(
            Attestation({
                snapshotMerkleRoot: snapshotMerkleRoot,
                artifactDigest: artifactDigest,
                artifactType: artifactType,
                attestationCid: attestationCid,
                timestamp: block.timestamp,
                author: author
            })
        );

        attestationIndexByDigest[repoId][artifactDigest][artifactType] = idx + 1;

        // If there was an old revocation entry for this key (e.g., re-attest flows in future),
        // we keep "duplicates" disallowed anyway, so nothing to clear here.

        emit AttestationCreated(
            repoId,
            idx,
            author,
            snapshotMerkleRoot,
            artifactDigest,
            artifactType,
            attestationCid,
            block.timestamp
        );
    }

    /// @notice Revoke an existing attestation key (repoId, digest, type).
    /// @dev Records revocation state; does not delete. Only callable by backend relayer (owner).
    /// @param noteCid Optional CID to a public note (explanation / replacement reference).
    function revokeAttestation(
        bytes32 repoId,
        bytes32 artifactDigest,
        uint8 artifactType,
        uint8 reason,
        string calldata noteCid,
        address author
    )
    external
    onlyOwner
    onlyRepoOwnerOrDelegated(repoId, author)
    {
        require(artifactDigest != bytes32(0), "zero digest");

        uint256 idx1 = attestationIndexByDigest[repoId][artifactDigest][artifactType];
        require(idx1 != 0, "not found");

        Revocation storage r = revocationsByKey[repoId][artifactDigest][artifactType];
        require(!r.revoked, "already revoked");

        r.revoked = true;
        r.reason = reason;
        r.timestamp = block.timestamp;
        r.revokedBy = author;
        r.noteCid = noteCid;

        emit AttestationRevoked(
            repoId,
            artifactDigest,
            artifactType,
            author,
            reason,
            noteCid,
            block.timestamp
        );
    }

    /// @notice Returns whether a given attestation key is revoked + metadata.
    function getRevocation(bytes32 repoId, bytes32 artifactDigest, uint8 artifactType)
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
        Revocation storage r = revocationsByKey[repoId][artifactDigest][artifactType];
        return (r.revoked, r.reason, r.timestamp, r.revokedBy, r.noteCid);
    }

    function isRevoked(bytes32 repoId, bytes32 artifactDigest, uint8 artifactType) external view returns (bool) {
        return revocationsByKey[repoId][artifactDigest][artifactType].revoked;
    }

    function getAttestationsCount(bytes32 repoId) external view returns (uint256) {
        return attestationsOf[repoId].length;
    }

    function getAttestation(bytes32 repoId, uint256 index)
    external
    view
    returns (
        bytes32 snapshotMerkleRoot,
        bytes32 artifactDigest,
        uint8 artifactType,
        string memory attestationCid,
        uint256 timestamp,
        address author
    )
    {
        require(index < attestationsOf[repoId].length, "invalid index");
        Attestation storage a = attestationsOf[repoId][index];
        return (
            a.snapshotMerkleRoot,
            a.artifactDigest,
            a.artifactType,
            a.attestationCid,
            a.timestamp,
            a.author
        );
    }

    function getAttestationByDigest(bytes32 repoId, bytes32 artifactDigest, uint8 artifactType)
    external
    view
    returns (
        bytes32 snapshotMerkleRoot,
        string memory attestationCid,
        uint256 timestamp,
        address author,
        uint256 index,
        bool revoked,
        uint8 revocationReason,
        uint256 revokedAt,
        address revokedBy,
        string memory revocationNoteCid
    )
    {
        uint256 idx1 = attestationIndexByDigest[repoId][artifactDigest][artifactType];
        require(idx1 != 0, "not found");

        Attestation storage a = attestationsOf[repoId][idx1 - 1];
        Revocation storage r = revocationsByKey[repoId][artifactDigest][artifactType];

        return (
            a.snapshotMerkleRoot,
            a.attestationCid,
            a.timestamp,
            a.author,
            idx1 - 1,
            r.revoked,
            r.reason,
            r.timestamp,
            r.revokedBy,
            r.noteCid
        );
    }
}