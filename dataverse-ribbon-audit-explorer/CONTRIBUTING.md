# Contributing

Critical review from Dynamics 365 developers, Power Platform architects and ALM practitioners is welcome. A correction with a minimal fixture is more useful than unqualified approval.

## Report a finding

Read classification and limitations first. Prefix issues with `[Ribbon Audit]`: the repository contains unrelated projects. Include tool/package version, platform build, privilege context, expected classification, observed evidence and sanitized reproduction. Replace private domains, user IDs, solution names and script bodies with synthetic values. Never attach a full production export.

## Development

Work inside this folder. Use npm ci and the README checks. Parsing/classification changes need a positive fixture and counterexample. Preserve unknown states; do not introduce prefix guesses, Default Solution ownership claims or false clean results. Render metadata through text nodes. Do not add telemetry, credentials or cleanup mutations incidentally.

Preserve component identity. Runtime edits must pass release build/source verification. Do not hand-edit ZIPs. Demo fixtures, npm packages, private CSVs and real environment screenshots must not enter solution artifacts.

## Review priorities

- OOB controls affected by unmanaged command/rule changes without new buttons.
- Creation candidates with unavailable managed baselines.
- Parent-only evidence, denied collections and empty stacks.
- Table/global context and same-ID isolation.
- Fresh sandbox install, upgrade, uninstall and reviewer-role permissions.

Use [the review template](docs/EXPERT_REVIEW.md). Favorable conclusions are not required. We will not claim a reviewer endorses the tool unless they explicitly state that and consent to attribution.

Contributions retain attribution through PRs/Git history and are submitted under this folder's MIT license. Only contribute material you have permission to share; do not submit client/employer code without permission. See [authorship](AUTHORS.md).
