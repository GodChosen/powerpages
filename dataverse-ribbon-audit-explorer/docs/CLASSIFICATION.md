# Classification specification

## Three independent dimensions

1. **Membership:** which solutions contain the exact object ID. This is neither exclusive ownership nor an active layer stack.
2. **Origin:** returned definition flags and recognized publisher IDs. Custom includes unmanaged customizations. OOB requires returned managed definitions linked to recognized Microsoft factory publishers. Other cases remain Not verified; this is not complete introducing history.
3. **Unmanaged audit:** item definitions or returned layers establishing an unmanaged creation/override candidate. OOB origin does not override this dimension.

Solution type uses `solution.ismanaged`. A managed component can be listed in unmanaged Default Solution without an unmanaged customization.

## Classic identity and comparison

The key is exact **table context + XML element kind + item ID**. Global and table contexts differ. Button, CommandDefinition and EnableRule sharing an ID are separate items. An element-kind change can need manual review rather than being inferred as an override.

The parser covers Button, SplitButton, FlyoutAnchor, CommandDefinition, full DisplayRule/EnableRule definitions and HideCustomAction. Standalone command/rule rows are emitted for unmanaged or unknown flags; managed definitions remain comparison evidence. Menu containers are not separate button rows.

| Finding                            | Rule                                                                                               | Interpretation                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unmanaged override                 | At least one unmanaged definition differs from every observed managed definition for that key.     | Inspect XML. The immediately underlying effective managed layer may not be identified.                                                      |
| Unmanaged duplicate                | Both states exist; every unmanaged definition matches an observed managed definition.              | Unmanaged presence still matters; removal is not automatically recommended.                                                                 |
| Unmanaged creation candidate       | Unmanaged definition exists; no same-item managed definition returned.                             | Cannot distinguish creation from an override of an inaccessible baseline.                                                                   |
| Unmanaged hide action              | Unmanaged HideCustomAction without returned same-item managed baseline.                            | Location identifies a target; that control may be outside the diff. A differing same-item managed hide can instead classify as an override. |
| Affected by unmanaged command/rule | A control without observed unmanaged definition references a command/rule with unmanaged evidence. | The control may remain managed/OOB. An already unmanaged control retains its own classification and adds the related-item explanation.      |
| Not verified                       | Missing management flags, without sufficient unmanaged evidence.                                   | Never replace with prefix-based guesses.                                                                                                    |
| No unmanaged definition observed   | Returned classic item definitions are managed.                                                     | Does not prove absence of other unmanaged layers.                                                                                           |

Command resolution checks table then global context. Affected-rule tracing follows exposed references; it is not a general runtime execution graph. Dependencies can union references across definitions without asserting that all execute.

## Layers and parent evidence

When a provider exposes supported XML attributes (`rdx`, `commanddefinition`, `ruledefinition`, `ribbondiffxml`), matching item definitions are incorporated. A candidate can become an override when a differing managed definition appears. Unrelated item IDs do not establish a baseline.

An unmanaged ribboncustomization parent is a **parent review finding**, not proof of a specific new button. It can exist without returned child unmanaged definitions.

Modern commands/pages with unmanaged evidence but no managed evidence are creation candidates. Both management states yield **Unmanaged layer over managed component**: component-level evidence, not a field-level difference. Without unmanaged evidence this path currently remains Not verified, with its explanation.

## Never inferred

- Confirmed creation from a missing baseline.
- Cleanup safety from names, prefixes, dependency counts or scan success.
- Layer order from membership, version or timestamps.
- Microsoft origin merely from a managed flag or appaction's Origin choice.
- A clean table from no definitions, or a clean component from an empty stack.
- Runtime equivalence from structural XML equality.

Unknown/candidate states are part of the contract. Stronger conclusions require positive fixtures and counterexamples showing why the evidence suffices.
