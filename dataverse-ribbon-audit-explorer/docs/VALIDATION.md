# Validation record

| Evidence                          | Establishes                                                                | Does not establish                                              |
| --------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Unit/integration tests            | Behavior for recorded synthetic inputs/failures                            | Every environment or complete API semantics                     |
| Synthetic browser demo            | UI/classification without a tenant                                         | Production findings or adoption                                 |
| Package/source verification       | Versions, flags, expected components and exact current source bytes        | Successful import or sufficient privileges                      |
| Earlier private 1.5.0 observation | Predecessor ran in one environment and exposed a parent-only unmanaged gap | Fresh public 1.5.1 import or every positive classification live |
| Independent community review      | Not collected at initial publication                                       | No endorsement follows from an open PR                          |

## Reproduce

Run npm ci, then the [README checks](../README.md). Development dependencies are pinned and not deployed. Path-scoped CI uses Linux/Windows and Node 22/24; a configured workflow is not a successful run until it finishes. PR checks provide the result.

Seven inherited suites cover core/CSV, helpers/transport, focused app behavior, ZIP parsing, results, unmanaged classification and audit integration. The synthetic demo adds an eighth suite for fixture-driven UI and loopback-server behavior. Cases include command-only overrides, creations as candidates, affected managed controls, hides/rules, equivalent XML, context isolation, denied sources, empty layers and layer-assisted refinement. Public packaging adds hide-target and ValueRule field-reference assertions.

[Local validation output](../evidence/local-validation.txt) records actual command results. [Checksums](../releases/checksums.json) include source-resource hashes. ZIP timestamps may vary; the build promise is source-content consistency, not bit-for-bit identical archives.

## Prior runtime observation

A private 1.5.0 predecessor was exercised with an administrator account. Repeated direct launches and two scans completed consistently. A modern managed layer was returned; an unmanaged Application Ribbon parent returned no full stack. Positive unmanaged creation/override cases used fixtures, without synthetic production customizations. Raw exports, environment/user identifiers and private screenshots are excluded.

1.5.1 formats source, adds public tooling/demo/docs, exposes hide-target/field references, and removes private app mappings/icon/channel dependencies. **These newly packaged binaries were not imported into a fresh Dataverse environment during publication.** This remains the first independent acceptance gate.

## Independent results

### Two separate validation tracks

**Public-package acceptance** checks fresh sandbox installation, app sharing, permissions, launch, upgrade/uninstall and controlled fixture behavior. It establishes portability of this release.

**Source-environment finding investigation** concerns the earlier unmanaged Application Ribbon parent. Its flag was returned but its full stack and specific child change were not established. Investigate that environment's Command Checker/exported definitions, preferably using an appropriate sandbox copy. A successful installation in an unrelated fresh sandbox does not resolve this finding or prove the original environment clean.

Use the [review template](EXPERT_REVIEW.md). Include commit/package hash, platform build, privilege context, expected/actual evidence, reproduction and unknowns. Separate successful installation, verified findings and endorsement. Never upload tenant exports or credentials to substantiate a review.
