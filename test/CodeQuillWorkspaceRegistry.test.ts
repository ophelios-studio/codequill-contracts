import { expect } from "chai";
import {
  asBigInt,
  getWorkspaceEip712Domain,
  setupCodeQuill,
  setWorkspaceAuthorityWithSig,
  setWorkspaceMemberWithSig,
  workspaceSetAuthorityTypes,
} from "./utils";

describe("CodeQuillWorkspaceRegistry", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let deployer: any;
  let authority: any;
  let member: any;
  let relayer: any;
  let domain: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    authority = env.alice;
    member = env.bob;
    relayer = env.charlie;
    workspace = env.workspace;

    domain = await getWorkspaceEip712Domain(ethers, workspace);
  });

  describe("initAuthority", function () {
    it("sets initial authority (one-time) and makes it a member", async function () {
      await expect(workspace.connect(deployer).initAuthority(contextId, authority.address))
        .to.emit(workspace, "AuthoritySet")
        .withArgs(contextId, authority.address);

      expect(await workspace.authorityOf(contextId)).to.equal(authority.address);
      expect(await workspace.isMember(contextId, authority.address)).to.equal(true);
    });

    it("emits both AuthoritySet and MemberSet", async function () {
      const tx = await workspace.connect(deployer).initAuthority(contextId, authority.address);

      await expect(tx)
        .to.emit(workspace, "AuthoritySet")
        .withArgs(contextId, authority.address);
      await expect(tx)
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, authority.address, true);
    });

    it("allows anyone to initialize a workspace", async function () {
      await expect(
        workspace.connect(authority).initAuthority(contextId, authority.address),
      )
        .to.emit(workspace, "AuthoritySet")
        .withArgs(contextId, authority.address);
    });

    it("reverts on zero context / zero authority", async function () {
      await expect(
        workspace.connect(deployer).initAuthority(ethers.ZeroHash, authority.address),
      ).to.be.revertedWith("zero context");

      await expect(
        workspace.connect(deployer).initAuthority(contextId, ethers.ZeroAddress),
      ).to.be.revertedWith("zero authority");
    });

    it("reverts if authority already set", async function () {
      await workspace.connect(deployer).initAuthority(contextId, authority.address);
      await expect(
        workspace.connect(deployer).initAuthority(contextId, authority.address),
      ).to.be.revertedWith("authority already set");
    });
  });

  describe("setAuthorityWithSig", function () {
    beforeEach(async function () {
      await workspace.connect(deployer).initAuthority(contextId, authority.address);
    });

    it("allows a relayer to submit a valid authority-change signature", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      const nonceBefore = await workspace.nonces(authority.address);

      const tx = await setWorkspaceAuthorityWithSig({
        ethers,
        workspace,
        currentAuthoritySigner: authority,
        relayerSigner: relayer,
        domain,
        contextId,
        newAuthority: member.address,
        deadline,
      });

      await expect(tx)
        .to.emit(workspace, "AuthoritySet")
        .withArgs(contextId, member.address);
      await expect(tx)
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, member.address, true);

      expect(await workspace.authorityOf(contextId)).to.equal(member.address);
      expect(await workspace.isMember(contextId, authority.address)).to.equal(true);
      expect(await workspace.isMember(contextId, member.address)).to.equal(true);
      expect(await workspace.nonces(authority.address)).to.equal(nonceBefore + 1n);
    });

    it("reverts on expired signature", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now - 1n;

      await expect(
        setWorkspaceAuthorityWithSig({
          ethers,
          workspace,
          currentAuthoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          newAuthority: member.address,
          deadline,
        }),
      ).to.be.revertedWith("sig expired");
    });

    it("reverts on bad signer", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      await expect(
        setWorkspaceAuthorityWithSig({
          ethers,
          workspace,
          currentAuthoritySigner: member,
          relayerSigner: relayer,
          domain,
          contextId,
          newAuthority: member.address,
          deadline,
        }),
      ).to.be.revertedWith("bad signer");
    });

    it("prevents signature replay (nonce-based)", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      const nonce = await workspace.nonces(authority.address);

      const value = {
        contextId,
        authority: member.address,
        nonce,
        deadline,
      };
      const signature = await authority.signTypedData(domain, workspaceSetAuthorityTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await workspace
        .connect(relayer)
        .setAuthorityWithSig(contextId, member.address, deadline, v, r, s);

      await expect(
        workspace.connect(relayer).setAuthorityWithSig(contextId, member.address, deadline, v, r, s),
      ).to.be.revertedWith("bad signer");
    });
  });

  describe("setMemberWithSig", function () {
    beforeEach(async function () {
      await workspace.connect(deployer).initAuthority(contextId, authority.address);
    });

    it("adds and removes a member via authority signature", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      const nonceBeforeAdd = await workspace.nonces(authority.address);
      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      )
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, member.address, true);

      expect(await workspace.isMember(contextId, member.address)).to.equal(true);
      expect(await workspace.nonces(authority.address)).to.equal(nonceBeforeAdd + 1n);

      const nonceBeforeRemove = await workspace.nonces(authority.address);
      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: member.address,
          memberStatus: false,
          deadline,
        }),
      )
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, member.address, false);

      expect(await workspace.isMember(contextId, member.address)).to.equal(false);
      expect(await workspace.nonces(authority.address)).to.equal(nonceBeforeRemove + 1n);
    });

    it("reverts on zero context / zero member", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId: ethers.ZeroHash,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("zero context");

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: ethers.ZeroAddress,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("zero member");
    });

    it("reverts on expired signature", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now - 1n;

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("sig expired");
    });

    it("reverts on bad signer", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: member,
          relayerSigner: relayer,
          domain,
          contextId,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("bad signer");
    });

    it("prevents removing the authority as a member", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      const nonceBefore = await workspace.nonces(authority.address);

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: authority.address,
          memberStatus: false,
          deadline,
        }),
      ).to.be.revertedWith("cannot remove authority");

      expect(await workspace.nonces(authority.address)).to.equal(nonceBefore);
      expect(await workspace.isMember(contextId, authority.address)).to.equal(true);
    });

    it("prevents signature replay (nonce-based)", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      const nonce = await workspace.nonces(authority.address);
      const value = {
        contextId,
        member: member.address,
        isMember: true,
        nonce,
        deadline,
      };

      // Use helper once, then replay exact same signature.
      const signature = await authority.signTypedData(domain, {
        SetMember: [
          { name: "contextId", type: "bytes32" },
          { name: "member", type: "address" },
          { name: "isMember", type: "bool" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      }, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await workspace
        .connect(relayer)
        .setMemberWithSig(contextId, member.address, true, deadline, v, r, s);

      await expect(
        workspace.connect(relayer).setMemberWithSig(contextId, member.address, true, deadline, v, r, s),
      ).to.be.revertedWith("bad signer");
    });
  });

  describe("leave", function () {
    beforeEach(async function () {
      await workspace.connect(deployer).initAuthority(contextId, authority.address);
    });

    it("allows a member to self-leave", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      await setWorkspaceMemberWithSig({
        ethers,
        workspace,
        authoritySigner: authority,
        relayerSigner: relayer,
        domain,
        contextId,
        member: member.address,
        memberStatus: true,
        deadline,
      });

      await expect(workspace.connect(member).leave(contextId))
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, member.address, false);

      expect(await workspace.isMember(contextId, member.address)).to.equal(false);
    });

    it("reverts if authority tries to leave", async function () {
      await expect(workspace.connect(authority).leave(contextId)).to.be.revertedWith(
        "authority cannot leave",
      );
    });

    it("reverts on zero context", async function () {
      await expect(workspace.connect(member).leave(ethers.ZeroHash)).to.be.revertedWith(
        "zero context",
      );
    });
  });
});
