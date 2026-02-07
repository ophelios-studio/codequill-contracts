# CodeQuill Architecture

This document describes the high-level architecture of the CodeQuill smart contracts and their relationships.

## Contract Relationship Graph

The following diagram illustrates how the different registries in the CodeQuill ecosystem interact with each other and share context.

```mermaid
graph TB
    subgraph "Identity & Access"
        WR[CodeQuillWorkspaceRegistry]
        DL[CodeQuillDelegation]
    end

    subgraph "Repository & Snapshots"
        RR[CodeQuillRepositoryRegistry]
        SR[CodeQuillSnapshotRegistry]
    end

    subgraph "Releases & Backups"
        RL[CodeQuillReleaseRegistry]
        BR[CodeQuillBackupRegistry]
    end

    subgraph "Trust & Verification"
        AR[CodeQuillAttestationRegistry]
    end

    %% Relationships
    RR -->|calls| WR
    RR -->|calls| DL
    
    SR -->|calls| WR
    SR -->|calls| DL
    SR -->|calls| RR
    
    BR -->|calls| WR
    BR -->|calls| DL
    BR -->|calls| RR
    BR -->|calls| SR
    
    RL -->|calls| WR
    RL -->|calls| DL
    RL -->|calls| RR
    RL -->|calls| SR
    
    AR -->|calls| WR
    AR -->|calls| DL
    AR -->|calls| RL

    %% Legend
    subgraph Legend
        L1[A --> B] -->|calls| L2[A calls B for verification or data]
    end
```

### Arrow Semantics
- **calls**: The source contract invokes a view function on the target contract to verify permissions (e.g., `isMember`, `isAuthorized`) or to validate the existence of a referenced entity (e.g., `repoOwner`, `snapshotIndexByRoot`).
- **stores address/reference**: Implicit in the "calls" relationship, as dependent contracts store the immutable addresses of the registries they interact with.

---

## Key User Journey: Software Release Flow

The most central journey in CodeQuill is the path from claiming a repository to anchoring an attested release.

```mermaid
sequenceDiagram
    autonumber
    actor Authority as Workspace Authority
    actor Member as Workspace Member
    actor Gov as Governance Authority
    participant WR as WorkspaceRegistry
    participant RR as RepositoryRegistry
    participant SR as SnapshotRegistry
    participant RL as ReleaseRegistry
    participant AR as AttestationRegistry

    Note over Authority, AR: Workspace Bootstrapping
    Authority->>WR: initAuthority(contextId, authority)
    Authority->>WR: setMemberWithSig(contextId, Member, true)

    Note over Member, AR: Repository & Snapshot
    Member->>RR: claimRepo(repoId, contextId, ...)
    Member->>SR: createSnapshot(repoId, contextId, commit, root, ...)

    Note over Member, AR: Release Cycle
    Member->>RL: anchorRelease(projectId, releaseId, contextId, ...)
    Gov->>RL: updateGouvernanceStatus(releaseId, ACCEPTED)

    Note over Member, AR: Verification
    Member->>AR: createAttestation(releaseId, artifactDigest, ...)
```

---

## How to keep this updated

1. **New Registries**: If a new registry is added, add it to the appropriate subgraph in the Relationship Graph and define its dependencies.
2. **Interface Changes**: If the interaction pattern between contracts changes (e.g., a contract starts depending on another one it didn't use before), update the Mermaid arrows.
3. **New User Journeys**: If significant new functionality is added (e.g., a new DAO integration or complex delegation logic), consider adding a new sequence diagram.
