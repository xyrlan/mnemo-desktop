---
name: dormant-activation
description: Tag a release only from main
metadata:
  type: project
  confidence: inferred
  topics: [workflow, build]
  activates_on:
    tools: [Bash]
    commands: [git tag]
---

Tag releases from `main` only. A branch build uses [[shared-target-dir#Why]].
