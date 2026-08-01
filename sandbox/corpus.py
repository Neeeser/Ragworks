"""Real-text corpus assembly for scale scenarios.

Documents are built from the 20 newsgroups dataset (fetched through
scikit-learn, cached under ``~/scikit_learn_data`` after the first run):
real, messy English across distinct topics, which is exactly what the
insights surface needs to show meaningful clusters, document ties, and
cross-document overlaps. Each generated document concatenates several posts
from one newsgroup, so documents vary in length and chunk into multiple
pieces under the pipeline's chunker.
"""

from __future__ import annotations

from dataclasses import dataclass

# Topically distinct groups, deliberately spanning a few close pairs
# (space/med, autos/motorcycles) so the map has both far clusters and
# near-neighbour structure worth inspecting.
CATEGORIES: tuple[str, ...] = (
    "sci.space",
    "sci.med",
    "rec.autos",
    "rec.motorcycles",
    "rec.sport.hockey",
    "comp.graphics",
    "sci.crypt",
    "misc.forsale",
)

MIN_POST_CHARS = 300
MAX_POST_CHARS = 4000
POSTS_PER_DOC_CYCLE = (2, 3, 4, 6, 3, 5, 2, 4)


@dataclass(frozen=True)
class CorpusDocument:
    """One generated document: a filename and its assembled text."""

    filename: str
    text: str
    category: str


def build_corpus(documents_per_category: int = 13) -> list[CorpusDocument]:
    """Assemble multi-post documents per category from 20 newsgroups.

    Post counts per document cycle through `POSTS_PER_DOC_CYCLE`, so document
    (and therefore chunk-count) sizes vary instead of every document looking
    identical on the map.
    """
    from sklearn.datasets import fetch_20newsgroups

    dataset = fetch_20newsgroups(
        subset="train",
        categories=list(CATEGORIES),
        remove=("headers", "footers", "quotes"),
    )
    by_category: dict[str, list[str]] = {category: [] for category in CATEGORIES}
    for text, target in zip(dataset.data, dataset.target, strict=True):
        cleaned = _clean(text)
        if len(cleaned) >= MIN_POST_CHARS:
            by_category[dataset.target_names[target]].append(cleaned[:MAX_POST_CHARS])

    documents: list[CorpusDocument] = []
    for category in CATEGORIES:
        posts = by_category[category]
        cursor = 0
        for index in range(documents_per_category):
            size = POSTS_PER_DOC_CYCLE[index % len(POSTS_PER_DOC_CYCLE)]
            selected = posts[cursor : cursor + size]
            cursor += size
            if len(selected) < 2:
                break
            slug = category.replace(".", "-")
            documents.append(
                CorpusDocument(
                    filename=f"{slug}-{index + 1:03d}.txt",
                    text="\n\n---\n\n".join(selected),
                    category=category,
                )
            )
    return documents


def _clean(text: str) -> str:
    """Collapse the dataset's noisy whitespace without touching content."""
    lines = [line.rstrip() for line in text.strip().splitlines()]
    collapsed: list[str] = []
    blank = False
    for line in lines:
        if not line:
            if not blank:
                collapsed.append("")
            blank = True
        else:
            collapsed.append(line)
            blank = False
    return "\n".join(collapsed).strip()
