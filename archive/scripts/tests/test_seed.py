import pytest
import sys
import os

# Add scripts dir to path for import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from seed_knowledge import parse_markdown, slugify_key


def test_parse_markdown_splits_by_h2():
    md = """# Title

Some intro.

## Section One

Content one.

## Section Two

Content two.
"""
    sections = parse_markdown(md)
    assert len(sections) == 2
    assert sections[0]["header"] == "Section One"
    assert "Content one." in sections[0]["content"]
    assert sections[1]["header"] == "Section Two"


def test_parse_markdown_no_sections():
    md = "Just plain text, no headers."
    sections = parse_markdown(md)
    assert len(sections) == 1
    assert sections[0]["header"] == "content"


def test_slugify_key():
    assert slugify_key("business-rules.md", "State Code Derivation") == "business-rules/state-code-derivation"
    assert slugify_key("schema.md", "Users Table") == "schema/users-table"
