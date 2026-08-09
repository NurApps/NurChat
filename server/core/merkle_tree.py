"""
Merkle Tree for Key Transparency — Phase 3: Server-side Implementation

Append-only Merkle tree for public key directory.
Publishes root hashes periodically for client verification.

Features:
- Append-only tree structure
- Inclusion proofs (path from leaf to root)
- Consistency proofs (tree growth verification)
- Periodic root publication
- SHA-256 hashing

Security model:
- Server cannot modify past entries (append-only)
- Clients can verify their key is in the tree
- Third-party auditors can verify tree consistency
"""

import hashlib
import time
from dataclasses import dataclass
from typing import Any

# ─── Types ───

@dataclass
class MerkleLeaf:
    """A leaf in the Merkle tree."""
    user_id: str
    public_key_hex: str
    hash: bytes
    timestamp: float
    sequence: int


@dataclass
class MerkleProof:
    """Inclusion proof for a leaf."""
    leaf_index: int
    siblings: list[bytes]
    directions: list[int]  # 0 = left, 1 = right
    root_hash: bytes
    tree_size: int


@dataclass
class MerkleRoot:
    """A published root hash."""
    hash: bytes
    timestamp: float
    size: int
    sequence: int


# ─── Constants ───

ZERO_HASH = b'\x00' * 32
MAX_ROOT_HISTORY = 1000


# ─── Core Class ───

class ServerMerkleTree:
    """
    Server-side Merkle tree for key transparency.

    The tree is append-only — once a leaf is added, it cannot be modified.
    Root hashes are published periodically for client verification.
    """

    def __init__(self):
        self.leaves: list[MerkleLeaf] = []
        self.tree: list[bytes] = []
        self.root_history: list[MerkleRoot] = []
        self.sequence = 0
        self._rebuild_tree()

    def add_leaf(self, user_id: str, public_key_hex: str) -> int:
        """
        Add a new leaf to the tree.

        Args:
            user_id: User identifier
            public_key_hex: Public key as hex string

        Returns:
            Index of the added leaf
        """
        # Create leaf hash: SHA256(user_id || public_key)
        leaf_data = (user_id + public_key_hex).encode('utf-8')
        leaf_hash = hashlib.sha256(leaf_data).digest()

        leaf = MerkleLeaf(
            user_id=user_id,
            public_key_hex=public_key_hex,
            hash=leaf_hash,
            timestamp=time.time(),
            sequence=self.sequence,
        )

        self.leaves.append(leaf)
        self._rebuild_tree()

        # Update root history
        root = self.get_root()
        self.root_history.append(root)
        if len(self.root_history) > MAX_ROOT_HISTORY:
            self.root_history.pop(0)

        self.sequence += 1
        return len(self.leaves) - 1

    def get_root(self) -> MerkleRoot:
        """Get the current root hash."""
        root_hash = self.tree[0] if self.tree else ZERO_HASH
        return MerkleRoot(
            hash=root_hash,
            timestamp=time.time(),
            size=len(self.leaves),
            sequence=self.sequence,
        )

    def get_inclusion_proof(self, leaf_index: int) -> MerkleProof | None:
        """
        Generate an inclusion proof for a leaf.

        Args:
            leaf_index: Index of the leaf to prove

        Returns:
            Merkle proof or None if invalid index
        """
        if leaf_index < 0 or leaf_index >= len(self.leaves):
            return None

        siblings = []
        directions = []
        index = leaf_index

        # Walk up the tree
        for level in range(self._get_tree_height()):
            is_right = index % 2 == 1
            sibling_index = index - 1 if is_right else index + 1

            if sibling_index < self._get_level_size(level):
                siblings.append(self._get_node(level, sibling_index))
                directions.append(0 if is_right else 1)

            index //= 2

        root = self.get_root()

        return MerkleProof(
            leaf_index=leaf_index,
            siblings=siblings,
            directions=directions,
            root_hash=root.hash,
            tree_size=root.size,
        )

    def get_consistency_proof(self, old_size: int, new_size: int) -> list[bytes] | None:
        """
        Generate a consistency proof between two tree sizes.

        Args:
            old_size: Old tree size
            new_size: New tree size

        Returns:
            List of hashes or None if invalid
        """
        if old_size <= 0 or new_size <= old_size or new_size > len(self.leaves):
            return None

        proof = []

        # Add root hash from old tree
        if old_size > 0:
            old_tree = ServerMerkleTree()
            for i in range(old_size):
                old_tree.add_leaf(
                    self.leaves[i].user_id,
                    self.leaves[i].public_key_hex,
                )
            proof.append(old_tree.get_root().hash)

        return proof

    def get_root_history(self) -> list[MerkleRoot]:
        """Get the root history."""
        return list(self.root_history)

    def find_leaf_by_user_id(self, user_id: str) -> MerkleLeaf | None:
        """Find a leaf by user ID."""
        for leaf in self.leaves:
            if leaf.user_id == user_id:
                return leaf
        return None

    def find_leaf_by_public_key(self, public_key_hex: str) -> MerkleLeaf | None:
        """Find a leaf by public key."""
        for leaf in self.leaves:
            if leaf.public_key_hex == public_key_hex:
                return leaf
        return None

    def get_size(self) -> int:
        """Get tree size."""
        return len(self.leaves)

    def to_dict(self) -> dict[str, Any]:
        """Serialize tree to dictionary."""
        return {
            "leaves": [
                {
                    "user_id": leaf.user_id,
                    "public_key_hex": leaf.public_key_hex,
                    "hash": leaf.hash.hex(),
                    "timestamp": leaf.timestamp,
                    "sequence": leaf.sequence,
                }
                for leaf in self.leaves
            ],
            "root_history": [
                {
                    "hash": r.hash.hex(),
                    "timestamp": r.timestamp,
                    "size": r.size,
                    "sequence": r.sequence,
                }
                for r in self.root_history
            ],
            "sequence": self.sequence,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ServerMerkleTree":
        """Deserialize tree from dictionary."""
        tree = cls()
        tree.sequence = data.get("sequence", 0)

        for leaf_data in data.get("leaves", []):
            leaf = MerkleLeaf(
                user_id=leaf_data["user_id"],
                public_key_hex=leaf_data["public_key_hex"],
                hash=bytes.fromhex(leaf_data["hash"]),
                timestamp=leaf_data["timestamp"],
                sequence=leaf_data["sequence"],
            )
            tree.leaves.append(leaf)

        for root_data in data.get("root_history", []):
            root = MerkleRoot(
                hash=bytes.fromhex(root_data["hash"]),
                timestamp=root_data["timestamp"],
                size=root_data["size"],
                sequence=root_data["sequence"],
            )
            tree.root_history.append(root)

        tree._rebuild_tree()
        return tree

    # ─── Private Methods ───

    def _get_tree_height(self) -> int:
        """Get tree height."""
        import math
        return math.ceil(math.log2(len(self.leaves) + 1)) + 1 if self.leaves else 1

    def _get_level_size(self, level: int) -> int:
        """Get number of nodes at a level."""
        import math
        return math.ceil(len(self.leaves) / (2 ** level))

    def _get_node(self, level: int, index: int) -> bytes:
        """Get a node at a specific level and index."""
        tree_index = self._get_level_offset(level) + index
        return self.tree[tree_index] if tree_index < len(self.tree) else ZERO_HASH

    def _get_level_offset(self, level: int) -> int:
        """Get offset for a level in the flat tree array."""
        offset = 0
        for i in range(level):
            offset += self._get_level_size(i)
        return offset

    def _rebuild_tree(self) -> None:
        """Rebuild the tree from leaves."""
        n = len(self.leaves)
        if n == 0:
            self.tree = [ZERO_HASH]
            return

        height = self._get_tree_height()
        total_nodes = self._get_level_offset(height) + 1
        self.tree = [ZERO_HASH] * total_nodes

        # Fill leaves
        for i in range(n):
            self.tree[self._get_level_offset(0) + i] = self.leaves[i].hash

        # Build tree bottom-up
        for level in range(1, height):
            level_size = self._get_level_size(level)
            for i in range(level_size):
                left = self._get_node(level - 1, i * 2)
                right = self._get_node(level - 1, i * 2 + 1)
                combined = left + right
                self.tree[self._get_level_offset(level) + i] = hashlib.sha256(combined).digest()


# ─── Verification Functions ───

def verify_inclusion_proof(
    leaf: MerkleLeaf,
    proof: MerkleProof,
    expected_root: bytes,
) -> bool:
    """
    Verify an inclusion proof.

    Args:
        leaf: The leaf to verify
        proof: The inclusion proof
        expected_root: Expected root hash

    Returns:
        True if proof is valid
    """
    current_hash = leaf.hash

    for i, (sibling, direction) in enumerate(zip(proof.siblings, proof.directions)):
        if direction == 0:
            # Sibling is on the left
            combined = sibling + current_hash
        else:
            # Sibling is on the right
            combined = current_hash + sibling

        current_hash = hashlib.sha256(combined).digest()

    return current_hash == expected_root


def verify_root_in_history(
    root_history: list[MerkleRoot],
    expected_root: bytes,
) -> bool:
    """
    Verify that a root hash is in the published history.

    Args:
        root_history: Published root history
        expected_root: Root hash to verify

    Returns:
        True if root is in history
    """
    return any(r.hash == expected_root for r in root_history)
