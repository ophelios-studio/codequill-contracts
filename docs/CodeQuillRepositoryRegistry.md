# CodeQuillRepositoryRegistry

The `CodeQuillRepositoryRegistry` is responsible for tracking ownership of software repositories within the CodeQuill ecosystem. It ensures that every repository is bound to a specific owner and a specific workspace (**Context**).

## Core Concepts

### Repository Claims
A repository must be "claimed" before any other actions (like creating snapshots or backups) can be performed. Claiming a repository establishes a verifiable link between the `repoId` (which could be a hash of the project name or a unique UUID) and an owner's wallet.

### Workspace Binding
Every claimed repository is associated with a `contextId`. This binding ensures that only members of that workspace can interact with the repository's on-chain data.

### Delegation-Aware
Like other registries in the ecosystem, the `RepositoryRegistry` is fully integrated with the `CodeQuillDelegation` system. This allows owners to authorize relayers to claim or transfer repositories on their behalf, provided they have the `SCOPE_CLAIM` permission.

---

## Data Structures

### 1. Repository Owner Mapping
`mapping(bytes32 => address) public repoOwner`
*   **Key**: `repoId` (Unique identifier for the repository).
*   **Value**: The wallet address of the current owner.

### 2. Repository Context Mapping
`mapping(bytes32 => bytes32) public repoContextId`
*   **Key**: `repoId`.
*   **Value**: The `contextId` (Workspace) the repository belongs to.

### 3. Owner's Repository List
`mapping(address => bytes32[]) private reposByOwner`
*   **Concept**: A convenience list that tracks all `repoIds` owned by a specific address. Primarily used for UI discovery.

---

## Key Operations

*   **`claimRepo`**: Allows a workspace member to register ownership of a new `repoId`.
    *   **Rule**: The owner must be a member of the specified `contextId`.
    *   **Rule**: The `repoId` must not have been claimed before.
*   **`transferRepo`**: Allows the current owner (or their delegated signer) to transfer ownership to a new wallet or move the repository to a different workspace.
    *   **Rule**: The new owner must be a member of the new destination workspace.
*   **`isClaimed`**: A view function to check if a repository ID is already registered in the system.
*   **`repoOwners`**: A batch-read function designed for off-chain tools to efficiently query the owners of multiple repositories in a single call.
