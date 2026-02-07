import hre from "hardhat";

export function asBigInt(v: any): bigint {
  return typeof v === "bigint" ? v : BigInt(v);
}

export async function setupCodeQuill() {
  const connection = await hre.network.connect();
  const ethers = (connection as any).ethers;
  const time = (connection as any).networkHelpers.time;

  const [deployer, alice, bob, charlie, daoExecutor] = await ethers.getSigners();

  const Workspace = await ethers.getContractFactory("CodeQuillWorkspaceRegistry");
  const workspace = await Workspace.deploy();
  await workspace.waitForDeployment();

  const Delegation = await ethers.getContractFactory("CodeQuillDelegation");
  const delegation = await Delegation.deploy();
  await delegation.waitForDeployment();

  const Repository = await ethers.getContractFactory("CodeQuillRepositoryRegistry");
  const repository = await Repository.deploy(
    await delegation.getAddress(),
    await workspace.getAddress(),
  );
  await repository.waitForDeployment();

  const Snapshot = await ethers.getContractFactory("CodeQuillSnapshotRegistry");
  const snapshot = await Snapshot.deploy(
    await repository.getAddress(),
    await workspace.getAddress(),
    await delegation.getAddress(),
  );
  await snapshot.waitForDeployment();

  const Backup = await ethers.getContractFactory("CodeQuillBackupRegistry");
  const backup = await Backup.deploy(
    await repository.getAddress(),
    await workspace.getAddress(),
    await delegation.getAddress(),
    await snapshot.getAddress(),
  );
  await backup.waitForDeployment();

  const Release = await ethers.getContractFactory("CodeQuillReleaseRegistry");
  const release = await Release.deploy(
    await repository.getAddress(),
    await workspace.getAddress(),
    await delegation.getAddress(),
    await snapshot.getAddress(),
  );
  await release.waitForDeployment();

  const Attestation = await ethers.getContractFactory("CodeQuillAttestationRegistry");
  const attestation = await Attestation.deploy(
    await workspace.getAddress(),
    await delegation.getAddress(),
    await release.getAddress(),
  );
  await attestation.waitForDeployment();

  return {
    ethers,
    time,
    deployer,
    alice,
    bob,
    charlie,
    daoExecutor,
    workspace,
    delegation,
    repository,
    snapshot,
    backup,
    release,
    attestation,
  };
}

export async function getEip712Domain(
  ethers: any,
  name: string,
  version: string,
  verifyingContract: string,
) {
  return {
    name,
    version,
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract,
  };
}

export const delegationTypes = {
  Delegate: [
    { name: "owner", type: "address" },
    { name: "relayer", type: "address" },
    { name: "contextId", type: "bytes32" },
    { name: "scopes", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const revokeDelegationTypes = {
  Revoke: [
    { name: "owner", type: "address" },
    { name: "relayer", type: "address" },
    { name: "contextId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const workspaceSetAuthorityTypes = {
  SetAuthority: [
    { name: "contextId", type: "bytes32" },
    { name: "authority", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const workspaceSetMemberTypes = {
  SetMember: [
    { name: "contextId", type: "bytes32" },
    { name: "member", type: "address" },
    { name: "isMember", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export async function getWorkspaceEip712Domain(ethers: any, workspace: any) {
  return getEip712Domain(
    ethers,
    "CodeQuillWorkspaceRegistry",
    "1",
    await workspace.getAddress(),
  );
}

export async function setWorkspaceMemberWithSig(params: {
  ethers: any;
  workspace: any;
  authoritySigner: any;
  relayerSigner: any;
  domain: any;
  contextId: string;
  member: string;
  memberStatus: boolean;
  deadline: bigint;
}) {
  const {
    ethers,
    workspace,
    authoritySigner,
    relayerSigner,
    domain,
    contextId,
    member,
    memberStatus,
    deadline,
  } = params;

  const nonce = await workspace.nonces(authoritySigner.address);
  const value = {
    contextId,
    member,
    isMember: memberStatus,
    nonce,
    deadline,
  };

  const signature = await authoritySigner.signTypedData(domain, workspaceSetMemberTypes, value);
  const { v, r, s } = ethers.Signature.from(signature);

  return workspace
    .connect(relayerSigner)
    .setMemberWithSig(contextId, member, memberStatus, deadline, v, r, s);
}

export async function setWorkspaceAuthorityWithSig(params: {
  ethers: any;
  workspace: any;
  currentAuthoritySigner: any;
  relayerSigner: any;
  domain: any;
  contextId: string;
  newAuthority: string;
  deadline: bigint;
}) {
  const {
    ethers,
    workspace,
    currentAuthoritySigner,
    relayerSigner,
    domain,
    contextId,
    newAuthority,
    deadline,
  } = params;

  const nonce = await workspace.nonces(currentAuthoritySigner.address);
  const value = {
    contextId,
    authority: newAuthority,
    nonce,
    deadline,
  };

  const signature = await currentAuthoritySigner.signTypedData(
    domain,
    workspaceSetAuthorityTypes,
    value,
  );
  const { v, r, s } = ethers.Signature.from(signature);

  return workspace
    .connect(relayerSigner)
    .setAuthorityWithSig(contextId, newAuthority, deadline, v, r, s);
}
