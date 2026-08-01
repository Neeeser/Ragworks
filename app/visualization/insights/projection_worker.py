"""PaCMAP entry points executed in a plain child interpreter.

pacmap mixes faiss and numba, and the app process loads scikit-learn —
three OpenMP runtimes whose init order segfaults on macOS in combinations
that depend on which library touched its thread pool first. There is no
in-process ordering that is safe for every platform, so the projection runs
in a child interpreter that loads *only* numpy, numba, and pacmap.

A plain `subprocess` speaking pickle over stdin/stdout, deliberately not
`multiprocessing`: a spawn-context child re-imports the parent's
`__main__`, which deadlocks under pytest-xdist's execnet workers — a bare
`python -m` child has no such tie to its parent.

Keep this module import-light: it must never (transitively) import sklearn,
the app config, or the database engine — its imports are exactly what the
child pays for, and the insights package `__init__` stays lazy for the same
reason.
"""

from __future__ import annotations

import pickle
import sys
from typing import Any, TypeAlias

import numpy as np

Array: TypeAlias = np.ndarray[Any, np.dtype[Any]]

_numba_warmed = False


def _warm_numba() -> None:
    """Run one numba-parallel kernel before anything touches faiss.

    The ordering constraint: numba's OpenMP runtime must initialize before
    faiss's libomp is even *loaded* (importing pacmap imports faiss), or
    the optimizer's first parallel region segfaults. Verified empirically
    on macOS; call this before the pacmap import, never after.
    """
    global _numba_warmed
    if _numba_warmed:
        return
    from numba import njit, prange

    @njit(parallel=True, cache=False)  # type: ignore[untyped-decorator]  # numba ships no types
    def kernel(values: Array) -> float:  # pragma: no cover - trivial jit body
        total = 0.0
        for i in prange(values.shape[0]):
            total += values[i]
        return total

    kernel(np.arange(16.0))
    _numba_warmed = True


# Below this many points PaCMAP's neighbor sampling degenerates (its pair
# counts round down to zero); a centered SVD plane is the honest projection
# for a corpus this small anyway.
TINY_FIT_MIN = 12


class TinyProjector:
    """Centered rank-2 SVD projection for corpora too small for PaCMAP.

    Speaks the same `transform(X, basis=...)` surface as PaCMAP so the
    incremental path and the probe treat both reducers identically.
    """

    def __init__(self, mean: Array, components: Array) -> None:
        self.mean = mean
        self.components = components

    def transform(self, X: Array, basis: Array | None = None) -> Array:
        return np.asarray((X - self.mean) @ self.components.T, dtype=np.float64)


def _fit_tiny(matrix: Array) -> tuple[bytes, Array]:
    mean = matrix.mean(axis=0)
    centered = matrix - mean
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    components = np.zeros((2, matrix.shape[1]), dtype=np.float64)
    components[: min(2, vt.shape[0])] = vt[:2]
    projector = TinyProjector(mean=mean.astype(np.float64), components=components)
    return pickle.dumps(projector), projector.transform(matrix)


def fit(matrix: Array, random_state: int) -> tuple[bytes, Array]:
    """Fit a 2D projection; returns (pickled reducer, coordinates)."""
    if matrix.shape[0] < TINY_FIT_MIN:
        return _fit_tiny(matrix)
    # Warm BEFORE the pacmap import: merely importing faiss (which the
    # pacmap module does) loads its libomp, and numba's first parallel
    # region after that segfaults.
    _warm_numba()
    import pacmap

    n = matrix.shape[0]
    reducer = pacmap.PaCMAP(
        n_components=2,
        n_neighbors=min(10, max(2, n - 2)),
        distance="angular",
        random_state=random_state,
    )
    coordinates = np.asarray(reducer.fit_transform(matrix), dtype=np.float64)
    return pickle.dumps(reducer), coordinates


def transform(reducer_blob: bytes, basis: Array, new: Array) -> Array:
    """Place new vectors into a previously fitted projection."""
    _warm_numba()
    import faiss

    # pacmap only single-threads faiss when its module-global random state
    # was set by a constructor call; an *unpickled* reducer skips that, and
    # a multi-threaded faiss search after numba's OpenMP init deadlocks.
    faiss.omp_set_num_threads(1)
    reducer = pickle.loads(reducer_blob)
    return np.asarray(reducer.transform(new, basis=basis), dtype=np.float64)


def main() -> None:
    """Child entry point: one pickled request on stdin, one reply on stdout.

    Any exception comes back as a structured error so the parent can raise
    it with context instead of parsing a traceback off stderr.
    """
    request = pickle.load(sys.stdin.buffer)
    try:
        if request["op"] == "fit":
            blob, coordinates = fit(request["matrix"], request["random_state"])
            reply: dict[str, Any] = {"ok": True, "blob": blob, "coordinates": coordinates}
        elif request["op"] == "transform":
            coordinates = transform(request["blob"], request["basis"], request["new"])
            reply = {"ok": True, "coordinates": coordinates}
        else:  # pragma: no cover - parent only sends the two ops above
            reply = {"ok": False, "error": f"unknown op {request['op']!r}"}
    except Exception as exc:
        reply = {"ok": False, "error": f"{exc.__class__.__name__}: {exc}"}
    sys.stdout.buffer.write(pickle.dumps(reply))
    sys.stdout.buffer.flush()


if __name__ == "__main__":  # pragma: no cover - exercised via subprocess
    main()
