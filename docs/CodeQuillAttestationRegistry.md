# CodeQuillAttestationRegistry

The `CodeQuillAttestationRegistry` is used to link specific build artifacts (e.g., binaries, Docker images) to an officially accepted on-chain release. It provides a way for developers or automated build systems to "attest" that a particular file corresponds to a specific version of the code.

## Core Concepts

### Binary-to-Release Mapping
While the `ReleaseRegistry` records that a specific version of the *source code* exists, the `AttestationRegistry` proves that a specific *binary* was built from that code. This is achieved by storing the SHA-256 digest of the build artifact.

### Governance Requirement
Attestations can only be created for releases that have reached the `ACCEPTED` status in the `CodeQuillReleaseRegistry`. This ensures that nobody can attest to a binary for a release that has been rejected or is still pending review.

### Reproducible Build Verification
The registry supports "privacy-safe" attestations. Developers can store a detailed attestation JSON (containing build environment details, compiler versions, etc.) on IPFS and record the CID on-chain. This allows third parties to independently reproduce the build and verify the binary's integrity.

---

## Data Structures

### 1. The `Attestation` Struct
Each attestation records the following:

| Field | Type | Description |
| :--- | :--- | :--- |
| `releaseId` | `bytes32` | The ID of the accepted release this artifact belongs to. |
| `artifactDigest` | `bytes32` | The SHA-256 hash of the final build artifact. |
| `attestationCid` | `string` | IPFS CID for the detailed attestation JSON. |
| `timestamp` | `uint256` | Block timestamp when the attestation was recorded. |
| `author` | `address` | The workspace member who created the attestation. |
| `revoked` | `bool` | Whether this attestation has been marked as invalid. |

### 2. Attestations by Release
`mapping(bytes32 => Attestation[]) private attestationsByRelease`
*   **Concept**: Stores all valid attestations (different build formats like `.deb`, `.exe`, or different architectures) for a single release.

### 3. Digest Index Mapping
`mapping(bytes32 => mapping(bytes32 => uint256)) public attestationIndexByReleaseDigest`
*   **Concept**: Ensures that the same artifact digest is not attested multiple times for the same release.

---

## Key Operations

*   **`createAttestation`**: Allows a workspace member (or their delegated signer with `SCOPE_ATTEST`) to record a new artifact for a release.
    *   **Rule**: The release must exist and its status must be `ACCEPTED`.
    *   **Rule**: The author must be a member of the workspace context associated with the release.
*   **`revokeAttestation`**: Allows the author (or their delegated signer) to mark an attestation as revoked (e.g., if a security vulnerability is found in that specific binary build).
*   **`isRevoked`**: A view function to check if a specific artifact has been invalidated.
*   **`getAttestationsCount`**: Returns the number of attestations recorded for a specific release.
