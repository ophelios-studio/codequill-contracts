// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title CodeQuillWorkspaceRegistry
/// @notice On-chain registry binding wallets to a workspace contextId (bytes32),
///         controlled by a workspace authority wallet (default wallet).
contract CodeQuillWorkspaceRegistry is Ownable, EIP712 {
    using ECDSA for bytes32;

    // contextId -> authority wallet
    mapping(bytes32 => address) public authorityOf;

    // contextId -> wallet -> isMember
    mapping(bytes32 => mapping(address => bool)) public isMember;

    // Nonce per authority (prevents signature replay)
    mapping(address => uint256) public nonces;

    // EIP-712 typehashes
    // SetAuthority(contextId,authority,nonce,deadline)
    bytes32 private constant SET_AUTHORITY_TYPEHASH =
    keccak256("SetAuthority(bytes32 contextId,address authority,uint256 nonce,uint256 deadline)");

    // SetMember(contextId,member,isMember,nonce,deadline)
    bytes32 private constant SET_MEMBER_TYPEHASH =
    keccak256("SetMember(bytes32 contextId,address member,bool isMember,uint256 nonce,uint256 deadline)");

    event AuthoritySet(bytes32 indexed contextId, address indexed authority);
    event MemberSet(bytes32 indexed contextId, address indexed member, bool isMember);

    constructor(address initialOwner)
    Ownable(initialOwner)
    EIP712("CodeQuillWorkspaceRegistry", "2")
    {}

    // --------------------
    // Bootstrap / Authority management
    // --------------------

    /**
     * @notice Initialize the authority for a contextId (one-time).
     * @dev Use this when you create the workspace off-chain and want to anchor its default wallet on-chain.
     *
     * If you prefer *only* signature-based authority setting, you can delete this and use setAuthorityWithSig only.
     */
    function initAuthority(bytes32 contextId, address authority) external onlyOwner {
        require(contextId != bytes32(0), "zero context");
        require(authority != address(0), "zero authority");
        require(authorityOf[contextId] == address(0), "authority already set");

        authorityOf[contextId] = authority;

        // Make the authority a member automatically
        isMember[contextId][authority] = true;

        emit AuthoritySet(contextId, authority);
        emit MemberSet(contextId, authority, true);
    }

    /**
     * @notice Change authority using an EIP-712 signature by the *current* authority.
     * @dev Backend can pay gas; cannot cheat without authority signature.
     */
    function setAuthorityWithSig(
        bytes32 contextId,
        address newAuthority,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(newAuthority != address(0), "zero authority");
        require(block.timestamp <= deadline, "sig expired");

        address currentAuthority = authorityOf[contextId];
        require(currentAuthority != address(0), "authority not set");

        uint256 nonce = nonces[currentAuthority];

        bytes32 structHash = keccak256(
            abi.encode(
                SET_AUTHORITY_TYPEHASH,
                contextId,
                newAuthority,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == currentAuthority, "bad signer");

        nonces[currentAuthority] = nonce + 1;

        authorityOf[contextId] = newAuthority;

        // Ensure new authority is a member
        isMember[contextId][newAuthority] = true;

        emit AuthoritySet(contextId, newAuthority);
        emit MemberSet(contextId, newAuthority, true);
    }

    // --------------------
    // Membership management
    // --------------------

    /**
     * @notice Add/remove a member using an EIP-712 signature by the workspace authority.
     * @dev Backend can pay gas; cannot cheat without authority signature.
     */
    function setMemberWithSig(
        bytes32 contextId,
        address member,
        bool memberStatus,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(member != address(0), "zero member");
        require(block.timestamp <= deadline, "sig expired");

        address auth = authorityOf[contextId];
        require(auth != address(0), "authority not set");

        uint256 nonce = nonces[auth];

        bytes32 structHash = keccak256(
            abi.encode(
                SET_MEMBER_TYPEHASH,
                contextId,
                member,
                memberStatus,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == auth, "bad signer");

        nonces[auth] = nonce + 1;

        // Prevent removing the authority as a member
        if (member == auth) {
            require(memberStatus == true, "cannot remove authority");
        }

        isMember[contextId][member] = memberStatus;
        emit MemberSet(contextId, member, memberStatus);
    }

    /**
     * @notice Optional self-leave (no signature).
     * @dev Keeps UX simple for users who want to remove themselves.
     * If you want authority-only membership changes, remove this function.
     */
    function leave(bytes32 contextId) external {
        require(contextId != bytes32(0), "zero context");

        address auth = authorityOf[contextId];
        require(msg.sender != auth, "authority cannot leave");

        isMember[contextId][msg.sender] = false;
        emit MemberSet(contextId, msg.sender, false);
    }
}