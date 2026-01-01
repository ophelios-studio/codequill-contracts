import { expect } from "chai";
import hre from "hardhat";

describe("CodeQuillRegistry", function () {
  let ethers: any;
  let time: any;
  let registry: any;
  let delegation: any;
  let owner: any;
  let repoOwner: any;
  let relayer: any;
  let otherAccount: any;
  let domain: any;

  const SCOPE_CLAIM = 1n << 0n;

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

    domain = {
      name: "CodeQuillDelegation",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await delegation.getAddress(),
    };
  });

  describe("claimRepo", function () {
    it("Should allow direct claim", async function () {
      const repoId = ethers.encodeBytes32String("direct-repo");
      await expect(registry.connect(repoOwner).claimRepo(repoId, "some-meta"))
        .to.emit(registry, "RepoClaimed")
        .withArgs(repoId, repoOwner.address, "some-meta");

      expect(await registry.repoOwner(repoId)).to.equal(repoOwner.address);
      expect(await registry.isClaimed(repoId)).to.be.true;
    });

    it("Should fail if already claimed", async function () {
        const repoId = ethers.encodeBytes32String("direct-repo");
        await expect(registry.connect(otherAccount).claimRepo(repoId, "meta"))
            .to.be.revertedWith("already claimed");
    });
  });

  describe("claimRepoFor", function () {
    it("Should allow admin (contract owner) to claim for others", async function () {
        const repoId = ethers.encodeBytes32String("admin-claim");
        await expect(registry.connect(owner).claimRepoFor(repoId, "admin-meta", repoOwner.address))
            .to.emit(registry, "RepoClaimed")
            .withArgs(repoId, repoOwner.address, "admin-meta");
        
        expect(await registry.repoOwner(repoId)).to.equal(repoOwner.address);
    });

    it("Should allow delegated relayer to claim", async function () {
        const repoId = ethers.encodeBytes32String("delegated-claim");
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const nonce = await delegation.nonces(repoOwner.address);

        const value = {
            owner: repoOwner.address,
            relayer: relayer.address,
            scopes: SCOPE_CLAIM,
            repoIdOrWildcard: repoId,
            nonce,
            expiry,
            deadline,
        };

        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
        await delegation.registerDelegationWithSig(repoOwner.address, relayer.address, SCOPE_CLAIM, repoId, expiry, deadline, v, r, s);

        await expect(registry.connect(relayer).claimRepoFor(repoId, "delegated-meta", repoOwner.address))
            .to.emit(registry, "RepoClaimed")
            .withArgs(repoId, repoOwner.address, "delegated-meta");
    });

    it("Should fail if not authorized", async function () {
        const repoId = ethers.encodeBytes32String("fail-claim");
        await expect(registry.connect(otherAccount).claimRepoFor(repoId, "meta", repoOwner.address))
            .to.be.revertedWith("not authorized");
    });
  });

  describe("transferRepo", function () {
    it("Should allow admin to transfer", async function () {
        const repoId = ethers.encodeBytes32String("transfer-repo");
        await registry.connect(repoOwner).claimRepo(repoId, "meta");

        await expect(registry.connect(owner).transferRepo(repoId, otherAccount.address))
            .to.emit(registry, "RepoTransferred")
            .withArgs(repoId, repoOwner.address, otherAccount.address);
        
        expect(await registry.repoOwner(repoId)).to.equal(otherAccount.address);
    });
  });

  describe("Batch views", function () {
    it("Should return multiple owners", async function () {
        const repo1 = ethers.encodeBytes32String("repo1");
        const repo2 = ethers.encodeBytes32String("repo2");
        await registry.connect(owner).claimRepo(repo1, "m1");
        
        const owners = await registry.repoOwners([repo1, repo2]);
        expect(owners[0]).to.equal(owner.address);
        expect(owners[1]).to.equal(ethers.ZeroAddress);
    });

    it("Should return repos by owner", async function () {
        const repoX = ethers.encodeBytes32String("repoX");
        await registry.connect(otherAccount).claimRepo(repoX, "mX");
        const repos = await registry.getReposByOwner(otherAccount.address);
        expect(repos).to.include(repoX);
    });
  });
});
