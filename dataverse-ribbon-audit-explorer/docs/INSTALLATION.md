# Installation and permissions

## Deployment shape

This is a browser web resource hosted in a Dataverse model-driven app. It is not a Power Pages site, browser extension, server plug-in or hosted scanning service. The repository also hosts Power Pages projects; this folder is self-contained.

Use a Dataverse sandbox with model-driven apps and readable solution/ribbon metadata. Provider/schema availability varies. A missing entity, column or privilege is a coverage gap, not a reason to grant broad production access automatically.

## Import

1. Download the managed ZIP from the [README](../README.md). Compare its SHA-256 with [checksums.json](../releases/checksums.json), for example using `Get-FileHash -Algorithm SHA256 <downloaded-file>`.
2. In Power Apps, select the sandbox, then **Solutions → Import solution**. Import the managed package and review dependency warnings. It contains no business tables or cleanup operations.
3. Locate **Dataverse Ribbon and Command Audit Explorer**. An administrator must configure app sharing for intended reviewers. Private-environment role mappings were removed; no role or privilege grant is included.
4. Publish the imported app/resources as required. Confirm **Ready — source 1.5.1**. An internal predecessor uses the same solution identity and prefix; back it up and review the upgrade before importing over it.
5. If app navigation is unavailable, an authorized user can open `https://YOUR-ORG.crm.dynamics.com/WebResources/dexp_/dependency/index.html`, substituting the environment hostname.

Solution unique name remains `DataverseDependencyExplorer`; app unique name remains `dexp_DataverseDependencyExplorer`; publisher prefix is `dexp`. Stable component IDs are deployment identity, not customer identifiers. The public package omits source-environment app-role mappings, an external default-icon dependency and an app-channel preference. Review app access and target default presentation/channel locally.

## Access

Requests use the signed-in user's existing same-origin Dataverse session. No client secret, app registration or API token is configured. Reads cover table metadata, solutions/components, classic ribbon records, appactions, custom pages and available component layers. Direct dependency lookups use required/dependent-component functions.

The corrected public 1.5.1 packages were exercised in a sandbox with System Administrator and Basic User roles, as selected by the user. See the [completed validation](DATAVERSE_VALIDATION.md). A minimal custom-role privilege set has **not** been established. Do not assume System Customizer or an ordinary user covers every endpoint. Validate the reviewer role in a sandbox; 401/403 means incomplete coverage. Installing/sharing the app and scanning are separate permission concerns.

## Sandbox acceptance

- Load the app and direct resource three times; record host-shell/cache differences.
- Verify source notes, table roster and Application Ribbon coverage.
- Test controlled managed/unmanaged new buttons, command-only overrides, rule changes, hides and modern commands. Compare with Command Checker and exported RibbonDiffXml.
- Verify empty/denied layers are inconclusive and Default Solution membership does not create an override finding.
- Review both CSV exports before broadening access.

Report sanitized results through [CONTRIBUTING](../CONTRIBUTING.md).

## Upgrade and removal

Retain previous packages and acceptance records. Test upgrades first. Uninstalling the managed Explorer removes its app/resources subject to normal dependency checks; it does not remove discovered customizations. Investigate blocked dependencies rather than deleting audited business components. Rehearse recovery using your environment backup strategy; an older ZIP is not a guaranteed rollback.

The unmanaged ZIP is for development. Deleting its solution container leaves components in the environment. In an isolated test environment, remove the test app, its sitemap, then index.html and the remaining five resources only after checking dependencies. Never delete shared or audited business components to clean up this tool. This behavior and explicit test-component cleanup were verified in the sandbox lifecycle run.
