# Dataverse 1.5.1 validation and handover

Executed 17–18 October 2026 (Europe/London) in one Dataverse sandbox, platform build 9.2.26091.152. The user selected an administrator account with System Administrator and Basic User roles. No role assignments were changed. This validates administrator access; it does not establish a minimal reviewer role.

The exact corrected public ZIP hashes tested are recorded in the [sanitized evidence record](../evidence/dataverse-validation-1.5.1.json) and [package checksums](../releases/checksums.json). These are locally built packages, not new production exports.

| Check                        | Result                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Clean managed installation   | Passed; version 1.5.1.0, all six deployed resource hashes equal source                                                              |
| Administrator access         | Ready 1.5.1 and scans in the direct resource and model-driven app                                                                   |
| Repeated launch              | Three normal Maker Play launches and three direct resource launches passed                                                          |
| Scan and CSV export          | 2,835 rows, 871 table names, 872 coverage rows including Application Ribbon; zero source-request notes                              |
| Managed upgrade              | Generated 1.5.0.0 baseline upgraded to public 1.5.1.0; obsolete canary removed, seven resources reduced to six; no holding solution |
| Post-upgrade runtime         | Six source hashes matched; scan returned 2,835 rows                                                                                 |
| Managed uninstall            | Two cycles passed, including after upgrade; no tool app/resources remained                                                          |
| Unmanaged installation       | Passed; six unmanaged resource hashes matched and scan returned 2,835 rows                                                          |
| Unmanaged container deletion | Expected: all six resources remained; deleting a solution container is not an uninstall                                             |
| Explicit unmanaged cleanup   | Test app, sitemap and six resources removed; original three solution names/versions and account roles unchanged                     |

## Defect found and corrected

The first candidate failed solution-manifest import with an object-reference error. Restoring the required empty MissingDependencies container resolved the import. Runtime source was unchanged. Both public packages were rebuilt and retested. Package verification now requires this element, and a regression test removes it from a disposable ZIP and checks that verification rejects it.

The organization disabled asynchronous operations; synchronous imports succeeded without changing that setting. No global publish-all or business-component cleanup was performed.

## Upgrade method and limits

The disposable baseline used the current runtime with solution metadata version 1.5.0.0 and one unreferenced canary resource. Importing the public managed package with stage-and-upgrade removed that canary. This exercises upgrade/removal behavior; it is not proof of compatibility with every historical 1.5.0 package or customer customization. Preserve backups and test your own upgrade path.

One automation-driven main.aspx navigation remained at the host shell, while all three normal Maker Play launches completed. An initial direct navigation also exceeded the controller timeout before subsequently reaching Ready. These observations do not support a universal app-shell fix or a load-time guarantee.

Zero source-request notes means these requests completed in this account/context. It does not prove complete platform metadata or correct classification of every customization. Controlled positive classic/modern creation and override scenarios remain synthetic-fixture evidence rather than a completed live sandbox matrix.

## Cleanup evidence and handover

Managed removal was verified through solution, app and resource queries. For the unmanaged package, deleting the container left the app/resources as expected. Only the test-created app, sitemap and six exact resources were then deleted. Final queries found zero tool apps/resources; Maker Default Solution showed the test sitemap absent. A direct sitemap API check returned a platform default-sitemap error, so that query is not counted as cleanup proof. No publisher removal or full environment-state restoration is claimed.

Production was not changed. Raw tenant exports, logs, screenshots and identifiers remain private. Public documentation contains sanitized counts and package hashes only.

For community evaluation, use the managed package in a sandbox, follow [installation and removal](INSTALLATION.md), and report findings using the [expert review template](EXPERT_REVIEW.md). Non-admin access, cross-tenant behavior, accessibility/performance certification and independent review remain unestablished.
