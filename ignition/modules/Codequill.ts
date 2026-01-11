import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("CodeQuill", (m) => {
    const admin = m.getAccount(0);
    const delegation = m.contract("CodeQuillDelegation", [admin]);
    const registry = m.contract("CodeQuillRegistry", [admin, delegation]);
    const snapshot = m.contract("CodeQuillSnapshotRegistry", [admin, registry, delegation]);
    const attestation = m.contract("CodeQuillAttestationRegistry", [admin, registry, delegation, snapshot]);
    const backup = m.contract("CodeQuillBackupRegistry", [admin, registry, delegation, snapshot]);
    return { delegation, registry, snapshot, attestation, backup };
});