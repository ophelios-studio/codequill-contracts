import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("CodeQuill", (m) => {
    const admin = m.getAccount(0);
    const workspace = m.contract("CodeQuillWorkspaceRegistry", [admin]);
    const delegation = m.contract("CodeQuillDelegation", [admin]);
    const repository = m.contract("CodeQuillRepositoryRegistry", [admin, delegation, workspace]);
    const snapshot = m.contract("CodeQuillSnapshotRegistry", [admin, repository, workspace, delegation]);
    const backup = m.contract("CodeQuillBackupRegistry", [admin, repository, workspace, delegation, snapshot]);
    const release = m.contract("CodeQuillReleaseRegistry", [admin, repository, workspace, delegation, snapshot]);
    const attestation = m.contract("CodeQuillAttestationRegistry", [admin, workspace, delegation, release]);

    return { workspace, delegation, repository, snapshot, backup, release, attestation };
});