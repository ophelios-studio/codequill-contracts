# CodeQuillDelegation

The `CodeQuillDelegation` contract provides a context-scoped delegation system. It allows a user (**Owner**) to authorize another address (**Relayer**) to perform specific actions on their behalf within a particular **Workspace** (`contextId`).

## Core Concepts

### Scoped Permissions
Delegation is not "all or nothing." It uses a bitmask of **Scopes** to grant specific, granular permissions. For example, a user can delegate the ability to create code snapshots without granting the ability to anchor a release.

### Context Isolation
Every delegation is strictly bound to a `contextId`. A relayer authorized in **Workspace A** has no permissions in **Workspace B** for the same owner, unless a separate delegation is created. This ensures that users can maintain different trust levels across different projects.

### Time-Limited Trust
Every delegation has an `expiry` timestamp. After this time, the delegation is automatically considered invalid by the system, requiring no manual revocation to stay secure.

---

## Delegation Scopes

Permissions are defined as bitmasks, allowing multiple scopes to be combined in a single delegation:

| Scope | Value | Description |
| :--- | :--- | :--- |
| `SCOPE_CLAIM` | `1 << 0` | Ability to claim repository ownership. |
| `SCOPE_SNAPSHOT` | `1 << 1` | Ability to create source code snapshots. |
| `SCOPE_ATTEST` | `1 << 2` | Ability to sign and record attestations for releases. |
| `SCOPE_BACKUP` | `1 << 3` | Ability to anchor backup records. |
| `SCOPE_RELEASE` | `1 << 4` | Ability to anchor, revoke, or supersede releases. |
| `SCOPE_ALL` | `max uint256` | Full authorization for all actions within the context. |

---

## Data Structures

### 1. Scopes Mapping
`mapping(address => mapping(address => mapping(bytes32 => uint256))) public scopesOf`
*   **Path**: `owner -> relayer -> contextId`
*   **Value**: The bitmask of granted scopes.

### 2. Expiry Mapping
`mapping(address => mapping(address => mapping(bytes32 => uint64))) public expiryOf`
*   **Path**: `owner -> relayer -> contextId`
*   **Value**: The Unix timestamp (in seconds) when the delegation expires.

---

## Key Operations

*   **`registerDelegationWithSig`**: The primary way to create a delegation. It requires an EIP-712 signature from the **Owner**. This allows the owner to sign the authorization off-chain and have a relayer (often the one being authorized) submit it and pay the gas.
*   **`isAuthorized`**: A view function used by other contracts in the ecosystem to verify if a caller has the required scope to act on behalf of another user in a given context.
*   **`revoke` / `revokeWithSig`**: Allows an owner to immediately cancel a delegation before its natural expiry.
