# Security and data handling

Scope: dataverse-ribbon-audit-explorer/ only, not every repository project.

## Report privately

Do not put credentials, customer metadata or exploitable details in public issues. Use [GitHub private vulnerability reporting](https://github.com/GodChosen/powerpages/security/advisories/new) if available. Otherwise request a private contact channel through a minimal issue without sensitive details, and wait for the maintainer to arrange it. No response-time SLA or external security audit is claimed.

## Boundaries

Runtime uses the signed-in user's same-origin Dataverse session for GET requests. It does not configure client secrets, send telemetry, execute discovered scripts, write business records, remove layers or upload exports. Installing the solution is a separate metadata deployment. No role creation or app-access grant is included.

Metadata may be sensitive: exports contain names, GUIDs, paths, functions and XML. Scan data stays in page memory until reload; downloaded files persist in browser storage locations. Review them under your organization's handling rules before sharing.

Continuation links are restricted to the environment API. DTD/entity declarations are rejected; output uses text nodes. CSV is escaped and leading formula characters protected. These address specific hazards; they are not complete security assurance or a guarantee for every downstream spreadsheet.

The demo binds to loopback, restricts paths/methods and uses a restrictive content policy. Its fixture transport never forwards to Dataverse. Demo and npm dependencies are excluded from installed resources. Development dependencies are pinned. Review dependency/CI changes with code changes.
