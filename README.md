# CodeQuill Contracts

CodeQuill is a decentralized registry for repositories, snapshots, and supply-chain attestations. It leverages EIP-712 delegations to enable a secure relayer-mediated workflow, allowing repository owners to authorize specific actions (claiming repos, creating snapshots, or signing attestations) without requiring them to be online for every transaction.

## Core Contracts

- **CodeQuillDelegation**: Context-scoped delegation (owner -> relayer) for granular permissions (scopes) bound to a workspace.
- **CodeQuillWorkspaceRegistry**: Manages workspace membership and authority, anchoring wallets to context identifiers.
- **CodeQuillRepositoryRegistry**: Repository claim registry (repoId -> owner) with context-scoped relayer support.
- **CodeQuillSnapshotRegistry**: Lightweight snapshotting via Merkle roots and off-chain git commit metadata.
- **CodeQuillReleaseRegistry**: Anchors immutable project releases referencing snapshots with integrated governance.
- **CodeQuillBackupRegistry**: Optional registry for anchoring encrypted backup archives bound to snapshots.
- **CodeQuillAttestationRegistry**: Records supply-chain attestations (sha256 artifact digests) bound to on-chain releases.

## Documentation

For more detailed information on the project's structure and security model, please refer to:
- [Architecture Diagram](docs/ARCHITECTURE.md)
- [Permissions Matrix](docs/PERMISSIONS.md)

## Compile contracts
```
npx hardhat build
```

## Run Tests
```
npx hardhat test
```

## Check Coverage
```
npx hardhat test --coverage
```

## Deploy contracts
```
npx hardhat keystore set SEPOLIA_RPC
npx hardhat keystore set DEPLOYER_OPHELIOS_PK
npx hardhat ignition deploy ignition/modules/Codequill.ts --network sepolia
```