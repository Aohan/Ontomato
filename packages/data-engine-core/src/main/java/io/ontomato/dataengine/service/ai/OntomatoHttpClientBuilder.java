package io.ontomato.dataengine.service.ai;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;

import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.SessionCancelledException;

import dev.langchain4j.exception.HttpException;
import dev.langchain4j.http.client.HttpClient;
import dev.langchain4j.http.client.HttpClientBuilder;
import dev.langchain4j.http.client.HttpRequest;
import dev.langchain4j.http.client.SuccessfulHttpResponse;
import dev.langchain4j.http.client.spring.restclient.SpringRestClient;
import dev.langchain4j.http.client.sse.ServerSentEventListener;
import dev.langchain4j.http.client.sse.ServerSentEventParser;

public class OntomatoHttpClientBuilder implements HttpClientBuilder {
	
	private final HttpClientBuilder delegateBuilder = SpringRestClient.builder();
	private final Map<String, Object> customOverrides;
	private Duration connectTimeout;
	private Duration readTimeout;

	public OntomatoHttpClientBuilder(Map<String, Object> customOverrides) {
		if (customOverrides.isEmpty()) {
			this.customOverrides = null;
		} else {
			this.customOverrides = new LinkedHashMap<>(customOverrides);
		}
	}

	@Override
	public Duration connectTimeout() {
		return this.connectTimeout;
	}

	@Override
	public HttpClientBuilder connectTimeout(Duration timeout) {
		this.connectTimeout = timeout;
        return this;
	}

	@Override
	public Duration readTimeout() {
		return this.readTimeout;
	}

	@Override
	public HttpClientBuilder readTimeout(Duration timeout) {
		this.readTimeout = timeout;
        return this;
	}

	@Override
	public HttpClient build() {
		delegateBuilder.connectTimeout(connectTimeout != null ? connectTimeout : Duration.ofSeconds(30));
		if (readTimeout != null) {
			delegateBuilder.readTimeout(readTimeout);
		}
		return new OntomatoHttpClient(delegateBuilder.build(), customOverrides);
	}
	
	private static class OntomatoHttpClient implements HttpClient {
		private static final int MAX_CONCURRENCY = 100;
		private static final long MIN_GAP_MS = 1000;
		
		private static final LinkedBlockingQueue<Task> queue = new LinkedBlockingQueue<>();
	    private static final Semaphore semaphore = new Semaphore(MAX_CONCURRENCY);
	    private static long lastStartTime = 0;
	    
	    // The thread pool that really executes HTTP (it only sends requests and does not limit the concurrency -- actually controlled by semaphore)
	    private static final ExecutorService httpPool = Executors.newCachedThreadPool();
	    
	    private static class Task {
	        final HttpRequest request;
	        final OntomatoHttpClient self;
	        final String sessionId;
	        final CompletableFuture<SuccessfulHttpResponse> future = new CompletableFuture<>();

	        Task(HttpRequest request, OntomatoHttpClient self, String sessionId) {
	            this.request = request;
	            this.self = self;
	            this.sessionId = sessionId;
	        }
	    }
	    
	    static {
	        Thread worker = new Thread(OntomatoHttpClient::run, "ontomato-http-worker");
	        worker.setDaemon(true);
	        worker.start();
	    }
	    
	    private final HttpClient delegateClient;
	    private final Map<String, Object> customOverrides;

	    OntomatoHttpClient(HttpClient delegateClient, Map<String, Object> customOverrides) {
	        this.delegateClient = delegateClient;
	        this.customOverrides = customOverrides;
	    }
	    
	    private static void run() {
	        while (true) {
	            try {
	                Task task = queue.take();

	                // 0. Queued requests of a cancelled session are discarded directly: they do not take a concurrency slot or a request interval.
	                if (task.sessionId != null && BackendSessionEntrance.isCancelled(task.sessionId)) {
	                    task.future.completeExceptionally(new SessionCancelledException(task.sessionId));
	                    continue;
	                }

	                // 1. Concurrency control: wait if there is no idle slot
	                semaphore.acquire();

	                // 2. Interval control: at least MIN_GAP_MS since the last request start
	                long now = System.currentTimeMillis();
	                long gap = lastStartTime + MIN_GAP_MS - now;
	                if (gap > 0) {
	                    Thread.sleep(gap);
	                    now = System.currentTimeMillis();
	                }
	                lastStartTime = now;

	                // 3. Send HTTP asynchronously, release the slot after completion
	                final OntomatoHttpClient self = task.self;
	                CompletableFuture.supplyAsync(() -> {
	                    try {
	                        return self.doExecute(task.request);
	                    } catch (HttpException e) {
	                        throw new RuntimeException(e);
	                    }
	                }, httpPool).whenComplete((response, error) -> {
	                    try {
	                        if (error != null) {
	                            task.future.completeExceptionally(error);
	                        } else {
	                            task.future.complete(response);
	                        }
	                    } finally {
	                        semaphore.release(); // release the concurrency slot
	                    }
	                });

	            } catch (InterruptedException e) {
	                Thread.currentThread().interrupt();
	                break;
	            } catch (Exception e) {
	                e.printStackTrace();
	            }
	        }
	    }

		/**
		 * The slice duration for which the caller thread waits on the future: the upper bound of the cancellation-awareness delay, with negligible overhead.
		 */
		private static final long WAIT_SLICE_MS = 200L;

		@Override
		public SuccessfulHttpResponse execute(HttpRequest request) throws HttpException, RuntimeException {
			String sessionId = currentSessionId();
			if (sessionId != null && BackendSessionEntrance.isCancelled(sessionId)) {
				throw new SessionCancelledException(sessionId);
			}
			Task task = new Task(request, this, sessionId);
	        queue.offer(task);
	        try {
	            while (true) {
	                try {
	                    return task.future.get(WAIT_SLICE_MS, TimeUnit.MILLISECONDS);
	                } catch (TimeoutException e) {
	                    if (sessionId != null && BackendSessionEntrance.isCancelled(sessionId)) {
	                        throw new SessionCancelledException(sessionId);
	                    }
	                }
	            }
	        } catch (SessionCancelledException e) {
	            throw e;
	        } catch (ExecutionException e) {
	            // Cancellation passes through the 502 wrapper: after the retry logic recognizes the cancellation, it does not start another round.
	            SessionCancelledException.throwIfCancelled(e);
	            throw new HttpException(502, e.getMessage());
	        } catch (InterruptedException e) {
	            // Restore the interrupt flag; if the session is cancelled, throw cancellation, otherwise keep the original 502 semantics and attach the cause.
	            Thread.currentThread().interrupt();
	            if (sessionId != null && BackendSessionEntrance.isCancelled(sessionId)) {
	                throw new SessionCancelledException(sessionId);
	            }
	            HttpException failure = new HttpException(502, e.getMessage());
	            failure.initCause(e);
	            throw failure;
	        } catch (Exception e) {
	            throw new HttpException(502, e.getMessage());
	        }
		}

		private static String currentSessionId() {
			AgentCallContext context = AgentCallContext.current();
			return context == null ? null : context.getSessionId();
		}
		
		private SuccessfulHttpResponse doExecute(HttpRequest request) throws HttpException {
			return delegateClient.execute(applyCustomOverrides(withAssistantContent(request)));
		}

		private HttpRequest applyCustomOverrides(HttpRequest request) {
			if (customOverrides == null) {
				return request;
			}
			JSONObject body = JSON.parseObject(request.body(), JSONReader.Feature.DisableReferenceDetect);
			for (Map.Entry<String, Object> entry : customOverrides.entrySet()) {
				body.put(entry.getKey(), entry.getValue());
			}
			return HttpRequest.builder()
					.method(request.method())
					.url(request.url())
					.headers(request.headers())
					.formDataFields(request.formDataFields())
					.formDataFiles(request.formDataFiles())
					.body(JSON.toJSONString(body, JSONWriter.Feature.WriteNulls))
					.build();
		}

		private static HttpRequest withAssistantContent(HttpRequest request) {
			String requestBody = request.body();
			if (requestBody == null) {
				return request;
			}
			JSONObject body = JSON.parseObject(requestBody, JSONReader.Feature.DisableReferenceDetect);
			JSONArray messages = body.getJSONArray("messages");
			boolean changed = false;
			for (Object item : messages) {
				JSONObject message = (JSONObject) item;
				if ("assistant".equals(message.getString("role"))
						&& !message.containsKey("content")) {
					message.put("content", "");
					changed = true;
				}
			}
			if (!changed) {
				return request;
			}
			return HttpRequest.builder()
					.method(request.method())
					.url(request.url())
					.headers(request.headers())
					.formDataFields(request.formDataFields())
					.formDataFiles(request.formDataFiles())
					.body(JSON.toJSONString(body, JSONWriter.Feature.WriteNulls))
					.build();
		}

		@Override
		public void execute(HttpRequest request, ServerSentEventParser parser, ServerSentEventListener listener) {
			throw new UnsupportedOperationException("SSE is not supported yet");
		}
	}

}
