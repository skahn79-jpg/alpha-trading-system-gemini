#!/usr/bin/env python3
"""Print IssueSummary entries (compiler errors/warnings) from an xcresulttool JSON dump.
Used by CI to surface exact file:line diagnostics when the iOS Simulator build fails,
since xcodebuild's terse log omits them for whole-module-optimization batches."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/xcresult.json"
with open(path) as f:
    data = json.load(f)


def walk(node):
    if isinstance(node, dict):
        if node.get("_type", {}).get("_name") == "IssueSummary":
            msg = node.get("message", {}).get("_value", "")
            doc = node.get("documentLocationInCreatingWorkspace", {}) or {}
            url = doc.get("url", {}).get("_value", "")
            print(f"ISSUE: {msg}\n  at {url}")
        for v in node.values():
            walk(v)
    elif isinstance(node, list):
        for item in node:
            walk(item)


walk(data)
