# Northstar Training deployment companion

This executable companion targets only the approved **Training** environment
and its **Enhanced (model 2)** Northstar site. It is separate from the book's
standard-model example and from the existing `osazeedemo` site in the public
`GodChosen/powerpages` repository. The repository's actual default branch is
**master**; all hosted deployment guards use that branch.

## What each stage proves

**Build** restores locked dependencies with .NET SDK 8.0.426, compiles and runs
the lifecycle's offline tests, and runs deployment/integrity/crypto tests.
This is an **unsigned development build**; it requires no published SNK and
does not claim that its DLL was deployed to Dataverse.

**Export** is a manually dispatched, protected OIDC job. It exports the actual
unmanaged `NorthstarHandbookValidation` solution and model-2 site from Training,
requires the registered `Northstar.Lifecycle.dll` to be present, records its
SHA-256, packages per-file digests and the approved policy/source revision, and
encrypts the entire release before uploading an artifact. An export containing
only schema is rejected. The source commit identifies reviewed pipeline/source
state; it does not by itself prove that CI compiled the exported signed binary.

**Deploy** decrypts two reviewed, digest-verified artifacts in a protected job,
checks producer run/repository/branch/source, live tenant, environment, site,
Enhanced model and existing unmanaged solution state, then imports the unmanaged
lab update and uploads the site with explicit target/profile/model arguments.
It downloads a private post-upload export and reports
`UPLOADED_PENDING_RUNTIME_ACCEPTANCE`.

**Rollback** replays only the verified prior site configuration. It does not
restore business data, downgrade managed solutions, delete new components or
undo external effects. Unmanaged metadata/assembly changes require a reviewed
forward-fix release compatible with the restored site. No destructive migration,
unmanaged-to-managed conversion, automatic rollback or business-write retry is
performed. Managed production promotion needs a separately approved target and
is **not** demonstrated by this in-place Training pipeline.

## Current readiness

Local PAC **2.9.3** and read-only Training checks verified the approved tenant,
environment, organization, website/portal IDs, Enhanced model and unmanaged
solution. Offline tests exercise guard failures and AES-256-GCM authentication.
Their reports are `test-results.json` and `crypto-test-results.json`.

Repository inspection found no existing workflows, secrets, variables or GitHub
environments, and master was unprotected. No identity, security grant, secret,
environment or branch rule has been created by these files. Hosted execution
requires the concrete administrator approvals below. The actual lifecycle
assembly and steps must be registered and included in the exported solution
before Export succeeds.

## Artifact confidentiality and integrity

The public repository must never receive plaintext release ZIPs, actual private
principal allowlists, site settings, raw diagnostics, manuscripts or private SNK
files. Only `release.enc.json`, a ciphertext SHA-256/source-commit summary, and
sanitized deployment status can be uploaded.

`ArtifactCrypto.psm1` encrypts with AES-256-GCM using a fresh random 12-byte nonce,
a 16-byte authentication tag and the protected environment's 32-byte key.
Authenticated additional data binds format, exact repository, environment and
source revision. The deployment job verifies ciphertext SHA-256 and GCM before
writing plaintext. Wrong keys, tag modification, changed source/context and
output paths outside the explicit private working root are rejected.

The inner release records every file hash/size, approved policy SHA-256, source
commit, exported assembly SHA-256 and target. Unsafe ZIP paths, symlinks,
undeclared/tampered files, unmanaged/managed mismatches, another site's export,
nonempty deletion manifests and changed deployment profiles are rejected.

All real plaintext CI exports and extraction are under `runner.temp`. Cleanup
is attempted in `finally`; this is best-effort deletion, **not secure erasure**.
Use ephemeral hosted runners. The protected `NORTHSTAR_ARTIFACT_KEY` must remain
available for retained baseline artifacts; rotating it makes old envelopes
undecryptable unless the old key is retained through a separately reviewed
rotation procedure.

## Local runner

PowerShell 7, PAC 2.9.3 and the lifecycle's pinned .NET SDK are prerequisites.
Paths below are examples; no command silently uses a default authentication
profile or an unreviewed environment.

```powershell
pwsh -NoProfile -File ./tests/Test-Pipeline.ps1
pwsh -NoProfile -File ./tests/Test-ArtifactCrypto.ps1
pwsh -NoProfile -File ./Invoke-TrainingPipeline.ps1 -Mode Package `
  -SitePath C:/private/reviewed-site `
  -SolutionPath C:/private/NorthstarHandbookValidation_unmanaged.zip `
  -SourceRevision <full-40-character-source-commit> `
  -OutputPath C:/private/releases/release.zip
pwsh -NoProfile -File ./Invoke-TrainingPipeline.ps1 -Mode Plan `
  -ArtifactPath C:/private/releases/release.zip -ExpectedSha256 <candidate-sha256> `
  -RollbackArtifactPath C:/private/baseline/release.zip -RollbackSha256 <baseline-sha256>
```

Plan verifies artifacts and prints explicit commands without authentication or
network changes. Local authenticated operations require a **named Training-bound
PAC profile**; an OCHI/default-environment profile is rejected. Create it
interactively first, then explicitly select it through the runner:

```powershell
pac auth create --name northstar-training `
  --tenant ae98a065-3249-4ddf-8d8d-801177e90ba1 `
  --environment https://powerpagestraining.crm11.dynamics.com/ --deviceCode
pwsh -NoProfile -File ./Invoke-TrainingPipeline.ps1 -Mode Export `
  -Authentication ExistingProfile -AuthProfileName northstar-training `
  -Confirmation TRAINING -OutputPath C:/private/fresh-training-export
```

Local Deploy adds `-Mode Deploy -Authentication ExistingProfile
-AuthProfileName northstar-training -Confirmation TRAINING` to the Plan inputs.
Keep `.pipeline` evidence private. Local Package/Plan operate on plaintext
private files; the hosted workflow encrypts/decrypts around these same steps.
The explicit `training.deployment.yml` is a SHA-256-pinned empty mapping: no
Enhanced-model override keys or identity values are invented.

## Public repository installation

```text
.github/workflows/northstar-training.yml
northstar/implementation/deployment/...
northstar/implementation/lifecycle/...
```

Copy only the workflow to root `.github/workflows`. Do not copy remote-checkout,
test-output, .pipeline, artifacts, evidence, binary exports or private signing
keys. Preserve the existing osazeedemo tree.

Before activating Export/Deploy, obtain explicit approval for:

1. Master branch protection and the **northstar-training** GitHub environment,
   with required reviewers, prevent self-review and master-only deployment
   branches. The workflow checks these settings and rejects missing protection.
2. A dedicated Entra deployment application and federated trust:
   - issuer: `https://token.actions.githubusercontent.com`
   - subject: `repo:GodChosen/powerpages:environment:northstar-training`
   - audience: `api://AzureADTokenExchange`
3. That application's user and a reviewed deployment role **only in Training**.
   A System Customizer role is a candidate starting point; verify the required
   solution import, plugin metadata and website operations. Do not assume it is
   sufficient or automatically escalate to System Administrator. Test the exact
   application role in Training. This deployment identity is separate from
   customer runtime identity.
4. A random 32-byte base64 environment secret named **NORTHSTAR_ARTIFACT_KEY**.
   Do not print the value or commit it. This encrypts release artifacts; PAC
   authenticates through OIDC and requires no client-secret GitHub secret.

Record the approved application's nonsecret client ID in `target.training.json`
and regenerate packages because that policy hash changes. Do not create the
application, federated credential, role or secret merely by merging a PR.

After registration/runtime tests and these grants, dispatch Export from master
to produce an encrypted candidate/baseline artifact. Review the cipher SHA-256
and source SHA in its public summary. Dispatch Deploy/Rollback with successful
producer run IDs, the two **ciphertext** SHA-256 values and `TRAINING`.

Perform anonymous denial, customer A/B isolation, tampered identity, lifecycle,
CSRF and post-upload tests. Import/upload success is not runtime acceptance.

## Primary references

- [PAC GitHub-federated authentication](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/auth)
- [Power Pages CLI profiles and manifests](https://learn.microsoft.com/en-us/power-pages/configure/power-platform-cli)
- [GitHub OIDC and protected environments](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure)
- [Entra federated credential setup](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust?pivots=identity-wif-app-reg-github-actions)
- [Unmanaged-to-managed migration requires deliberate target preparation](https://learn.microsoft.com/en-us/power-platform/alm/move-from-unmanaged-managed-alm)

Actions are pinned to commits in their official repositories. PAC is pinned to
2.9.3. Review tool upgrades as source changes instead of floating action tags.
