import { appTextAnalysisEn } from "./app-text-analysis-en";
import { appTextDiagnosisEn } from "./app-text-diagnosis-en";
import { appTextFoundationEn } from "./app-text-foundation-en";
import { appTextSkillsEn } from "./app-text-skills-en";
import { appTextQueryEn } from "./app-text-query-en";
/** Original summary and threads copy of OSS b6437c86. Used only by the fixed appTextLocale=en. */
export const appTextEn = {
  ...appTextDiagnosisEn,
  ...appTextAnalysisEn,
  ...appTextQueryEn,
  ...appTextFoundationEn,
  ...appTextSkillsEn,
  "summary.title": "# Workspace Diagnosis Summary",
  "summary.chainMode": "Chain mode: {mode}",
  "summary.chain.harness": "ABC Harness",
  "summary.chain.standard": "Standard ABC",
  "summary.chain.unrecognized": "Unrecognized",
  "summary.question": "# User Question",
  "summary.logic": "# Query Logic",
  "summary.role.analyzer": "Question Analyzer",
  "summary.role.dsl": "DSL Generator",
  "summary.role.calculator": "Data Analysis Expert",
  "summary.role.harness": "ABCHarness Programmer",
  "summary.analyzer.heading": "# Question Analyzer Output",
  "summary.dsl.heading": "# Sub-question DSL",
  "summary.dsl.item": "## Sub-question {index}",
  "summary.calculator.heading": "# Data Analysis Expert Python Code",
  "summary.calculator.noPython": "(output does not contain a Python code block)",
  "summary.python.item": "## Python Code {index}",
  "summary.harness.heading": "# ABCHarness Programmer",
  "summary.harness.rounds": "- Rounds: {count}",
  "summary.harness.artifacts": "- See full tool-loop artifacts in `{dir}/{file}-*.md`",
  "summary.harness.lastRound": "## Last Round Output",
  "summary.harness.pythonHeading": "## Python Code Block",
  "summary.harness.pythonItem": "### Python Code {index}",
  "summary.missing.heading": "# Backend ABC Role Output",
  "summary.missing.body":
    "No backend ABC role output was captured (Question Analyzer / DSL Generator / Data Analysis Expert / ABCHarness Programmer).This usually means prompt extraction is abnormal or backend agent-llm evidence is missing; please first check `{rawLogs}/` and backend log collection, then diagnose the query logic.",
  "threads.noAccess": "No access",
  "threads.notFound": "Not found",
};
