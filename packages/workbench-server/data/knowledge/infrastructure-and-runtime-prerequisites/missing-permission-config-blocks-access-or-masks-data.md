# Missing Permission Configuration Causes Pages Inaccessible or Data Masked

- **Scope**: pages, menus, interfaces unavailable, or results masked by real data permissions; when the user's or position's permission configuration is incomplete.
- **Mechanism source**: the query backend permission system (API/menu permissions, data permissions, assigned via position association); `util/DslPermissionUtil.java` column masking implementation.
- **Last verified**: 2026-08-26.

## Symptoms

- Page inaccessible; function entries, buttons, or menus invisible/unavailable.
- Interface request fails, with error information pointing to permissions, auth, login state, or authorization.
- Some columns in the query result show `****`.

## Possible Causes

- **API / menu permission** missing: page or interface inaccessible; distinguish from expired login state, proxy errors, and service failures.
- **Data permission** missing: row permission filtering reduces visible rows; column permission replaces unauthorized columns with `****`. Permissions are assigned by position; when the user's position has no corresponding permission configured, the visible scope is empty.

## Distinguishing Characteristics

- Entry-layer failure (page/interface) and data-layer masking (`****` in results) are two kinds of permissions, with different investigation entry points.
- `****` appearing in results cannot directly confirm this entry: at least three mechanisms produce it; first go through [Mechanism triage for masked placeholders appearing in results](desensitized-placeholder-mechanism-triage.md) to falsify other mechanisms.
- Real permissions are determined by the static configuration of the external permission system, behaving consistently for the same user across sessions and questions.

## Verification and Localization

1. Entry layer: record the page, interface, status code, returned message, and user position; distinguish auth failure (login state) from missing authorization (permission not configured).
2. Data layer: confirm the user's position's API/menu and data permission assignment in permission management; comparing the same operation or query under different known identities is the most direct evidence.
3. Permission changes must be made by an authorized user in the permission system; after the change, retest with the same identity and confirm only the expected scope is restored.

## When to Exclude

- backend logs show this query's execution actually failed — this is an execution failure disguised as a "permission" symptom; prioritize execution-failure investigation.
- Overall anomalies caused by service unavailability or configuration errors — not a permission problem.
