# CodeQuillSnapshotRegistry

The `CodeQuillSnapshotRegistry` is used to record immutable "snapshots" of a repository's source code. It uses a combination of Merkle roots and IPFS Content Identifiers (CIDs) to create a verifiable link between on-chain data and off-chain source code.

## Core Concepts

### Source Provenance
A snapshot represents the state of a repository at a specific point in time (e.g., a specific Git commit). By recording this on-chain, CodeQuill provides cryptographic proof that a specific version of the code existed and was owned by a specific workspace member.

### Verifiable Content
Snapshots rely on two key pieces of data:
1.  **Merkle Root**: A single hash representing the entire tree of files in the project. This allows anyone with the source code to independently verify that the files haven't been tampered with.
2.  **Manifest CID**: A pointer to an IPFS JSON file that contains the full list of files and their individual hashes, allowing for complete reconstruction of the project state.

### Context Alignment
A snapshot can only be created for a repository within the same workspace (**Context**) where the repository was claimed. This ensures that organizational boundaries are respected.

---

## Data Structures

### 1. The `Snapshot` Struct
Each snapshot records the following data:

| Field | Type | Description |
| :--- | :--- | :--- |
| `commitHash` | `bytes32` | The Git commit hash associated with this snapshot. |
| `merkleRoot` | `bytes32` | The root hash of the file Merkle tree. Used for verification. |
| `manifestCid` | `string` | IPFS CID for the JSON manifest containing the file list. |
| `timestamp` | `uint256` | Block timestamp when the snapshot was recorded. |
| `author` | `address` | The wallet address of the repository owner who created the snapshot. |

### 2. Snapshots Mapping
`mapping(bytes32 => Snapshot[]) private snapshotsOf`
*   **Concept**: Stores an ordered history of snapshots for each `repoId`.

### 3. Root Index Mapping
`mapping(bytes32 => mapping(bytes32 => uint256)) public snapshotIndexByRoot`
*   **Concept**: Allows for quick lookup of a snapshot by its `merkleRoot`, ensuring that the same code state is not recorded multiple times for the same repo.

---

## Key Operations

*   **`createSnapshot`**: Allows a repository owner (or their delegated signer with `SCOPE_SNAPSHOT`) to record a new state for their repository.
    *   **Rule**: The repository must be claimed in the `RepositoryRegistry`.
    *   **Rule**: The repository's owner must be a member of the workspace context.
*   **`getSnapshotsCount`**: Returns the total number of snapshots recorded for a specific repository.
*   **`getSnapshot` / `getSnapshotByRoot`**: View functions to retrieve the full details of a snapshot using either its index in the history or its unique Merkle root.
