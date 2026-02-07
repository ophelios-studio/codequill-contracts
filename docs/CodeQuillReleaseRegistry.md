# CodeQuillReleaseRegistry

The `CodeQuillReleaseRegistry` is the "anchor" of the ecosystem. It provides an immutable, on-chain record of software releases. Its primary purpose is to bind a project's state (represented by source code snapshots) to a specific version name and a governance status, all within the security boundary of a **Workspace**.

## Core Concepts

### Multi-tenant Governance
The registry is designed to support many independent workspaces (identified by a `contextId`) on the same contract. Each workspace can define its own governance rules and executors without interfering with others.

### Release Lifecycle
A release starts as `PENDING`. It can then be `ACCEPTED` or `REJECTED` by an authorized governance authority or a DAO executor. Once anchored, a release can be `revoked` (marked invalid) or `superseded` (replaced by a newer version), creating a verifiable audit trail.

---

## Data Structures

### 1. The `Release` Struct
Every release anchored in the registry is stored as a `Release` object.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `bytes32` | Unique identifier for the release (usually a hash). |
| `projectId` | `bytes32` | Groups multiple releases under a single software project. |
| `contextId` | `bytes32` | The **Workspace ID**. Determines membership and governance scope. |
| `manifestCid` | `string` | IPFS CID for the release manifest (metadata, changelog, etc.). |
| `name` | `string` | Version string (e.g., `v1.0.4`). |
| `timestamp` | `uint256` | Block timestamp when the release was anchored. |
| `author` | `address` | The workspace member who created the release record. |
| `governanceAuthority` | `address` | Wallet designated to manually approve/reject the release. |
| `supersededBy` | `bytes32` | ID of the release that replaced this one. |
| `revoked` | `bool` | Whether this release has been withdrawn or invalidated. |
| `status` | `Enum` | `PENDING` (0), `ACCEPTED` (1), or `REJECTED` (2). |
| `statusTimestamp` | `uint256` | When the status was last updated. |
| `statusAuthor` | `address` | Who performed the status update (e.g., DAO executor). |

### 2. The `daoExecutors` Mapping
`mapping(bytes32 => address) public daoExecutors`

This mapping is critical for CodeQuill's multi-tenant design:
*   **Context Isolation**: Each `contextId` (Workspace) can link its own external governance engine (e.g., an Aragon DAO).
*   **Why a Mapping?**: It prevents a single global executor from controlling all projects. **Workspace A** can use a DAO, while **Workspace B** can use a simple multisig, and their settings remain isolated.
*   **Permission**: Only a member of the workspace (or their delegated signer) can update the executor for their `contextId`.

---

## Storage & Discovery

*   **`releaseById`**: Direct lookup of any release by its ID.
*   **`releasesOfProject`**: A list of all `releaseIds` associated with a `projectId`, allowing for version history reconstruction.
*   **`releaseIndexInProject`**: Helper mapping to find a release's position within its project's history.
