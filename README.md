# CodeQuill Contracts

CodeQuill is a decentralized registry for repositories, snapshots, and supply-chain attestations. It leverages EIP-712 delegations to enable a secure relayer-mediated workflow, allowing repository owners to authorize specific actions (claiming repos, creating snapshots, or signing attestations) without requiring them to be online for every transaction.

## Core Contracts

- **CodeQuillDelegation**: Handles EIP-712 signature verification and manages granular permissions (scopes) granted by repository owners to relayers.
- **CodeQuillRegistry**: Maintains the mapping between repository IDs and their owners. Supports both direct claims and delegated claims via authorized relayers.
- **CodeQuillSnapshotRegistry**: Stores Merkle roots and metadata (git commit, manifest CID) for repository snapshots. Requires authorization from the repository owner.
- **CodeQuillAttestationRegistry**: Records supply-chain attestations (artifact digests) bound to specific on-chain snapshots.

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