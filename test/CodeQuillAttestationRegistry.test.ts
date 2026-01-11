import { expect } from "chai";
import hre from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import {before, describe, it} from "node:test";

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
            repoId, fakeRoot, artifactDigest, 3, attestationCid, repoOwner.address
        )).to.be.revertedWith("snapshot not found");
    });

    it("Should fail if duplicate attestation (same repo, snapshot, and digest)", async function () {
        await expect(attestationRegistry.connect(owner).createAttestation(
            repoId, merkleRoot, artifactDigest, 1, "another-cid", repoOwner.address
        )).to.be.revertedWith("duplicate attestation");
    });

    it("Should fail with zero address check in constructor", async function () {
        const Attestation = await ethers.getContractFactory("CodeQuillAttestationRegistry");
        await expect(Attestation.deploy(owner.address, ethers.ZeroAddress, await delegation.getAddress(), await snapshotRegistry.getAddress()))
            .to.be.revertedWith("zero addr");
    });
  });

  describe("revokeAttestation", function () {
    let repoId: string;
    let merkleRoot: string;
    let artifactDigest: string;
    const artifactType = 5;

    before(async function () {
        repoId = ethers.encodeBytes32String("revoke-repo");
        merkleRoot = ethers.id("root-revoke");
        artifactDigest = ethers.id("digest-revoke");
        
        await registry.connect(repoOwner).claimRepo(repoId, "meta");
        await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, merkleRoot, "cid", repoOwner.address, 10);
        await attestationRegistry.connect(owner).createAttestation(repoId, merkleRoot, artifactDigest, artifactType, "cid", repoOwner.address);
    });

    it("Should allow relayer to revoke attestation", async function () {
        await expect(attestationRegistry.connect(owner).revokeAttestation(
            repoId, merkleRoot, artifactDigest, 1, "revocation-note", repoOwner.address
        )).to.emit(attestationRegistry, "AttestationRevoked")
          .withArgs(repoId, merkleRoot, artifactDigest, repoOwner.address, 1, "revocation-note", anyValue);
        
        expect(await attestationRegistry.isRevoked(repoId, merkleRoot, artifactDigest)).to.be.true;
    });

    it("Should fail if already revoked", async function () {
        await expect(attestationRegistry.connect(owner).revokeAttestation(
            repoId, merkleRoot, artifactDigest, 1, "note", repoOwner.address
        )).to.be.revertedWith("already revoked");
    });

    it("Should fail if attestation does not exist", async function () {
        await expect(attestationRegistry.connect(owner).revokeAttestation(
            repoId, merkleRoot, ethers.id("non-existent"), 1, "note", repoOwner.address
        )).to.be.revertedWith("not found");
    });

    it("Should fail if not called by owner (relayer)", async function () {
        await expect(attestationRegistry.connect(otherAccount).revokeAttestation(
            repoId, merkleRoot, artifactDigest, 1, "note", repoOwner.address
        )).to.be.revertedWithCustomError(attestationRegistry, "OwnableUnauthorizedAccount");
    });

    it("Should fail if not authorized by repo owner", async function () {
        const otherRepoId = ethers.encodeBytes32String("other-repo");
        await registry.connect(otherAccount).claimRepo(otherRepoId, "meta");
        await snapshotRegistry.connect(owner).createSnapshot(otherRepoId, ethers.ZeroHash, merkleRoot, "cid", otherAccount.address, 10);
        await attestationRegistry.connect(owner).createAttestation(otherRepoId, merkleRoot, artifactDigest, artifactType, "cid", otherAccount.address);

        await expect(attestationRegistry.connect(owner).revokeAttestation(
            otherRepoId, merkleRoot, artifactDigest, 1, "note", repoOwner.address
        )).to.be.revertedWith("not authorized");
    });
  });

  describe("Views", function () {
      let repoId: string;
      let merkleRoot: string;
      let artifactDigest: string;
      const artifactType = 10;

      before(async function () {
          repoId = ethers.encodeBytes32String("view-attest-repo-2");
          merkleRoot = ethers.id("root-view-2");
          artifactDigest = ethers.id("digest-view-2");
          
          await registry.connect(repoOwner).claimRepo(repoId, "meta");
          await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, merkleRoot, "cid", repoOwner.address, 10);
          await attestationRegistry.connect(owner).createAttestation(repoId, merkleRoot, artifactDigest, artifactType, "cid-attest", repoOwner.address);
      });

      it("Should get attestation by index", async function () {
          const a = await attestationRegistry.getAttestation(repoId, 0);
          expect(a.snapshotMerkleRoot).to.equal(merkleRoot);
          expect(a.artifactDigest).to.equal(artifactDigest);
          expect(a.artifactType).to.equal(artifactType);
      });

      it("Should fail if index is out of bounds", async function () {
          await expect(attestationRegistry.getAttestation(repoId, 99))
              .to.be.revertedWith("invalid index");
      });

      it("Should get attestation by digest including revocation info", async function () {
          const a = await attestationRegistry.getAttestationByDigest(repoId, merkleRoot, artifactDigest);
          expect(a.attestationCid).to.equal("cid-attest");
          expect(a.revoked).to.be.false;
          
          // Revoke it
          await attestationRegistry.connect(owner).revokeAttestation(repoId, merkleRoot, artifactDigest, 2, "note", repoOwner.address);
          
          const aRevoked = await attestationRegistry.getAttestationByDigest(repoId, merkleRoot, artifactDigest);
          expect(aRevoked.revoked).to.be.true;
          expect(aRevoked.revocationReason).to.equal(2);
          expect(aRevoked.revocationNoteCid).to.equal("note");
      });

      it("Should get revocation details", async function () {
          const r = await attestationRegistry.getRevocation(repoId, merkleRoot, artifactDigest);
          expect(r.revoked).to.be.true;
          expect(r.reason).to.equal(2);
          expect(r.noteCid).to.equal("note");
          expect(r.revokedBy).to.equal(repoOwner.address);
      });

      it("Should return not found for non-existent digest", async function () {
          await expect(attestationRegistry.getAttestationByDigest(repoId, merkleRoot, ethers.id("missing")))
              .to.be.revertedWith("not found");
      });
  });
});
