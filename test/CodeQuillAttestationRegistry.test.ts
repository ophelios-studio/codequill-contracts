import { expect } from "chai";
import hre from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

describe("CodeQuillAttestationRegistry", function () {
  let ethers: any;
  let time: any;
  let registry: any;
  let delegation: any;
  let snapshotRegistry: any;
  let attestationRegistry: any;
  let owner: any;
  let repoOwner: any;
  let relayer: any;
  let otherAccount: any;
  let domain: any;

  const SCOPE_ATTEST = 1n << 2n;

  const types = {
    Delegate: [
      { name: "owner", type: "address" },
      { name: "relayer", type: "address" },
      { name: "scopes", type: "uint256" },
      { name: "repoIdOrWildcard", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  before(async function () {
    const connection = await hre.network.connect();
    ethers = (connection as any).ethers;
    time = (connection as any).networkHelpers.time;

    [owner, repoOwner, relayer, otherAccount] = await ethers.getSigners();

    const Delegation = await ethers.getContractFactory("CodeQuillDelegation");
    delegation = await Delegation.deploy(owner.address);
    await delegation.waitForDeployment();

    const Registry = await ethers.getContractFactory("CodeQuillRegistry");
    registry = await Registry.deploy(owner.address, await delegation.getAddress());
    await registry.waitForDeployment();

    const Snapshot = await ethers.getContractFactory("CodeQuillSnapshotRegistry");
    snapshotRegistry = await Snapshot.deploy(owner.address, await registry.getAddress(), await delegation.getAddress());
    await snapshotRegistry.waitForDeployment();

    const Attestation = await ethers.getContractFactory("CodeQuillAttestationRegistry");
    attestationRegistry = await Attestation.deploy(owner.address, await registry.getAddress(), await delegation.getAddress(), await snapshotRegistry.getAddress());
    await attestationRegistry.waitForDeployment();

    domain = {
      name: "CodeQuillDelegation",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await delegation.getAddress(),
    };
  });

  describe("createAttestation", function () {
    let repoId: string;
    let merkleRoot: string;
    let artifactDigest: string;
    const attestationCid = "QmAttest123";

    before(async function () {
        repoId = ethers.encodeBytes32String("attest-repo");
        merkleRoot = ethers.id("root1");
        artifactDigest = ethers.id("artifact1");
        
        await registry.connect(repoOwner).claimRepo(repoId, "meta");
        // Create snapshot first (required by createAttestation)
        await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, merkleRoot, "cid", repoOwner.address, 10);
    });

    it("Should allow relayer to create attestation if authorized", async function () {
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const nonce = await delegation.nonces(repoOwner.address);
        const value = { owner: repoOwner.address, relayer: relayer.address, scopes: SCOPE_ATTEST, repoIdOrWildcard: repoId, nonce, expiry, deadline };
        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
        await delegation.registerDelegationWithSig(repoOwner.address, relayer.address, SCOPE_ATTEST, repoId, expiry, deadline, v, r, s);

        await expect(attestationRegistry.connect(owner).createAttestation(
            repoId, merkleRoot, artifactDigest, 1, attestationCid, repoOwner.address
        )).to.emit(attestationRegistry, "AttestationCreated")
          .withArgs(repoId, 0, repoOwner.address, merkleRoot, artifactDigest, 1, attestationCid, anyValue);
        
        expect(await attestationRegistry.getAttestationsCount(repoId)).to.equal(1);
    });

    it("Should fail if snapshot does not exist", async function () {
        const fakeRoot = ethers.id("fake");
        await expect(attestationRegistry.connect(owner).createAttestation(
            repoId, fakeRoot, artifactDigest, 2, attestationCid, repoOwner.address
        )).to.be.revertedWith("snapshot not found");
    });

    it("Should fail if duplicate attestation", async function () {
        await expect(attestationRegistry.connect(owner).createAttestation(
            repoId, merkleRoot, artifactDigest, 1, "another-cid", repoOwner.address
        )).to.be.revertedWith("duplicate attestation");
    });
  });

  describe("Views", function () {
      let repoId: string;
      let merkleRoot: string;
      let artifactDigest: string;

      before(async function () {
          repoId = ethers.encodeBytes32String("view-attest-repo");
          merkleRoot = ethers.id("root-view");
          artifactDigest = ethers.id("digest-view");
          
          await registry.connect(repoOwner).claimRepo(repoId, "meta");
          await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, merkleRoot, "cid", repoOwner.address, 10);
          await attestationRegistry.connect(owner).createAttestation(repoId, merkleRoot, artifactDigest, 0, "cid-attest", repoOwner.address);
      });

      it("Should get attestation by index", async function () {
          const a = await attestationRegistry.getAttestation(repoId, 0);
          expect(a.artifactDigest).to.equal(artifactDigest);
      });

      it("Should get attestation by digest", async function () {
          const a = await attestationRegistry.getAttestationByDigest(repoId, artifactDigest, 0);
          expect(a.snapshotMerkleRoot).to.equal(merkleRoot);
      });
  });
});
