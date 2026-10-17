# Release procedure

Source/npm version is 1.5.1; solution version is 1.5.1.0. Solution unique name stays DataverseDependencyExplorer; prefix stays dexp. Preserve stable IDs for upgrades.

The deployment source excludes private app-role assignments, the source environment's default-icon dependency and app-channel preference. The script stages six current resources, updates version/Managed flags, and packs each solution type without deploying. Keep the SolutionManifest MissingDependencies element present even when empty: removing the container can pass XML/schema checks but fail Dataverse manifest import.

1. Install PowerShell, [Power Platform CLI](https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction) and supported Node. Run npm ci.
2. Run syntax, tests, demo, documentation and format checks from README.
3. Run `./scripts/build-release.ps1`. Output/staging stays under ignored artifacts/.
4. Review package verification: current source hashes, flags/version, eight roots, six resources, five asset dependencies, and absence of known private strings/mappings. This hygiene check is not a general secret-scanner guarantee.
5. Copy reviewed ZIPs and checksums.json into releases/; run `npm run release:verify`.
6. Perform sandbox acceptance from the installation guide. If not performed, keep the developer-preview label and record the gap. Local ZIP checks do not prove import success.
7. Update CHANGELOG and evidence. Use only synthetic-demo screenshots. Inspect the diff for customer metadata.
8. Open a PR with actual results and open gates. Tags/GitHub Releases are a later maintainer decision after review.

CI has read-only repository permissions and no Dataverse credentials. It validates local artifacts; it does not import this tool or alter unrelated deployment workflows.
