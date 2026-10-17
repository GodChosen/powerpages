# Review workflow and exports

1. Scan with the intended reviewer account in an approved environment. Inspect coverage and source-request notes.
2. Export **table coverage CSV**. It lists every returned table plus Application Ribbon/additional contexts. No returned definitions means follow-up, not passed checks.
3. Filter **Unmanaged audit → Unmanaged evidence found**. Inspect the finding, reason, item XML and layer status together.
4. Keep Origin separate: a managed/OOB button can reference an unmanaged command/rule; unmanaged membership proves neither creation nor override.
5. Investigate unresolved classic evidence with Command Checker and an unmanaged export containing the relevant table/Application Ribbon. Compare with intended managed source. [Microsoft ribbon guidance](https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-apps/create-and-use-apps/remove-an-unmanaged-layer-for-ribbon).
6. Record a human decision: retain/migrate, investigate, or propose removal. The viewer does not store approvals or execute cleanup. Rehearse deployment/removal and recovery in a sandbox.

## Result CSV

Exports contain **all matching rows**, not only the page. Filters apply before sorting/pagination.

| Group      | Fields                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------- |
| Identity   | name, type, logicalName, table/tableContext, sourceIds                                        |
| Membership | solutions, solutionType, solutionBasis; membership/source evidence remains labeled            |
| Origin     | origin, originReason; limited provenance, not historical ownership                            |
| Layers     | definitionLayers, solutionLayers, layerStatus; Not requested/empty/incomplete remain explicit |
| Audit      | auditFinding, auditReason, unmanagedObserved, itemDefinitions; retained item XML only         |
| References | dependencies, dependencyNotes, platformState; static references, sometimes on demand          |
| Coverage   | scanCoverage, scanNotes; inspect before interpreting an empty queue                           |

Nested values are JSON serialized into CSV cells. Values are escaped and leading formula characters protected. Exports can reveal private table/solution names, script paths/functions and XML. There is no fixed export-size limit; large scans can create large in-memory files.

## Table coverage CSV

Fields: table, classicDefinitionsReturned, unmanagedFindings, status, scanNotes. Counts are rows, not distinct business features, users or root causes. A button and its command may be separate rows; do not present their sum as an incident total.

Evidence reflects lookup time; a refresh may observe subsequent changes. Record environment/tool versions, privilege context and scan/lookup times in the review record. The tool does not produce a transactionally consistent or tamper-evident snapshot.
