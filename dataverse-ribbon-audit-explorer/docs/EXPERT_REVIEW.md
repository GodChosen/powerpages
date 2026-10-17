# Independent technical review template

This is a blank template, not a completed review or endorsement. Submit sanitized evidence through an issue/PR.

- Reviewer/affiliation (optional; obtain permission before quoting):
- Date, commit SHA, source version and package SHA-256:
- Environment type/platform build (no private domain, tenant ID or credentials):
- Reviewer-role privilege context:
- Scope/exclusions:

| Case                                    | Expected                                     | Actual evidence | Pass/fail/inconclusive |
| --------------------------------------- | -------------------------------------------- | --------------- | ---------------------- |
| Fresh managed import/sharing            | App opens; no private role mappings imported |                 |                        |
| Command-only unmanaged override         | Override and affected existing button        |                 |                        |
| New unmanaged item, no managed baseline | Candidate, never confirmed creation          |                 |                        |
| Rule change/global hide                 | Findings and references                      |                 |                        |
| Empty/denied layers                     | Gap, never clean result                      |                 |                        |
| Default Solution membership only        | No inferred unmanaged override               |                 |                        |
| Sandbox upgrade/uninstall               | Behavior/dependencies as documented          |                 |                        |

List false positives/negatives, fixtures, synthetic screenshots, issue links and recommendations. Separate observations from inferred causes. Specify whether this is an installation test, technical review or explicit endorsement. Attribution/quotation consent:
