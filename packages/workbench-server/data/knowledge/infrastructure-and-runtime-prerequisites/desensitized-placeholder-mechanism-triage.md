# Mechanism Triage for Masked Placeholders Appearing in Results

- **Scope**: query results, tables, or reports contain `****` placeholders and their source needs to be determined; does not cover page/menu-level authorization failures.
- **Mechanism source**: the query backend `util/DslPermissionUtil.java` (`dealDslAnswerWithPermission` / `dealAfterCalculateAnswerWithPermission`), `service/impl/ABCProgramServiceImpl.java` (`dealPythonReturn`); production error case sets (2026-07/08).
- **Last verified**: 2026-08-26.

## Symptoms

- The entire column or some cells of the result table show `****`.
- Often accompanied by conclusion text claiming "cannot display due to data permission restrictions".

## Possible Causes

`****` has at least three mutually unrelated generation mechanisms, and the conclusion wording does not distinguish them:

1. **Real column permission masking**: FieldPermission is configured on the class and the column is not in the visible set. The system has three mutually independent masking implementations (DSL direct query, post-calculation results, ABC program results), all silent with no logs.
2. **Post-calculation lineage false positive**: the permission judgment for post-calculation results looks up FieldPermission by the className of the output column's lineage; when not found (temporary class names, empty strings, lineage misplacement), the whole column is blacked out, and this branch bypasses the grouping exemption. The characteristic combination "identifier/grouping columns all `****`, while ratio and other multi-source computed columns are normal" is itself this mechanism's signature — multi-source computed columns are skipped from judgment because their lineage source is non-unique, so they are always normal.
3. **Upstream data-fetch failure + fabricated conclusion**: the query actually failed to get data, and the conclusion-generation LLM fabricates the "permission restriction" wording. In this case the `****` may not come from the masking code at all.

The frontend does not generate `****` (verified: on the web side this string only exists as a password input placeholder). Any `****` seen on the page already exists in the backend-returned data; during localization, directly inspect the query data artifacts (`query_runs` / snapshots) to confirm where it entered the data.

## Distinguishing Characteristics

- All three masking paths produce no logs, so **"whether `****` is in the logs" does not constitute evidence**; the underlying execution facts must be checked.
- **Real column permission**: determined by static FieldPermission configuration, consistent for the same user across questions and sessions; the direct-query path exempts grouping columns and derived computed columns, which will not be blacked out.
- **Post-calculation false positive**: only appears in tables that went through post-calculation/pivot — the first raw sub-query table is normal, the second post-calculation table has all identifier columns blacked out. There may be a nearby `WARN Failed to load skills from skills/aftercalculate`, which is an accompanying signal rather than the direct cause (skill load failure goes through the degraded branch and still produces data normally).
- **Fabricated conclusion**: backend logs show this query actually errored or returned empty; the "permission restriction" claim matches no permission-configuration evidence.

## Verification and Localization

1. **First falsify the wording**: locate the query corresponding to this result in backend logs, and confirm whether it successfully returned masked data or simply failed to execute. On execution failure, turn to the corresponding execution-failure investigation (e.g. [Unregistered class names](../standard-query-turn/unregistered-class-name-causes-npe-or-invalid-sql.md)); the "permission restriction" claim does not hold.
2. When the query succeeds, distinguish whether the table went through post-calculation: for post-calculation tables, judge lineage false positives by the "identifier columns black, ratio columns normal" characteristic; for raw direct-query tables, check the user's FieldPermission configuration for that class (external permission system or user supplement).
3. Executing the same query under different known identities and comparing result differences is the most direct evidence for confirming real permissions.

## When to Exclude

- The page as a whole is inaccessible or interface auth fails — belongs to page/API authorization problems, see [Missing permission configuration causes pages inaccessible or data masked](missing-permission-config-blocks-access-or-masks-data.md).
- Results are missing rows rather than columns blacked out: row-permission filtering is also silent, and needs the same session's dual query (no-permission version / row-permission version) or identity comparison to confirm.
