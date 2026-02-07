# CodeQuill Permissions Matrix

This document outlines the access control policies for each privileged function in the CodeQuill smart contracts.

## Permissions Matrix

| Contract | Function | Workspace Authority | Workspace Member | Repository Owner | Governance Authority | DAO Executor | Delegated Signer | Public |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **WorkspaceRegistry** | `initAuthority` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| | `setAuthorityWithSig` | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ [1] | ❌ |
| | `setMemberWithSig` | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ [1] | ❌ |
| | `leave` | ❌ | ✅ [2] | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Delegation** | `registerDelegationWithSig` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [1] | ❌ |
| | `revoke` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| | `revokeWithSig` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [1] | ❌ |
| **RepositoryRegistry** | `claimRepo` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [3] | ❌ |
| | `transferRepo` | ❌ | ❌ | ✅ | ❌ | ❌ | ⚠️ [3] | ❌ |
| **SnapshotRegistry** | `createSnapshot` | ❌ | ❌ | ✅ | ❌ | ❌ | ⚠️ [4] | ❌ |
| **BackupRegistry** | `anchorBackup` | ❌ | ❌ | ✅ | ❌ | ❌ | ⚠️ [5] | ❌ |
| **ReleaseRegistry** | `anchorRelease` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [6] | ❌ |
| | `supersedeRelease` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [6] | ❌ |
| | `revokeRelease` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [6] | ❌ |
| | `updateGouvernanceStatus` | ❌ | ❌ | ❌ | ✅ | ✅ | ⚠️ [6] | ❌ |
| | `setDaoExecutor` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [6] | ❌ |
| **AttestationRegistry** | `createAttestation` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [7] | ❌ |
| | `revokeAttestation` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [7] | ❌ |

### Footnotes

*   **[1] Relayed Signature**: Allowed if a valid EIP-712 signature from the required authority/owner is provided.
*   **[2] Self-Leave**: Any workspace member can remove themselves, provided they are not the current authority.
*   **[3] SCOPE_CLAIM**: Allowed if the `owner_` has delegated `SCOPE_CLAIM` to the `msg.sender` for the given `contextId`.
*   **[4] SCOPE_SNAPSHOT**: Allowed if the repository owner has delegated `SCOPE_SNAPSHOT` to the `msg.sender` for the given `contextId`.
*   **[5] SCOPE_BACKUP**: Allowed if the repository owner has delegated `SCOPE_BACKUP` to the `msg.sender` for the given `contextId`.
*   **[6] SCOPE_RELEASE**: Allowed if the author has delegated `SCOPE_RELEASE` to the `msg.sender` for the given `contextId`.
*   **[7] SCOPE_ATTEST**: Allowed if the author has delegated `SCOPE_ATTEST` to the `msg.sender` for the given `contextId`.

---

## Threat Model Notes

The following privileges are identified as the most sensitive within the CodeQuill ecosystem:

1.  **Workspace Authority**:
    The authority of a workspace context can unilaterally add or remove members. This is the root of trust for all context-scoped operations.
2.  **Delegation (`SCOPE_ALL`)**:
    If a user grants `SCOPE_ALL` to a relayer, that relayer can perform any action on behalf of the user within that workspace context, including claiming repos and anchoring releases.
3.  **Governance Authority / DAO Executor**:
    These roles have the power to `ACCEPTED` or `REJECTED` releases and to revoke attestations. Compromise of these roles could lead to the promotion of malicious software or the invalidation of legitimate work.
4.  **Signature Replay Prevention**:
    The system relies on nonces for all EIP-712 signatures. If nonce management were flawed, signed authorizations could be replayed by malicious relayers.
