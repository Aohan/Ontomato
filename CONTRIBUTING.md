# Contributing to Ontomato

Thank you for helping. Ontomato is an early preview, so the most useful contributions right
now are bug reports with clear reproduction steps, and feedback on how the ontology model
fits real business data.

## Before you start

- **Questions and ideas** go to [GitHub Discussions](https://github.com/Aohan/Ontomato/discussions).
- **Bugs** go to [GitHub Issues](https://github.com/Aohan/Ontomato/issues). Include the
  Ontomato version or commit, what you did, what you expected and what happened, with the
  relevant logs.
- **Security vulnerabilities** must not be reported in public; follow [SECURITY.md](SECURITY.md).
- **Larger changes** (a new feature, a change to an interface or to the ontomap format)
  start as a discussion or an issue, so the design is agreed before code is written.

## Making a change

1. Fork the repository and branch from `main`.
2. Set up local development as described in [docs/development.md](docs/development.md).
3. Keep one topic per pull request, and keep existing behavior unless the change is about
   that behavior.
4. Run the checks that cover what you changed, for example:

   ```bash
   pnpm typecheck:workbench
   pnpm test:workbench
   pnpm lint:workbench
   ```

   Java tests that need a database, a model or another external system are not run as a
   whole suite; run the tests for the classes you touched.
5. Write commit subjects in English as `type: description`, for example
   `fix: keep the relationship order when saving the ontomap`.
6. Open a pull request against `main` that says what changed, why, and how you verified it.

Pull requests are not merged on GitHub. `main` receives one commit per published
snapshot of the maintainers' development line, so an accepted pull request is applied
there, with your commits and authorship kept, and reaches `main` with the next
snapshot, which credits you as a co-author. The pull request is then closed with a
link to that commit.

Do not commit real configuration, credentials or business data.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
