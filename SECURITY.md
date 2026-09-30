# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues, discussions or pull
requests.

Report them privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Include:

- the Ontomato version or commit you tested,
- the affected component (Workbench, data engine, Ontology Manager, agent skills or the
  deployment files),
- steps to reproduce, and the impact you observed.

We will acknowledge the report, keep you informed while we investigate, and credit you in
the advisory unless you prefer otherwise.

## Supported versions

Ontomato is an early preview. Security fixes are made on the latest `main`.

## Deployment assumptions

The open-source edition has no login: everyone who can reach its ports has full access to
the ontology, the connected database and the model configuration. It is meant to run on a
trusted network. Reports that only restate this are expected behavior; reports that let
someone reach or affect data beyond what the deployment exposes are in scope.
