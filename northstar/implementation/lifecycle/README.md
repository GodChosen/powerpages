# Northstar request lifecycle implementation

This is original companion implementation code for the isolated `ns_request`
validation lab. It is compiled and deployed to the approved isolated Training
lab. Actual bounded tests proved internal operator identity, Create defaults,
rejection of forged ownership/state/reference fields, and direct Update denial.
Portal command identity, transitions and complete integration acceptance remain
pending. The 79 local tests use SDK interface fakes,
including a nested command-to-Update guard path. They are not a Dataverse
transaction emulator and cannot prove runtime registration, permissions,
concurrency locking or caller context.

## Business and authorization contract

`LifecyclePlugin` runs synchronously in PreOperation on Create, Update and Delete
for `ns_request` only. `LifecycleCreateInputGuard` first runs synchronously at
PreValidation (stage 10, rank 1, calling user), rejecting caller fields before
Dataverse adds ownership, audit and state defaults. Create accepts name, description, contact and optional
primary ID; it rejects owner, lifecycle, processing, reference, public-status and
unknown inputs. PreOperation requires the server-set validation marker from
the current or matching parent context and validates canonical platform fields.
The actual parent observed in Training was stage 30; the handoff does not assume
it is stage 10. It trims and validates text, requires a nonempty Contact lookup,
and assigns Draft / Not started, a random opaque `NS-` reference and public Draft
label on the pending target. The database operation and these values commit
together. A random reference is not a sequential allocation or a unique-key
constraint; add a reviewed alternate key if business uniqueness needs enforcement.

Create does not pretend to derive a customer contact from `InitiatingUserId`.
Standard Power Pages can use a shared application principal. The fixed site
endpoint must derive `Server.User.contactid`, construct the association and prove
the minimum relationship/table permissions. An authorized internal integration
can create for a different contact; this plug-in enforces structural invariants,
not an invented universal mapping between system users and contacts.

Direct updates and deletes are rejected, including updates by administrators
through ordinary CRUD. Draft content edits use `ns_EditRequestDraft`; Draft to
Submitted uses `ns_SubmitRequest`; Submitted to Closed uses operator-only
`ns_CloseRequest`. Closing is an explicit authorized operator assertion that
processing completed, not evidence that an email or external dependency ran.
Submitted and Closed content is immutable. No reopen, cancel, purge or repair
backdoor is included.

Commands accept an explicit row version, require an exact independently configured
principal and validate the stored contact for customer commands. They retrieve a
bounded snapshot, check its version, construct a fixed patch and execute an
`UpdateRequest` with `IfRowVersionMatches`. The Update guard independently checks
the immediate parent command, matching principal/target, server-set marker,
contact and exact derived field set. A marker alone is insufficient. Stale and
race-time conflicts are rejected without automatic retry.

`LifecycleBoundaryGuard` rejects Associate/Disassociate only for the exact
`ns_contact_ns_request` relationship. Because these messages lack per-table
registration filters, those two steps are global but immediately leave every
other relationship unchanged. Per-table Assign and SetState variants are blocked.
The Upsert boundary step is global if no per-table filter exists; it immediately
leaves other primary entities unchanged. These registration details require
review and real regression tests before deployment acceptance.

Nested Create operations are deliberately unsupported: the input guard requires
depth 1 with no parent context. Bulk and integration routes must be checked
against this restriction before adoption; do not bypass the guard to admit them.

Do **not** register blanket CreateMultiple/UpdateMultiple denial steps: Dataverse
merges single and multiple event pipelines, so ordinary single requests also
raise their bulk counterpart. This implementation uses the documented merged
single guards. Actual CreateMultiple, UpdateMultiple, UpsertMultiple,
ExecuteMultiple and specialized-message behavior still needs tenant testing.
Do not claim those cases passed from these local tests. This implementation is
for a Standard Dataverse table, not an elastic table.

## Trusted command entry points

The environment variable `ns_LifecyclePrincipals` must have exactly one definition
and one active current value. There is no default-value fallback. Missing,
ambiguous, invalid, duplicated or overlapping principal IDs fail closed.

```json
{
  "portalPrincipalIds": [],
  "operatorPrincipalIds": [],
  "principalProbeEnabled": false
}
```

IDs are Dataverse `systemuser` IDs, not application IDs, Entra object IDs or
contact IDs. The command requires `UserId == InitiatingUserId` and rejects a
step configured to run as another user. Portal principals can Edit/Submit only;
configured operator principals can Close only. These sets are disjoint.

The portal commands' `CallerContact` parameter is trusted only because a fixed,
reviewed server-logic entry point derives it from its authenticated session and
the command accepts only the allowlisted application principal. A browser value
is not an identity assertion. Never expose a generic arbitrary Custom API proxy,
share application credentials, or reuse that principal for unreviewed code that
can invent contacts. A separately authenticated integration must get its own
reviewed command contract.

The APIs use existing `prvWritens_request` as an execution privilege in addition
to the explicit principal checks. `IsPrivate` only hides metadata; it is not
authorization. Do not grant portal table permissions on the environment-variable
tables. Configuration and code authors remain trusted administrators. Accounts
able to bypass custom business logic are outside this guard's threat boundary;
do not grant or expose bypass requests through customer code.

An optional `ns_VerifyLifecyclePrincipal` API returns only SHA-256 hashes of the
current caller IDs and a same-principal boolean. It rejects unknown principals,
impersonation and disabled `principalProbeEnabled`. Its temporary portal wrapper
must remain administrator-only. Enable the probe only for the reviewed identity
verification, compare with trusted metadata, then set its flag false and disable
the wrapper. It performs no request-row operation and returns no raw identifiers.

## Exact API definitions

All commands are Actions, not Functions, with no third-party processing steps.
The three business actions bind to an `ns_request` Target EntityReference:

| Action | Required inputs in addition to Target | Output |
|---|---|---|
| `ns_EditRequestDraft` | CallerContact Guid; ExpectedRowVersion String; Name String; Description String | Status String `draft` |
| `ns_SubmitRequest` | CallerContact Guid; ExpectedRowVersion String | Status String `submitted` |
| `ns_CloseRequest` | ExpectedRowVersion String | Status String `closed` |

The optional verification Action is global, has no inputs, and returns
UserIdHash String, InitiatingUserIdHash String and SamePrincipal Boolean.
Row versions are nonempty decimal strings of at most 32 characters. No API
returns the stored contact, raw record, connector envelope or backend exception.

## Build and local checks

Run from this directory with .NET SDK 8.0.426 (pinned in `global.json`):

```powershell
dotnet restore src/Northstar.Lifecycle/Northstar.Lifecycle.csproj --locked-mode
dotnet build src/Northstar.Lifecycle/Northstar.Lifecycle.csproj -c Release --no-restore
dotnet restore tests/Northstar.Lifecycle.Tests.csproj --locked-mode
dotnet run --project tests/Northstar.Lifecycle.Tests.csproj -c Release --no-restore
```

The deployed plug-in targets .NET Framework 4.6.2. The Microsoft SDK dependency is
pinned to `Microsoft.CrmSdk.CoreAssemblies` 9.0.2.60, with reference assemblies
1.0.3. Tests target .NET 8 and use the SDK types as a local test harness;
NU1701 compatibility diagnostics are suppressed only in that test project.
The signed local assembly and registration input are in `artifacts/`.
Public CI may compile with `-p:SignAssembly=false` without publishing a private
signing key; that development binary is not the registered signed artifact.

## Deployment review and integration gates

Register the signed, reviewed assembly through an approved deployment process.
Register `LifecycleCreateInputGuard` on Create / `ns_request`, synchronous
PreValidation (10), rank 1, Calling User. Register `LifecyclePlugin` on Create,
Update and Delete / `ns_request`, synchronous PreOperation (20), rank 10000,
Calling User. The Update step requires `PreImage` with all seven columns in
`Contract.ImageColumns`. Bind each business Custom API to `LifecyclePlugin`;
its main operation must be synchronous and transactional. Register the optional
principal proof with `LifecyclePrincipalProbe` only when that reviewed probe is
needed. Review `LifecycleBoundaryGuard` registrations for the exact messages
and relationship described above, including their global registration scope.

Keep deployment journals, signing keys, compiled assemblies, target-specific
registration helpers and principal allowlists outside this public source tree.
Add every registered component to the intended solution before export. Preserve
the approved unmanaged lab route; do not convert it to managed in place. Current
principal values are target configuration, never portable defaults. The hosted
pipeline's source revision and exported assembly digest are separate evidence.
Required real tests include correct Create defaults, field tampering, direct
Update/Delete, contact Associate/Disassociate in both directions, specialized
messages, genuine two-customer command isolation, wrong/unconfigured principals,
missing and ambiguous configuration, latest/stale/concurrent versions, replay,
actual portal application context, and rollback of rejected changes. Validate
that no unintended global relationship behavior occurs. Verify the registered
PreImage contains all seven required columns and every step runs as Calling User.

Do not infer full production readiness from compiling or the fake tests. Retain
the closed write gate until registration and actual transaction/permission
evidence pass. Existing administrators retain their normal platform power; this
solution does not prevent a privileged administrator from disabling the guard.

## Primary references

- [Build and package plug-in code](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/build-and-package)
- [PAC plug-in commands](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/plugin)
- [Dataverse event framework](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/event-framework)
- [Optimistic concurrency](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/optimistic-concurrency)
- [Create and use Custom APIs](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/custom-api)
- [Custom API tables and field types](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/custom-api-tables)
- [Single and multiple plug-in pipelines](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/write-plugin-multiple-operation)
- [Bulk operation messages](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/bulk-operations)
- [Standard versus elastic Upsert behavior](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-upsert-insert-update-record)
