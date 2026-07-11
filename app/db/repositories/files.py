"""Repository for file-tree nodes."""

from __future__ import annotations

from uuid import UUID

from sqlmodel import select

from app.db import models
from app.db.repositories.base import Repository


class FileNodeRepository(Repository):
    """Data access helpers for `FileNode` rows."""

    def add(self, node: models.FileNode) -> models.FileNode:
        """Persist a new node and return it."""
        return self._add(node)

    def get(self, node_id: UUID) -> models.FileNode | None:
        """Return a node by id if one exists."""
        return self.session.get(models.FileNode, node_id)

    def get_for_user(self, node_id: UUID, user_id: UUID) -> models.FileNode | None:
        """Return a node only when it exists and is owned by the user."""
        node = self.session.get(models.FileNode, node_id)
        if not node or node.user_id != user_id:
            return None
        return node

    def list_for_collection(self, collection_id: UUID) -> list[models.FileNode]:
        """Return every node in a collection's tree, folders-first by name."""
        statement = (
            select(models.FileNode)
            .where(models.FileNode.collection_id == collection_id)
            .order_by(models.FileNode.kind, models.FileNode.name)
        )
        return list(self.session.exec(statement).all())

    def list_children(
        self, collection_id: UUID, parent_id: UUID | None
    ) -> list[models.FileNode]:
        """Return one folder's direct children, folders-first by name."""
        statement = (
            select(models.FileNode)
            .where(
                models.FileNode.collection_id == collection_id,
                models.FileNode.parent_id == parent_id,
            )
            .order_by(models.FileNode.kind, models.FileNode.name)
        )
        return list(self.session.exec(statement).all())

    def find_child_by_name(
        self, collection_id: UUID, parent_id: UUID | None, name: str
    ) -> models.FileNode | None:
        """Return the sibling with this exact name, if any."""
        statement = select(models.FileNode).where(
            models.FileNode.collection_id == collection_id,
            models.FileNode.parent_id == parent_id,
            models.FileNode.name == name,
        )
        return self.session.exec(statement).first()

    def delete(self, node: models.FileNode) -> None:
        """Delete a node row."""
        self.session.delete(node)
        self.session.flush()
