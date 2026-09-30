# Missing Star Chart Full Data Causes Retries Every Second

- **Scope**: the query backend backend logs keep showing `conf/starChart/wholeData-….json (No such file or directory)`; star chart / graph full-data requests remain unresponsive for a long time.
- **Mechanism source**: the query backend `dao/StarChartDao.java` (`readWholeData` logs ERROR on file read failure and returns null), `service/impl/DataServiceImpl.java` (`initService` queue loop, sleeps 1 second and re-queues when data is unavailable).
- **Last verified**: 2026-08-26.

## Symptoms

- backend.log repeatedly prints the same starChart config file FileNotFoundException at a stable interval of about 1 second, which can span the entire time window (hundreds of times).
- Features that need star chart / graph full data keep waiting without getting data.

## Possible Causes

Star chart full data is persisted as files (`conf/starChart/wholeData-<mode>-<version>-<domainId>.json`), written by the data build flow. The read side is a background queue loop: when the file cannot be read, it sleeps 1 second and re-queues the request, retrying indefinitely with no backoff and no abandonment. When a domain's full data has never been built successfully (or the file was cleaned up, or the working directory is wrong), one read request permanently produces one ERROR per second.

## Distinguishing Characteristics

- The error appears at a fixed period, carries no sessionId, and is unrelated to the timeline of any specific query request — **for the current query failure it is background noise, not the root cause**; during diagnosis, first exclude it from the current error set by its periodicity and non-association.
- But when the user's request itself needs graph/timeline visualization output, it is a real blocking cause for that request and needs separate evaluation.

## Verification and Localization

1. Count the time distribution of this error: fixed 1-second period, spanning multiple unrelated requests → judge it as an independent background loop, decoupled from the current query failure.
2. Check whether the target file path exists, whether the star chart full-data build for the corresponding domain has been executed, and whether the service working directory matches the expected relative path of `conf/`.

## When to Exclude

- The error appears only once or twice after a graph operation and then stops — normal build-timing wait, not this entry.
- When the current query failure's direct errors (SQL, NPE, parsing errors) have another clear source, this entry does not explain those failures.
