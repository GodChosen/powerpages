# Validation record

| Evidence                     | Establishes                                                         | Does not establish                          |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| Unit/integration tests       | Behavior for recorded synthetic inputs/failures                     | Every environment or complete API semantics |
| Synthetic browser demo       | UI/classification without a tenant                                  | Production findings or adoption             |
| Package/source verification  | Versions, flags, expected components and exact current source bytes | Successful import or sufficient privileges  |
| Independent community review | Not collected at initial publication                                | No endorsement follows from an open PR      |

## Reproduce

Run npm ci, then the [README checks](../README.md). Development dependencies are pinned and not deployed. Path-scoped CI uses Linux/Windows and Node 22/24; a configured workflow is not a successful run until it finishes. PR checks provide the result.

Seven inherited suites cover core/CSV, helpers/transport, focused app behavior, ZIP parsing, results, unmanaged classification and audit integration. The synthetic demo adds an eighth suite for fixture-driven UI and loopback-server behavior. Cases include command-only overrides, creations as candidates, affected managed controls, hides/rules, equivalent XML, context isolation, denied sources, empty layers and layer-assisted refinement. Public packaging adds hide-target and ValueRule field-reference assertions.

[Local validation output](../evidence/local-validation.txt) records actual command results. [Checksums](../releases/checksums.json) include source-resource hashes. ZIP timestamps may vary; the build promise is source-content consistency, not bit-for-bit identical archives.

## Package provenance

Version 1.5.1 formats source, adds public tooling/demo/docs, exposes hide-target/field references, and removes environment-specific app mappings and icon/channel dependencies. Package verification checks the published binaries against the current source resources.

## Independent results

Use the [review template](EXPERT_REVIEW.md). Include commit/package hash, platform build, privilege context, expected/actual evidence, reproduction and unknowns. Separate successful installation, verified findings and endorsement. Never upload tenant exports or credentials to substantiate a review.
