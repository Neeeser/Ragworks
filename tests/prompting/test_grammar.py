"""The unified `{{variable}}` grammar: parsing, rendering, strictness."""

from __future__ import annotations

import pytest

from app.prompting import PromptTemplateError, referenced_variables, render_template


def test_referenced_variables_finds_dotted_names_and_spacing() -> None:
    names = referenced_variables("Hi {{user.full_name}} — today is {{ datetime.date }}.")
    assert names == {"user.full_name", "datetime.date"}


def test_render_substitutes_values() -> None:
    rendered = render_template("{{a}} and {{b}}", {"a": "1", "b": "2"})
    assert rendered == "1 and 2"


def test_render_missing_variable_raises() -> None:
    with pytest.raises(PromptTemplateError, match="typo"):
        render_template("{{typo}}", {})


def test_render_on_missing_hook_supplies_replacement() -> None:
    rendered = render_template("{{gone}}", {}, on_missing=lambda name: f"<{name}>")
    assert rendered == "<gone>"


def test_json_and_single_braces_are_literal() -> None:
    template = '{"k": {"n": 1}} and {single} and {{"weird": true}}'
    assert referenced_variables(template) == set()
    assert render_template(template, {}) == template
