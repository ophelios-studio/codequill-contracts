## Compile contracts
```
npx hardhat build
```

## Deploy contracts
```
npx hardhat keystore set SEPOLIA_RPC
npx hardhat keystore set DEPLOYER_OPHELIOS_PK
npx hardhat ignition deploy ignition/modules/Codequill.ts --network sepolia
```