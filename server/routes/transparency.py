"""
Merkle Tree API Routes — Phase 3: Key Transparency

REST API for key transparency verification.
Clients can:
- Submit their public key to the tree
- Get inclusion proofs
- Verify root hashes
- Check consistency
"""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.core.merkle_tree import ServerMerkleTree

router = APIRouter(prefix="/api/transparency", tags=["transparency"])

# ─── In-Memory Tree (production: use database) ───

_merkle_tree = ServerMerkleTree()


# ─── Types ───

class SubmitKeyRequest(BaseModel):
    """Request to submit a public key."""
    user_id: str
    public_key_hex: str


class SubmitKeyResponse(BaseModel):
    """Response after submitting a key."""
    leaf_index: int
    root_hash: str
    tree_size: int


class InclusionProofResponse(BaseModel):
    """Response with inclusion proof."""
    leaf_index: int
    leaf_hash: str
    siblings: list[str]
    directions: list[int]
    root_hash: str
    tree_size: int


class ConsistencyProofResponse(BaseModel):
    """Response with consistency proof."""
    old_size: int
    new_size: int
    proof_hashes: list[str]


class RootHistoryResponse(BaseModel):
    """Response with root history."""
    roots: list[dict]


class VerifyRequest(BaseModel):
    """Request to verify a proof."""
    user_id: str
    public_key_hex: str
    expected_root_hex: str


class VerifyResponse(BaseModel):
    """Response for verification."""
    valid: bool
    message: str


# ─── Routes ───

@router.post("/submit", response_model=SubmitKeyResponse)
async def submit_key(request: SubmitKeyRequest):
    """
    Submit a public key to the Merkle tree.

    This adds the key to the append-only tree and returns the leaf index.
    """
    leaf_index = _merkle_tree.add_leaf(request.user_id, request.public_key_hex)
    root = _merkle_tree.get_root()

    return SubmitKeyResponse(
        leaf_index=leaf_index,
        root_hash=root.hash.hex(),
        tree_size=root.size,
    )


@router.get("/proof/{leaf_index}", response_model=InclusionProofResponse)
async def get_inclusion_proof(leaf_index: int):
    """
    Get an inclusion proof for a leaf.

    The proof shows that the leaf is in the tree with the current root hash.
    """
    proof = _merkle_tree.get_inclusion_proof(leaf_index)
    if proof is None:
        raise HTTPException(status_code=404, detail="Leaf not found")

    leaf = _merkle_tree.leaves[leaf_index]

    return InclusionProofResponse(
        leaf_index=proof.leaf_index,
        leaf_hash=leaf.hash.hex(),
        siblings=[s.hex() for s in proof.siblings],
        directions=proof.directions,
        root_hash=proof.root_hash.hex(),
        tree_size=proof.tree_size,
    )


@router.get("/consistency/{old_size}/{new_size}", response_model=ConsistencyProofResponse)
async def get_consistency_proof(old_size: int, new_size: int):
    """
    Get a consistency proof between two tree sizes.

    This proves that a smaller tree is consistent with a larger tree.
    """
    proof = _merkle_tree.get_consistency_proof(old_size, new_size)
    if proof is None:
        raise HTTPException(status_code=400, detail="Invalid sizes")

    return ConsistencyProofResponse(
        old_size=old_size,
        new_size=new_size,
        proof_hashes=[h.hex() for h in proof],
    )


@router.get("/root", response_model=dict)
async def get_current_root():
    """Get the current Merkle root hash."""
    root = _merkle_tree.get_root()
    return {
        "hash": root.hash.hex(),
        "timestamp": root.timestamp,
        "size": root.size,
        "sequence": root.sequence,
    }


@router.get("/root/history", response_model=RootHistoryResponse)
async def get_root_history():
    """Get the history of published root hashes."""
    history = _merkle_tree.get_root_history()
    return RootHistoryResponse(
        roots=[
            {
                "hash": r.hash.hex(),
                "timestamp": r.timestamp,
                "size": r.size,
                "sequence": r.sequence,
            }
            for r in history
        ]
    )


@router.get("/leaf/user/{user_id}")
async def find_leaf_by_user(user_id: str):
    """Find a leaf by user ID."""
    leaf = _merkle_tree.find_leaf_by_user_id(user_id)
    if leaf is None:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "user_id": leaf.user_id,
        "public_key_hex": leaf.public_key_hex,
        "hash": leaf.hash.hex(),
        "timestamp": leaf.timestamp,
        "sequence": leaf.sequence,
    }


@router.get("/leaf/key/{public_key_hex}")
async def find_leaf_by_key(public_key_hex: str):
    """Find a leaf by public key."""
    leaf = _merkle_tree.find_leaf_by_public_key(public_key_hex)
    if leaf is None:
        raise HTTPException(status_code=404, detail="Key not found")

    return {
        "user_id": leaf.user_id,
        "public_key_hex": leaf.public_key_hex,
        "hash": leaf.hash.hex(),
        "timestamp": leaf.timestamp,
        "sequence": leaf.sequence,
    }


@router.post("/verify", response_model=VerifyResponse)
async def verify_inclusion(request: VerifyRequest):
    """
    Verify that a public key is in the tree.

    This is the main verification endpoint for clients.
    """
    leaf = _merkle_tree.find_leaf_by_user_id(request.user_id)
    if leaf is None:
        return VerifyResponse(valid=False, message="User not found in tree")

    if leaf.public_key_hex != request.public_key_hex:
        return VerifyResponse(valid=False, message="Public key does not match")

    proof = _merkle_tree.get_inclusion_proof(_merkle_tree.leaves.index(leaf))
    if proof is None:
        return VerifyResponse(valid=False, message="Could not generate proof")

    from server.core.merkle_tree import verify_inclusion_proof
    expected_root = bytes.fromhex(request.expected_root_hex)
    valid = verify_inclusion_proof(leaf, proof, expected_root)

    if valid:
        return VerifyResponse(valid=True, message="Inclusion proof verified")
    else:
        return VerifyResponse(valid=False, message="Inclusion proof invalid")


@router.get("/size")
async def get_tree_size():
    """Get the current tree size."""
    return {"size": _merkle_tree.get_size()}
