package io.ontomato.dataengine.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import java.util.zip.GZIPInputStream;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.R;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.SessionRegistryDao;
import io.ontomato.dataengine.dao.SessionRegistryEntry;
import io.ontomato.dataengine.util.SystemUtils;

/**
 * Observability log slicing API. The three body endpoints (/app, /agent-llm, /diagnostic-events) all output in a **streaming** way:
 * they scan files while writing matched lines into the response output stream; the backend holds only one line at any moment, with no response size limit and no truncation.
 * The API contract is documented in InfoHub (Observability Log API).
 */
@Slf4j
@RestController
@RequestMapping("/observe/logs")
public class ObserveLogController {

	private static final Path LOG_DIR = Paths.get("./logs");
	private static final String APP_LOG_NAME = "datarag-info.log";
	private static final String AGENT_LLM_LOG_NAME = "agent-llm.jsonl";
	private static final String DIAGNOSTIC_EVENTS_LOG_NAME = "diagnostic-events.jsonl";
	private static final int TAIL_POLL_INTERVAL_MS = 500;
	private static final int TAIL_HEARTBEAT_INTERVAL_MS = 15_000;
	private static final long TAIL_STREAM_TIMEOUT_MS = 30 * 60 * 1000L;
	private static final Pattern APP_LINE_TS_PATTERN = Pattern.compile(
			"^(\\d{13})\\s+\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\s");
	private static final Pattern APP_ROLLED_LOG_PATTERN = Pattern.compile("^datarag-INFO-(\\d{4}-\\d{2}-\\d{2})_(\\d+)\\.log(?:\\.gz)?$");
	private static final Pattern AGENT_LLM_ROLLED_LOG_PATTERN = Pattern.compile("^agent-llm-(\\d{4}-\\d{2}-\\d{2})_(\\d+)\\.jsonl(?:\\.gz)?$");
	private static final Pattern DIAGNOSTIC_EVENTS_ROLLED_LOG_PATTERN = Pattern.compile("^diagnostic-events-(\\d{4}-\\d{2}-\\d{2})_(\\d+)\\.jsonl(?:\\.gz)?$");
	private static final MediaType TEXT_PLAIN_UTF8 = new MediaType("text", "plain", StandardCharsets.UTF_8);
	private static final MediaType NDJSON_UTF8 = new MediaType("application", "x-ndjson", StandardCharsets.UTF_8);

	@Autowired
	private SessionRegistryDao sessionRegistryDao;

	@GetMapping(value = "/app", produces = MediaType.TEXT_PLAIN_VALUE)
	public ResponseEntity<StreamingResponseBody> appLogs(@RequestParam(required = false) String minTs,
			@RequestParam(required = false) String maxTs) {
		User user = SystemUtils.getCurUser();
		if (user == null) return ResponseEntity.status(401).build();
		long min = parseLongParam(minTs, Long.MIN_VALUE);
		long max = parseLongParam(maxTs, Long.MAX_VALUE);
		StreamingResponseBody body = out -> {
			Writer writer = newWriter(out);
			try {
				streamAppWindow(min, max, writer);
			} finally {
				writer.flush();
			}
		};
		return ResponseEntity.ok().contentType(TEXT_PLAIN_UTF8).body(body);
	}

	@GetMapping(value = "/agent-llm", produces = "application/x-ndjson")
	public ResponseEntity<StreamingResponseBody> agentLlmLogs(@RequestParam(required = false) String sessionId,
			@RequestParam(required = false) String minTs, @RequestParam(required = false) String maxTs) {
		User user = SystemUtils.getCurUser();
		if (user == null) return ResponseEntity.status(401).build();
		Long min = parseLongOrNull(minTs);
		Long max = parseLongOrNull(maxTs);
		StreamingResponseBody body = out -> {
			Writer writer = newWriter(out);
			try {
				streamNdjsonBySession(this::isAgentLlmLogFile, sessionId, min, max, writer);
			} finally {
				writer.flush();
			}
		};
		return ResponseEntity.ok().contentType(NDJSON_UTF8).body(body);
	}

	@GetMapping(value = "/diagnostic-events", produces = "application/x-ndjson")
	public ResponseEntity<StreamingResponseBody> diagnosticEvents(@RequestParam(required = false) String sessionId,
			@RequestParam(required = false) String minTs, @RequestParam(required = false) String maxTs) {
		User user = SystemUtils.getCurUser();
		if (user == null) return ResponseEntity.status(401).build();
		Long min = parseLongOrNull(minTs);
		Long max = parseLongOrNull(maxTs);
		StreamingResponseBody body = out -> {
			Writer writer = newWriter(out);
			try {
				streamNdjsonBySession(this::isDiagnosticEventsLogFile, sessionId, min, max, writer);
			} finally {
				writer.flush();
			}
		};
		return ResponseEntity.ok().contentType(NDJSON_UTF8).body(body);
	}

	/**
	 * Session routing query: returns all rows of session_registry by sessionId (one row per node per session).
	 * Only login is required, with no domain-based authorization; an empty array is returned when there are no records.
	 */
	@GetMapping(value = "/session-registry")
	public ResponseEntity<R<List<SessionRegistryEntry>>> sessionRegistry(
			@RequestParam(required = false) String sessionId) {
		User user = SystemUtils.getCurUser();
		if (user == null) return ResponseEntity.status(401).build();
		if (sessionId == null || sessionId.isBlank()) return ResponseEntity.ok(R.of(List.of()));
		return ResponseEntity.ok(R.of(sessionRegistryDao.findAllBySessionId(sessionId)));
	}

	@GetMapping(value = "/tail", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
	public ResponseEntity<SseEmitter> tailLogs() {
		User user = SystemUtils.getCurUser();
		if (user == null) return ResponseEntity.status(401).build();
		SseEmitter emitter = new SseEmitter(TAIL_STREAM_TIMEOUT_MS);
		AtomicBoolean tailClosed = new AtomicBoolean(false);
		emitter.onCompletion(() -> tailClosed.set(true));
		emitter.onTimeout(() -> tailClosed.set(true));
		emitter.onError(error -> tailClosed.set(true));
		Thread.ofVirtual().name("observe-log-tail-").start(() -> {
			try {
				streamAppTail(emitter, tailClosed);
				if (!tailClosed.get()) {
					emitter.complete();
				}
			} catch (Exception e) {
				if (!tailClosed.get()) {
					emitter.completeWithError(e);
				}
			} finally {
				tailClosed.set(true);
			}
		});
		return ResponseEntity.ok()
				.contentType(MediaType.TEXT_EVENT_STREAM)
				.header("Cache-Control", "no-cache")
				.body(emitter);
	}

	// ===== /app streaming by time window =====

	private void streamAppWindow(long minTs, long maxTs, Writer out) throws IOException {
		if (maxTs < minTs) {
			return;
		}
		Long min = minTs == Long.MIN_VALUE ? null : minTs;
		Long max = maxTs == Long.MAX_VALUE ? null : maxTs;
		for (Path file : filterFilesByWindow(listLogFiles(this::isAppLogFile), min, max)) {
			streamAppFile(file, minTs, maxTs, out);
		}
	}

	void streamAppFile(Path file, long minTs, long maxTs, Writer out) throws IOException {
		try (BufferedReader reader = openLogReader(file)) {
			StringBuilder record = new StringBuilder();
			Long recordTs = null;
			String line;
			while ((line = reader.readLine()) != null) {
				Long lineTs = parseAppLineTs(line);
				if (lineTs != null) {
					flushAppRecord(recordTs, record, minTs, maxTs, out);
					record.setLength(0);
					recordTs = lineTs;
					if (recordTs > maxTs) {
						return;
					}
				}
				if (recordTs != null && recordTs >= minTs) {
					record.append(line).append('\n');
				}
			}
			flushAppRecord(recordTs, record, minTs, maxTs, out);
		} catch (IOException e) {
			log.warn("Read app log failed. file: {}, message: {}", file, e.getMessage(), e);
		}
	}

	private void flushAppRecord(Long recordTs, StringBuilder record, long minTs, long maxTs, Writer out) throws IOException {
		if (recordTs != null && record.length() > 0 && recordTs >= minTs && recordTs <= maxTs) {
			out.write(record.toString());
		}
	}

	List<Path> filterFilesByWindow(List<Path> files, Long minTs, Long maxTs) {
		if (minTs == null || maxTs == null || files.isEmpty()) {
			return files;
		}

		List<Long> modifiedTimes = new ArrayList<>(files.size());
		for (Path file : files) {
			modifiedTimes.add(lastModifiedTime(file));
		}
		if (!hasReliableFileMetadata(files, modifiedTimes)) {
			return filterFilesByDate(files, modifiedTimes, minTs, maxTs);
		}

		boolean[] selected = new boolean[files.size()];
		for (int i = 0; i < files.size(); i++) {
			long fileStartTs = i == 0 ? Long.MIN_VALUE : modifiedTimes.get(i - 1);
			long fileEndTs = modifiedTimes.get(i);
			if (overlapsWindow(fileStartTs, fileEndTs, minTs, maxTs)) {
				selectWithNeighbors(selected, i);
			}
		}
		return selectedFiles(files, selected);
	}

	private boolean hasReliableFileMetadata(List<Path> files, List<Long> modifiedTimes) {
		long previousModifiedTime = Long.MIN_VALUE;
		for (int i = 0; i < files.size(); i++) {
			long modifiedTime = modifiedTimes.get(i);
			if (modifiedTime <= 0 || modifiedTime <= previousModifiedTime) {
				return false;
			}
			LocalDate rolledDate = rolledLogDate(files.get(i));
			if (rolledDate != null) {
				LocalDate modifiedDate = epochDate(modifiedTime);
				if (modifiedDate.isBefore(rolledDate) || modifiedDate.isAfter(rolledDate.plusDays(1))) {
					return false;
				}
			}
			previousModifiedTime = modifiedTime;
		}
		return true;
	}

	private List<Path> filterFilesByDate(List<Path> files, List<Long> modifiedTimes, long minTs, long maxTs) {
		LocalDate minDate = epochDate(minTs);
		LocalDate maxDate = epochDate(maxTs);
		boolean[] selected = new boolean[files.size()];
		for (int i = 0; i < files.size(); i++) {
			LocalDate candidateDate = rolledLogDate(files.get(i));
			if (candidateDate == null && isActiveLogFile(files.get(i))) {
				long modifiedTime = modifiedTimes.get(i);
				if (modifiedTime <= 0) {
					selectWithNeighbors(selected, i);
					continue;
				}
				candidateDate = epochDate(modifiedTime);
			}
			if (candidateDate != null && !candidateDate.isBefore(minDate) && !candidateDate.isAfter(maxDate)) {
				selectWithNeighbors(selected, i);
			}
		}
		return selectedFiles(files, selected);
	}

	private LocalDate rolledLogDate(Path file) {
		LogFileSortKey key = sortKey(file);
		if (key.group() != 0) {
			return null;
		}
		try {
			return LocalDate.parse(key.date());
		} catch (DateTimeParseException e) {
			return null;
		}
	}

	private boolean isActiveLogFile(Path file) {
		String fileName = file.getFileName().toString();
		return APP_LOG_NAME.equals(fileName)
				|| AGENT_LLM_LOG_NAME.equals(fileName)
				|| DIAGNOSTIC_EVENTS_LOG_NAME.equals(fileName);
	}

	private LocalDate epochDate(long epochMillis) {
		return Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()).toLocalDate();
	}

	private void selectWithNeighbors(boolean[] selected, int index) {
		for (int i = Math.max(0, index - 1); i <= Math.min(selected.length - 1, index + 1); i++) {
			selected[i] = true;
		}
	}

	private List<Path> selectedFiles(List<Path> files, boolean[] selected) {
		List<Path> candidates = new ArrayList<>();
		for (int i = 0; i < files.size(); i++) {
			if (selected[i]) {
				candidates.add(files.get(i));
			}
		}
		return candidates;
	}

	// ===== /agent-llm, /diagnostic-events NDJSON streaming (sessionId prefix match + optional time window) =====

	private void streamNdjsonBySession(FileNameMatcher matcher, String sessionId, Long minTs, Long maxTs,
			Writer out) throws IOException {
		if (sessionId == null || sessionId.isBlank()) {
			return;
		}
		List<Path> files = filterFilesByWindow(listLogFiles(matcher), minTs, maxTs);
		for (Path file : files) {
			try (BufferedReader reader = openLogReader(file)) {
				String line;
				while ((line = reader.readLine()) != null) {
					JSONObject record;
					try { record = JSON.parseObject(line); }
					catch (Exception invalidRecord) { continue; }
					if (record == null || !sessionIdMatches(record.get("sessionId"), sessionId)) {
						continue;
					}
					Long ts = parseNdjsonTs(line);
					if (ts == null
							|| (minTs != null && ts < minTs)
							|| (maxTs != null && ts > maxTs)) {
						continue;
					}
					out.write(line);
					out.write('\n');
				}
			} catch (IOException e) {
				log.warn("Read ndjson log failed. file: {}, message: {}", file, e.getMessage(), e);
			}
		}
	}

	/**
	 * sessionId prefix match: matches base itself or sub-sessions starting with {@code base-} (base-{index} / base-{index}-try-{ii}).
	 * The {@code -} boundary is required so that base does not mistakenly match unrelated sessions (such as base and base2).
	 */
	private boolean sessionIdMatches(Object value, String q) {
		return value instanceof String id && (id.equals(q) || id.startsWith(q + "-"));
	}

	static Long parseNdjsonTs(String line) {
		try {
			return JSON.parseObject(line).getLong("ts");
		} catch (Exception e) {
			return null;
		}
	}

	private boolean overlapsWindow(long startTs, long endTs, long minTs, long maxTs) {
		return startTs <= maxTs && endTs >= minTs;
	}

	// ===== /tail SSE tail increment =====

	private void streamAppTail(SseEmitter emitter, AtomicBoolean tailClosed) throws IOException, InterruptedException {
		Path file = LOG_DIR.resolve(APP_LOG_NAME);
		long position = currentTailPosition(file);
		long lastHeartbeatTs = 0L;
		AppTailLineEventWriter eventWriter = new AppTailLineEventWriter(emitter);
		sendTailHeartbeat(emitter);

		while (!tailClosed.get() && !Thread.currentThread().isInterrupted()) {
			if (!Files.isRegularFile(file)) {
				position = 0L;
				lastHeartbeatTs = sendTailHeartbeatIfDue(emitter, lastHeartbeatTs);
				Thread.sleep(TAIL_POLL_INTERVAL_MS);
				continue;
			}

			long size = Files.size(file);
			if (size < position) {
				position = 0L;
				eventWriter.reset();
			}
			if (size > position) {
				position = streamTailAppend(file, position, size, eventWriter);
			} else {
				lastHeartbeatTs = sendTailHeartbeatIfDue(emitter, lastHeartbeatTs);
				Thread.sleep(TAIL_POLL_INTERVAL_MS);
			}
		}
	}

	private long currentTailPosition(Path file) throws IOException {
		return Files.isRegularFile(file) ? Files.size(file) : 0L;
	}

	private long streamTailAppend(Path file, long position, long size, AppTailLineEventWriter eventWriter) throws IOException {
		try (InputStream input = Files.newInputStream(file)) {
			skipFully(input, position);
			byte[] bytes = input.readNBytes((int) Math.min(size - position, Integer.MAX_VALUE));
			eventWriter.append(new String(bytes, StandardCharsets.UTF_8));
		}
		return size;
	}

	private void skipFully(InputStream input, long bytes) throws IOException {
		long remaining = bytes;
		while (remaining > 0) {
			long skipped = input.skip(remaining);
			if (skipped <= 0) {
				if (input.read() == -1) {
					throw new IOException("Unexpected EOF while skipping log file");
				}
				skipped = 1;
			}
			remaining -= skipped;
		}
	}

	private long sendTailHeartbeatIfDue(SseEmitter emitter, long lastHeartbeatTs) throws IOException {
		long now = System.currentTimeMillis();
		if (now - lastHeartbeatTs >= TAIL_HEARTBEAT_INTERVAL_MS) {
			sendTailHeartbeat(emitter);
			return now;
		}
		return lastHeartbeatTs;
	}

	private void sendTailHeartbeat(SseEmitter emitter) throws IOException {
		emitter.send(SseEmitter.event().name("heartbeat").data("{\"ts\":" + System.currentTimeMillis() + "}"));
	}

	private void sendTailLogEvent(SseEmitter emitter, String record) throws IOException {
		emitter.send(SseEmitter.event().name("log").data(record, TEXT_PLAIN_UTF8));
	}

	private class AppTailLineEventWriter {
		private final SseEmitter emitter;
		private String partialLine = "";

		private AppTailLineEventWriter(SseEmitter emitter) {
			this.emitter = emitter;
		}

		private void append(String text) throws IOException {
			String content = partialLine + text;
			int start = 0;
			int newLineIndex;
			while ((newLineIndex = content.indexOf('\n', start)) >= 0) {
				String line = content.substring(start, newLineIndex);
				if (line.endsWith("\r")) {
					line = line.substring(0, line.length() - 1);
				}
				sendLineIfMatched(line);
				start = newLineIndex + 1;
			}
			partialLine = content.substring(start);
		}

		private void reset() {
			partialLine = "";
		}

		private void sendLineIfMatched(String line) throws IOException {
			if (!line.isEmpty()) {
				sendTailLogEvent(emitter, line);
			}
		}
	}

	// ===== Common utilities =====

	private static Long parseAppLineTs(String line) {
		if (line == null) {
			return null;
		}
		Matcher matcher = APP_LINE_TS_PATTERN.matcher(line);
		return matcher.find() ? Long.parseLong(matcher.group(1)) : null;
	}

	private List<Path> listLogFiles(FileNameMatcher matcher) {
		if (!Files.isDirectory(LOG_DIR)) {
			return new ArrayList<>();
		}
		try (Stream<Path> stream = Files.list(LOG_DIR)) {
			return stream
					.filter(Files::isRegularFile)
					.filter(path -> matcher.matches(path.getFileName().toString()))
					.sorted(this::compareLogFiles)
					.collect(Collectors.toList());
		} catch (IOException e) {
			log.warn("List log files failed. dir: {}, message: {}", LOG_DIR, e.getMessage(), e);
			return new ArrayList<>();
		}
	}

	private boolean isAppLogFile(String fileName) {
		return APP_LOG_NAME.equals(fileName)
				|| APP_ROLLED_LOG_PATTERN.matcher(fileName).matches();
	}

	private boolean isAgentLlmLogFile(String fileName) {
		return AGENT_LLM_LOG_NAME.equals(fileName)
				|| AGENT_LLM_ROLLED_LOG_PATTERN.matcher(fileName).matches();
	}

	private boolean isDiagnosticEventsLogFile(String fileName) {
		return DIAGNOSTIC_EVENTS_LOG_NAME.equals(fileName)
				|| DIAGNOSTIC_EVENTS_ROLLED_LOG_PATTERN.matcher(fileName).matches();
	}

	private BufferedReader openLogReader(Path file) throws IOException {
		InputStream raw = Files.newInputStream(file);
		try {
			InputStream input = isGzipFile(file) ? new GZIPInputStream(raw) : raw;
			return new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
		} catch (IOException e) {
			raw.close();
			throw e;
		}
	}

	private boolean isGzipFile(Path file) {
		return file.getFileName().toString().endsWith(".gz");
	}

	private int compareLogFiles(Path left, Path right) {
		return sortKey(left).compareTo(sortKey(right));
	}

	private LogFileSortKey sortKey(Path path) {
		String fileName = path.getFileName().toString();
		if (APP_LOG_NAME.equals(fileName) || AGENT_LLM_LOG_NAME.equals(fileName)
				|| DIAGNOSTIC_EVENTS_LOG_NAME.equals(fileName)) {
			return LogFileSortKey.active();
		}

		LogFileSortKey parsed = parseRolledLogSortKey(fileName, APP_ROLLED_LOG_PATTERN);
		if (parsed != null) {
			return parsed;
		}
		parsed = parseRolledLogSortKey(fileName, AGENT_LLM_ROLLED_LOG_PATTERN);
		if (parsed != null) {
			return parsed;
		}
		parsed = parseRolledLogSortKey(fileName, DIAGNOSTIC_EVENTS_ROLLED_LOG_PATTERN);
		if (parsed != null) {
			return parsed;
		}
		return LogFileSortKey.fallback(lastModifiedTime(path));
	}

	private LogFileSortKey parseRolledLogSortKey(String fileName, Pattern pattern) {
		Matcher matcher = pattern.matcher(fileName);
		if (!matcher.matches()) {
			return null;
		}
		try {
			return LogFileSortKey.rolled(matcher.group(1), Integer.parseInt(matcher.group(2)));
		} catch (NumberFormatException e) {
			return null;
		}
	}

	private long lastModifiedTime(Path path) {
		try {
			return Files.getLastModifiedTime(path).toMillis();
		} catch (IOException e) {
			return 0L;
		}
	}

	private long parseLongParam(String value, long defaultValue) {
		if (value == null || value.isBlank()) {
			return defaultValue;
		}
		try {
			return Long.parseLong(value.trim());
		} catch (NumberFormatException e) {
			return defaultValue;
		}
	}

	private Long parseLongOrNull(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			return Long.parseLong(value.trim());
		} catch (NumberFormatException e) {
			return null;
		}
	}

	private Writer newWriter(java.io.OutputStream out) {
		return new BufferedWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8));
	}

	private interface FileNameMatcher {
		boolean matches(String fileName);
	}

	private record LogFileSortKey(int group, String date, int index, long lastModifiedTime)
			implements Comparable<LogFileSortKey> {

		private static LogFileSortKey rolled(String date, int index) {
			return new LogFileSortKey(0, date, index, 0L);
		}

		private static LogFileSortKey fallback(long lastModifiedTime) {
			return new LogFileSortKey(1, "", 0, lastModifiedTime);
		}

		private static LogFileSortKey active() {
			return new LogFileSortKey(2, "", 0, 0L);
		}

		@Override
		public int compareTo(LogFileSortKey other) {
			int groupCompare = Integer.compare(group, other.group);
			if (groupCompare != 0) {
				return groupCompare;
			}
			if (group == 0) {
				int dateCompare = date.compareTo(other.date);
				if (dateCompare != 0) {
					return dateCompare;
				}
				return Integer.compare(index, other.index);
			}
			if (group == 1) {
				return Long.compare(other.lastModifiedTime, lastModifiedTime);
			}
			return 0;
		}
	}
}
