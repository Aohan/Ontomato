package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.SessionRegistryDao;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.SessionRegistryService;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.net.InetAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Service
public class SessionRegistryServiceImpl implements SessionRegistryService {

	/**
	 * Upper bound of the short cache for cancellation checks (confirmed design 9 "a short cache of a few seconds": no more than about 5 seconds).
	 * Cancellation is monotonic, and the cache only delays discovery by at most this long.
	 */
	private static final long CANCEL_CACHE_TTL_MS = 5000L;

	@Autowired
	private DataRagConfig dataRagConfig;

	@Autowired
	private SessionRegistryDao sessionRegistryDao;

	@Value("${server.port:8080}")
	private String serverPort;

	private final Map<String, CancelCacheEntry> cancelCache = new ConcurrentHashMap<>();
	private volatile String resolvedNodeId;

	@PostConstruct
	public void init() {
		resolvedNodeId = resolveNodeId();
	}

	@Override
	public String getNodeId() {
		if (!StringUtils.hasText(resolvedNodeId)) {
			resolvedNodeId = resolveNodeId();
		}
		return resolvedNodeId;
	}

	@Override
	public void registerStart(String sessionId) {
		if (!StringUtils.hasText(sessionId)) {
			return;
		}
		try {
			sessionRegistryDao.save(sessionId, getNodeId(), System.currentTimeMillis(), null);
		} catch (Exception e) {
			log.warn("Register session start failed. sessionId: {}, message: {}", sessionId, e.getMessage(), e);
		}
	}

	@Override
	public boolean isSessionCancelled(String sessionId) {
		String mainSessionId = BackendSessionEntrance.mainSessionId(sessionId);
		if (mainSessionId == null || mainSessionId.isEmpty()) {
			return false;
		}
		long now = System.currentTimeMillis();
		CancelCacheEntry cached = cancelCache.get(mainSessionId);
		if (cached != null && now - cached.checkedAt < CANCEL_CACHE_TTL_MS) {
			return cached.cancelled;
		}
		boolean cancelled = sessionRegistryDao.hasCancelMark(mainSessionId);
		cancelCache.put(mainSessionId, new CancelCacheEntry(cancelled, now));
		return cancelled;
	}

	@Override
	public void markSessionCancelled(String sessionId, long cancelledAt) {
		sessionRegistryDao.markCancelled(sessionId, getNodeId(), cancelledAt);
	}

	private record CancelCacheEntry(boolean cancelled, long checkedAt) {
	}

	@Override
	public void registerEnd(String sessionId) {
		if (!StringUtils.hasText(sessionId)) {
			return;
		}
		try {
			// The start time is based on this node's first registration (on conflict the SQL keeps the existing start_ts); passing the end time here as a fallback is enough.
			long endTs = System.currentTimeMillis();
			sessionRegistryDao.save(sessionId, getNodeId(), endTs, endTs);
		} catch (Exception e) {
			log.warn("Register session end failed. sessionId: {}, message: {}", sessionId, e.getMessage(), e);
		}
	}

	private String resolveNodeId() {
		if (StringUtils.hasText(dataRagConfig.getNodeId())) {
			return dataRagConfig.getNodeId().trim();
		}
		String hostName = "unknown-host";
		try {
			hostName = InetAddress.getLocalHost().getHostName();
		} catch (Exception e) {
			log.warn("Resolve host name failed: {}", e.getMessage(), e);
		}
		String port = StringUtils.hasText(serverPort) ? serverPort.trim() : "8080";
		return hostName + ":" + port;
	}
}
