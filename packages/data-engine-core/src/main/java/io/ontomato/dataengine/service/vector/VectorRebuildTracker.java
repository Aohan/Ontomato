package io.ontomato.dataengine.service.vector;

import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * In-memory vector rebuild progress per domain. A single instance holds it, so a restart clears
 * every running state while the recorded vector source still reports a rebuild as needed.
 */
@Component
public class VectorRebuildTracker {

    public static class Progress {

        private volatile boolean running;
        private volatile int total;
        private volatile int done;
        private volatile String error;

        public boolean isRunning() {
            return running;
        }

        public int getTotal() {
            return total;
        }

        public int getDone() {
            return done;
        }

        public String getError() {
            return error;
        }

    }

    private final ConcurrentHashMap<String, Progress> states = new ConcurrentHashMap<>();

    public Progress progressOf(String domainId) {
        return states.computeIfAbsent(domainId, key -> new Progress());
    }

    public boolean isRunning(String domainId) {
        Progress progress = states.get(domainId);
        return progress != null && progress.isRunning();
    }

    /** Claim the single rebuild slot of this domain; false when one already runs. */
    public boolean tryStart(String domainId) {
        Progress progress = progressOf(domainId);
        synchronized (progress) {
            if (progress.running) {
                return false;
            }
            progress.running = true;
            progress.total = 0;
            progress.done = 0;
            progress.error = null;
            return true;
        }
    }

    public void addTotal(String domainId, int count) {
        Progress progress = progressOf(domainId);
        synchronized (progress) {
            progress.total += count;
        }
    }

    public void addDone(String domainId, int count) {
        Progress progress = progressOf(domainId);
        synchronized (progress) {
            progress.done += count;
        }
    }

    /** Stop the rebuild of this domain: null error means every row was re-vectorized. */
    public void finish(String domainId, String error) {
        Progress progress = progressOf(domainId);
        synchronized (progress) {
            progress.running = false;
            progress.error = error;
        }
    }

}
