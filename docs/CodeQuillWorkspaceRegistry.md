# CodeQuillWorkspaceRegistry

The `CodeQuillWorkspaceRegistry` is the identity and access control layer of the CodeQuill ecosystem. It defines the boundaries of a **Workspace** (identified by a `contextId`) and manages who belongs to that workspace.

## Core Concepts

### Workspace Authority
Each `contextId` has a single **Authority** wallet. This authority is the "administrator" of the workspace on-chain and has the exclusive power to add or remove members.

### Multi-tenant Identity
The registry is inherently multi-tenant. Multiple organizations can coexist on the same contract, each managing their own `contextId` and list of members independently.

### Signature-Based Management (EIP-712)
To provide a gasless or relayed experience, the registry heavily uses EIP-712 signatures. This allows the Workspace Authority to sign a "SetMember" or "SetAuthority" intent off-chain, which can then be submitted by a relayer (e.g., the CodeQuill backend).

---

## Data Structures

### 1. Authority Mapping
`mapping(bytes32 => address) public authorityOf`
*   **Concept**: Maps a `contextId` to the wallet address that currently controls it.
*   **Rule**: Only the current authority can transfer control to a new authority.

### 2. Membership Mapping
`mapping(bytes32 => mapping(address => bool)) public isMember`
*   **Concept**: A nested mapping that tracks whether a specific wallet address is a member of a specific `contextId`.
*   **Rule**: Members are the only ones allowed to perform privileged actions in other registries (like claiming repos or anchoring releases) within that workspace.

### 3. Nonces
`mapping(address => uint256) public nonces`
*   **Concept**: Tracks the next expected nonce for a signer.
*   **Purpose**: Prevents "replay attacks" where a signed message is submitted multiple times to the blockchain.

---

## Key Operations

*   **`initAuthority`**: A one-time setup function to bootstrap a new workspace and assign its first authority. It is permissionless: anyone can claim an uninitialized `contextId`.
*   **`setMemberWithSig`**: Allows the authority to add or remove members by providing a valid EIP-712 signature.
*   **`setAuthorityWithSig`**: Allows the current authority to hand over control of the workspace to a new wallet.
*   **`leave`**: A utility function that allows any member (except the authority) to remove themselves from a workspace without needing the authority's signature.
