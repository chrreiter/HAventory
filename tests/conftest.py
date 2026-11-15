"""The check every test runs after it: the repository indexes agree with what they index."""

import functools

import pytest
from custom_components.haventory.repository import Repository

from repository_invariants import collect_index_issues


@pytest.fixture(autouse=True)
def _repository_indexes_agree_with_what_they_index(request):
    """Check every repository a test built once that test has finished.

    The checks are in ``repository_invariants``; running them from here is what
    makes them an oracle instead of a suite of their own. A refactor that leaves
    an index disagreeing with the entities it indexes fails the test that
    touched the repository, rather than one health test that
    may not exercise the path at all.

    Repositories are collected by wrapping the constructor for the duration of
    the test: nothing has to be passed in, so a test that reaches the repository
    through Home Assistant is covered exactly like one that builds its own. The
    list holds them alive until the check runs — a weak one is empty by then,
    because a repository a test only bound to a local is freed the moment the
    test returns. A test whose subject *is* a broken index declares
    ``@pytest.mark.index_drift`` and is skipped here.
    """

    built: list = []
    original_init = Repository.__init__

    @functools.wraps(original_init)
    def _record(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        built.append(self)

    Repository.__init__ = _record
    try:
        yield
    finally:
        Repository.__init__ = original_init

    if request.node.get_closest_marker("index_drift") is not None:
        return

    for repo in built:
        issues = collect_index_issues(repo)
        assert issues == [], f"repository indexes disagree with what they index: {issues}"
