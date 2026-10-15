# Contributing to Ontomato

Thank you for helping. Ontomato is an early preview, so the most useful contributions right
now are bug reports with clear reproduction steps, and feedback on how the ontology model
fits real business data.

## Before you start

- **Questions and ideas** go to [GitHub Discussions](https://github.com/ontomato-ai/Ontomato/discussions).
- **Bugs** go to [GitHub Issues](https://github.com/ontomato-ai/Ontomato/issues). Include the
  Ontomato version or commit, what you did, what you expected and what happened, with the
  relevant logs.
- **Security vulnerabilities** must not be reported in public; follow [SECURITY.md](SECURITY.md).
- **Larger changes** (a new feature, a change to an interface or to the ontomap format)
  start as a discussion or an issue, so the design is agreed before code is written.

## Making a change

1. Fork the repository and branch from `develop` as `feature/<topic>` or
   `fix/<topic>`.
2. Set up local development as described in [docs/development.md](docs/development.md).
3. Keep one topic per pull request, and keep existing behavior unless the change is about
   that behavior.
4. Run the checks that cover what you changed, for example:

   ```bash
   pnpm typecheck:workbench
   pnpm test:workbench
   pnpm lint:workbench
   pnpm test:scripts   # build, packaging and dev scripts
   pnpm lint:scripts
   ```

   Java tests that need a database, a model or another external system are not run as a
   whole suite; run the tests for the classes you touched.
5. Write commit messages (subjects and bodies) and new or changed code comments in
   English. Use `type: description` for commit subjects, for example
   `fix: keep the relationship order when saving the ontomap`.
6. Open a pull request against `develop` that says what changed, why, and how you verified it.

`develop` is the daily development line; `main` is the release line. A release
merges the reviewed and tested `develop` into `main`, preserving ancestry, and
tags the resulting `main` commit as `v<version>`.

Do not commit real configuration, credentials or business data.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
