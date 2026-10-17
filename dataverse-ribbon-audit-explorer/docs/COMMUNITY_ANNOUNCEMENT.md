# LinkedIn launch draft

Use the project link once the PR is merged. Before that, share the PR as a request for review, not an accepted release.

---

When you inherit a Dynamics 365 environment, how do you find unmanaged ribbon customizations if nobody knows which tables the previous team changed?

I have been building Dataverse Ribbon and Command Audit Explorer to make that investigation easier. It brings classic buttons, standalone commands/rules, hide actions, modern commands and available layer evidence into one review table.

One design choice matters: membership in an unmanaged solution is not proof of an unmanaged override. Likewise, no returned managed baseline does not prove a newly created button. The tool keeps those distinctions visible instead of declaring the environment clean.

I am sharing a community developer preview with source, managed/unmanaged packages, synthetic demo, tests and architecture/classification documentation:

https://github.com/GodChosen/powerpages/tree/master/dataverse-ribbon-audit-explorer

I welcome independent review from Dynamics 365 developers and Power Platform architects, particularly classic command-only overrides, missing baselines, least-privilege access and fresh-sandbox package validation. Please contribute reproducible issues or sanitized test cases.

This is an investigation aid, not automated production cleanup. The public package still needs independent fresh-environment validation.

#PowerPlatform #Dynamics365 #Dataverse #ALM #OpenSource

---

Do not add adoption figures, expert approval, production-readiness claims or customer attribution without evidence and permission. Link specific reviews when available; constructive feedback is not automatically endorsement.
