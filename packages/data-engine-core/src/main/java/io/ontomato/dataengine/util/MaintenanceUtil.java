package io.ontomato.dataengine.util;

import java.io.*;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.alibaba.fastjson2.*;
import org.yaml.snakeyaml.Yaml;
import lombok.extern.slf4j.Slf4j;

/**
 * System monitoring class, used to collect the running status information of the host, M3 ONNStore, backend and frontend Docker containers.
 * Aggregates all information into JSON format, supporting console output and file saving.
 */
@Slf4j
public class MaintenanceUtil {


        /** Supported action types: stop, start, restart */
        private static final String[] ACTIONS_FULL = {"stop", "start", "restart"};
        /** Restart is the only supported action */
        private static final String[] ACTIONS_RESTART = {"restart"};

        /** Used to parse the CPU usage (us/sy/id/wa) from the top command output */
        private static final Pattern CPU_PATTERN = Pattern.compile(
                "(\\d+\\.?\\d*)\\s*us.*?(\\d+\\.?\\d*)\\s*sy.*?(\\d+\\.?\\d*)\\s*id.*?(\\d+\\.?\\d*)\\s*wa");
        /** Used to parse the memory information (total/free/used) from the top command output */
        private static final Pattern MEM_PATTERN = Pattern.compile(
                ":?\\s*(\\d+\\.?\\d*)\\s*\\S*\\s*total[,\\s]*" +
                        "(\\d+\\.?\\d*)\\s*\\S*\\s*free[,\\s]*" +
                        "(\\d+\\.?\\d*)\\s*\\S*\\s*used");
        /** Used to match the JVM initial heap memory parameter -Xms */
        private static final Pattern JVM_XMS_PATTERN = Pattern.compile("-Xms(\\d+)([gGmMkK]?)");
        /** Used to match the JVM maximum heap memory parameter -Xmx */
        private static final Pattern JVM_XMX_PATTERN = Pattern.compile("-Xmx(\\d+)([gGmMkK]?)");
        /** Used to parse the process running time format (dd-HH:MM:SS) */
        private static final Pattern ETIME_PATTERN = Pattern.compile(
                "(?:(\\d+)-)?(?:(\\d{2}):)?(\\d{2}):(\\d{2})");

        /**
         * Collects all monitoring information
         * @param onnStoreRoot ONNStore root directory path
         * @return JSON object containing all monitoring data
         */
        public JSONObject collectAll(String onnStoreRoot) {
            JSONObject result = new JSONObject();
            result.put("timestamp",
                    ZonedDateTime.now(ZoneOffset.ofHours(8))
                            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")));
            result.put("hostname", getHostname());
            result.put("server", getHostInfo());
            result.put("m3", getM3Info(onnStoreRoot));
            result.put("backend", getBackendInfo());
            result.put("frontend", getFrontendInfo());
            return result;
        }

        /**
         * Saves the JSON data to the specified file
         * @param json JSON object to save
         * @param filePath target file path
         * @throws IOException thrown when writing the file fails
         */
        public void saveToFile(JSONObject json, String filePath) throws IOException {
            String content = json.toString();
            Files.write(Paths.get(filePath), content.getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        }

        // ======================== 1. Host information ========================

        /**
         * Gets host information, including CPU, memory and disk
         * @return JSON object containing the host information
         */
        public JSONObject getHostInfo() {
            JSONObject server = new JSONObject();
            server.put("cpu", getCpuInfo());
            server.put("memory", getMemoryInfo());
            server.put("disk", getDiskInfo());
            return server;
        }

        /**
         * Gets CPU usage information (via the top command)
         * @return JSON object containing user/system/idle/wait and the usage rate
         */
        private JSONObject getCpuInfo() {
            JSONObject cpu = new JSONObject();
            cpu.put("system", 0);
            cpu.put("user", 0);
            cpu.put("idle", 100.0);
            cpu.put("wait", 0);
            cpu.put("userate", 0);
            try {
                String output = runCommand("bash", "-c",
                        "LC_ALL=C top -bn2 -d 1 2>/dev/null | grep '%Cpu' | tail -1");
                if (output != null && !output.isEmpty()) {
                    Matcher m = CPU_PATTERN.matcher(output);
                    if (m.find()) {
                        double us = Double.parseDouble(m.group(1));
                        double sy = Double.parseDouble(m.group(2));
                        double id = Double.parseDouble(m.group(3));
                        double wa = Double.parseDouble(m.group(4));
                        cpu.put("user", us);
                        cpu.put("system", sy);
                        cpu.put("idle", id);
                        cpu.put("wait", wa);
                        cpu.put("userate", Math.round((100.0 - id) * 10.0) / 10.0);
                    }
                }
            } catch (Exception e) {
                // keep defaults
            }
            return cpu;
        }

        /**
         * Gets memory usage information (via the top command)
         * @return JSON object containing total_gb/used_gb/free_gb/usage_percent
         */
        private JSONObject getMemoryInfo() {
            JSONObject memory = new JSONObject();
            memory.put("total_gb", 0);
            memory.put("used_gb", 0);
            memory.put("free_gb", 0);
            memory.put("usage_percent", 0);
            try {
                String output = runCommand("bash", "-c",
                        "LC_ALL=C free -g 2>/dev/null | grep '^Mem:' | head -1");
                if (output != null && !output.isEmpty()) {
                    String[] parts = output.trim().split("\\s+");
                    if (parts.length >= 4) {
                        double total = Double.parseDouble(parts[1]);
                        double used = Double.parseDouble(parts[2]);
                        double free = Double.parseDouble(parts[3]);
                        double totalRounded = Math.round(total * 100.0) / 100.0;
                        double usedRounded = Math.round(used * 100.0) / 100.0;
                        double freeRounded = Math.round(free * 100.0) / 100.0;
                        double usagePercent = total > 0
                                ? Math.round(used / total * 1000.0) / 10.0
                                : 0;
                        memory.put("total_gb", totalRounded);
                        memory.put("used_gb", usedRounded);
                        memory.put("free_gb", freeRounded);
                        memory.put("usage_percent", usagePercent);
                    }
                }
            } catch (Exception e) {
                // keep defaults
            }
            return memory;
        }

        /**
         * Gets disk partition information (via the df command)
         * @return JSON array containing the information of each partition
         */
        private JSONArray getDiskInfo() {
            JSONArray disks = new JSONArray();
            try {
                String output = runCommand("bash", "-c",
                        "LC_ALL=C df -k 2>/dev/null | awk 'NR>1 && !/tmpfs|devtmpfs|overlay|none/'");
                if (output != null && !output.isEmpty()) {
                    String[] lines = output.split("\n");
                    for (String line : lines) {
                        String[] parts = line.trim().split("\\s+");
                        if (parts.length >= 6 && parts[0].startsWith("/")) {
                            try {
                                long sizeKb = Long.parseLong(parts[1]);
                                long usedKb = Long.parseLong(parts[2]);
                                long availKb = Long.parseLong(parts[3]);
                                double sizeGb = Math.round(sizeKb / 1024.0 / 1024.0 * 100.0) / 100.0;
                                double usedGb = Math.round(usedKb / 1024.0 / 1024.0 * 100.0) / 100.0;
                                double availGb = Math.round(availKb / 1024.0 / 1024.0 * 100.0) / 100.0;
                                String usePercent = parts[4].replace("%", "");
                                double usagePercent = Double.parseDouble(usePercent);
                                JSONObject disk = new JSONObject();
                                disk.put("partition", parts[0]);
                                disk.put("size", sizeGb);
                                disk.put("used", usedGb);
                                disk.put("available", availGb);
                                disk.put("usage_percent", usagePercent);
                                disks.add(disk);
                            } catch (NumberFormatException ignored) {
                            }
                        }
                    }
                }
            } catch (Exception e) {
                // return empty array
            }
            return disks;
        }

        // ======================== 2. M3 ONNStore configuration and service status ========================

        /**
         * Gets the configuration information and service status of M3 ONNStore
         * @param onnStoreRoot ONNStore root directory path
         * @return JSON object containing ONNStoreConfig and services
         */
        public JSONObject getM3Info(String onnStoreRoot) {
            JSONObject m3 = new JSONObject();
            if (onnStoreRoot == null || onnStoreRoot.isEmpty()) {
                m3.put("ONNStoreConfig", new JSONObject());
                m3.put("services", new JSONArray());
                return m3;
            }
            Path root = Paths.get(onnStoreRoot);
            m3.put("ONNStoreConfig", getOnnStoreConfig(root));
            m3.put("services", getM3Services(root));
            return m3;
        }

        /**
         * Parses the ONNStore configuration files (cassandra.yaml and jvm-server.options)
         * @param root ONNStore root directory
         * @return JSON object containing the configuration parameters
         */
        private JSONObject getOnnStoreConfig(Path root) {
            JSONObject config = new JSONObject();
            config.put("concurrent_writes", 0);
            config.put("file_cache_size_in_mb", 0);
            config.put("jvm_ms", 0);
            config.put("jvm_mx", 0);

            // Parse cassandra.yaml
            Path yamlPath = root.resolve("cassandra/conf/cassandra.yaml");
            if (Files.exists(yamlPath)) {
                try {
                    Yaml yaml = new Yaml();
                    Map<String, Object> yamlMap = yaml.load(Files.newInputStream(yamlPath));
                    Object cw = findYamlKey(yamlMap, "concurrent_writes");
                    Object fcs = findYamlKey(yamlMap, "file_cache_size_in_mb");
                    if (cw instanceof Number) {
                        config.put("concurrent_writes", ((Number) cw).intValue());
                    }
                    if (fcs instanceof Number) {
                        config.put("file_cache_size_in_mb", ((Number) fcs).intValue());
                    }
                } catch (Exception e) {
                    // keep defaults
                }
            }

            // Parse jvm-server.options
            Path jvmPath = root.resolve("cassandra/conf/jvm-server.options");
            if (Files.exists(jvmPath)) {
                try {
                    String jvmContent = new String(Files.readAllBytes(jvmPath), StandardCharsets.UTF_8);
                    Matcher msMatcher = JVM_XMS_PATTERN.matcher(jvmContent);
                    Matcher mxMatcher = JVM_XMX_PATTERN.matcher(jvmContent);
                    if (msMatcher.find()) {
                        config.put("jvm_ms", parseJvmSizeToGb(msMatcher.group(1), msMatcher.group(2)));
                    }
                    if (mxMatcher.find()) {
                        config.put("jvm_mx", parseJvmSizeToGb(mxMatcher.group(1), mxMatcher.group(2)));
                    }
                } catch (Exception e) {
                    // keep defaults
                }
            }
            return config;
        }

        /**
         * Gets the running status of each M3 sub-service via the matrix.sh script
         * @param root ONNStore root directory
         * @return JSON array containing the status of each service
         */
        private JSONArray getM3Services(Path root) {
            JSONArray services = new JSONArray();
            List<String> listM3Service = List.of("cassandra","etcd","nats","odbserver","parser","sched","web");
            Path matrixScript = root.resolve("sbin/matrix.sh");
            if (!Files.exists(matrixScript)) {
                return services;
            }
            try {
                ProcessBuilder pb = new ProcessBuilder(matrixScript.toString(), "status");
                pb.directory(root.toFile());
                pb.redirectErrorStream(true);
                Process p = pb.start();
                String output = readProcessOutput(p);
                p.waitFor(5, java.util.concurrent.TimeUnit.SECONDS);

                if (output != null && !output.isEmpty()) {
                    String[] lines = output.split("\n");
                    for (String line : lines) {
                        line = line.trim();
                        if (line.isEmpty()) {
                            continue;
                        }
                        String[] parts = line.split("\\s+");
                        if (parts.length < 2) {
                            continue;
                        }
                        String name = parts[0];
                        if(!listM3Service.contains(name.toLowerCase())){
                            continue;
                        } else if (name.toLowerCase().equals("cassandra")){
                            name = "onnstore";
                        } else if (name.toLowerCase().equals("odbserver")){
                            name = "onnserver";
                        }
                        String status = parts[1];
                        String pid = parts.length >= 3 && !"stopped".equals(status)
                                && !"empty".equals(status) ? parts[2] : null;
                        String user = parts.length >= 4 ? parts[3] : null;

                        JSONObject svc = new JSONObject();
                        svc.put("name", name);
                        svc.put("status", status);
                        svc.put("pid", pid != null ? pid : "");
                        svc.put("user", user != null ? user : "");
                        svc.put("cpu_percent", 0);
                        svc.put("memory_mb", 0);
                        svc.put("uptime_seconds", 0);
                        svc.put("actions", ACTIONS_FULL);

                        if (pid != null && !pid.isEmpty() && !"empty".equals(status)) {
                            try {
                                JSONObject detail = getServiceDetail(pid);
                                svc.put("cpu_percent", detail.getDouble("cpu_percent"));
                                svc.put("memory_mb", detail.getDouble("memory_mb"));
                                svc.put("uptime_seconds", detail.getLong("uptime_seconds"));
                                if (detail.containsKey("user") && !detail.getString("user").isEmpty()) {
                                    svc.put("user", detail.getString("user"));
                                }
                            } catch (Exception e) {
                                // keep defaults for this service
                            }
                        }
                        services.add(svc);
                    }
                }
            } catch (Exception e) {
                // return empty services
            }
            return services;
        }

        /**
         * Operates M3 services (start/stop/restart) as the matrix user
         * @param onnStoreRoot ONNStore root directory path
         * @param serviceName service name, such as web, parser, sched, etc.
         * @param action action type, such as start, stop, restart
         * @return JSON object containing the execution result
         */
        public JSONObject operateM3Services(String onnStoreRoot,String serviceName,String action){
            JSONObject result = new JSONObject();
            result.put("success", false);
            result.put("service", serviceName);
            result.put("action", action);
            if (onnStoreRoot == null || onnStoreRoot.isEmpty()) {
                result.put("message", "ONNStore root path is required");
                return result;
            }
            if (serviceName == null || serviceName.isEmpty()) {
                result.put("message", "Service name is required");
                return result;
            }
            if (action == null || action.isEmpty()) {
                result.put("message", "Action is required");
                return result;
            }

            try {
                Path root = Paths.get(onnStoreRoot);
                Path matrixScript = root.resolve("sbin/matrix.sh");
                if (!Files.exists(matrixScript)) {
                    result.put("message", "matrix.sh not found at: " + matrixScript);
                    return result;
                }

                String name = null;
                if (serviceName.toLowerCase().equals("onnstore")){
                    name = "cassandra";
                } else if (serviceName.toLowerCase().equals("onnserver")){
                    name = "odbserver";
                } else {
                    name = serviceName.toLowerCase();
                }

                String cmd = "cd " + root.toAbsolutePath().toString()
                        + " && sbin/matrix.sh " + action + " " + serviceName;
                ProcessBuilder pb = new ProcessBuilder(
                        "sudo", "-E", "-u", "matrix", "bash", "-l", "-c", cmd);
                pb.redirectErrorStream(true);
                Process p = pb.start();
                String output = readProcessOutput(p);
                boolean finished = p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);
                if (!finished) {
                    p.destroyForcibly();
                    result.put("message", "Command timed out");
                    return result;
                }
                int exitCode = p.exitValue();
                result.put("success", exitCode == 0);
                result.put("exitCode", exitCode);
                result.put("output", output != null ? output.trim() : "");
                result.put("message", exitCode == 0 ? "Operation completed successfully" : "Operation failed");
            }
            catch (Exception e) {
                result.put("success", false);
                result.put("message", e.getMessage());
            }

            return result;
        }

        // ======================== 3. Backend service status ========================

        /**
         * Gets the running status of the current backend service (dataagent-backend)
         * @return JSON object containing the backend service information
         */
        public JSONObject getBackendInfo() {
            JSONObject backend = new JSONObject();
            JSONObject service = getDefaultServiceJson("dataagent-backend", ACTIONS_RESTART);
            try {
                long pid = ProcessHandle.current().pid();
                service.put("pid", String.valueOf(pid));
                JSONObject detail = getServiceDetail(String.valueOf(pid));
                service.put("status", "running");
                service.put("cpu_percent", detail.getDouble("cpu_percent"));
                service.put("memory_mb", detail.getDouble("memory_mb"));
                service.put("uptime_seconds", detail.getLong("uptime_seconds"));
                if (detail.containsKey("user") && !detail.getString("user").isEmpty()) {
                    service.put("user", detail.getString("user"));
                }
            } catch (Exception e) {
                // keep defaults
            }
            backend.put("service", service);
            return backend;
        }


    /**
     * Restarts the backend service by executing the bin/restart.sh script in the working directory
     * @return JSON object containing the execution result
     */
    public JSONObject restartBackend() {
        JSONObject result = new JSONObject();
        result.put("success", false);
        try {
            Path workDir = Paths.get("").toAbsolutePath();
            Path restartScript = workDir.resolve("bin/restart.sh");
            if (!Files.exists(restartScript)) {
                result.put("message", "restart script not found at: " + restartScript);
                return result;
            }
            log.warn("restart:{}",restartScript.toString());

            ProcessBuilder pb = new ProcessBuilder("bash", restartScript.toString());
            pb.directory(workDir.toFile());
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String output = readProcessOutput(p);
            boolean finished = p.waitFor(10, java.util.concurrent.TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                result.put("message", "Restart command timed out");
                return result;
            }
            int exitCode = p.exitValue();
            result.put("success", exitCode == 0);
            result.put("exitCode", exitCode);
            result.put("output", output != null ? output.trim() : "");
            result.put("message", exitCode == 0 ? "Backend restarted successfully" : "Restart failed");
        } catch (Exception e) {
            result.put("success", false);
            result.put("message", e.getMessage());
        }
        return result;
    }

        // ======================== 4. Frontend container running status ========================

        /**
         * Gets the running status of the frontend Docker container
         * @return JSON object containing the Docker container information
         */
        public JSONObject getFrontendInfo() {
            JSONObject frontend = new JSONObject();
            JSONObject docker = new JSONObject();
            docker.put("actions", ACTIONS_RESTART);
            JSONArray containers = new JSONArray();
            try {
                // Get basic container information
                String psOutput = runCommand("bash", "-c",
                        "docker ps -a --no-trunc --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.RunningFor}}' 2>/dev/null");
                if (psOutput == null || psOutput.trim().isEmpty()) {
                    docker.put("containers", containers);
                    frontend.put("docker", docker);
                    return frontend;
                }

                // Get container resource usage
                String statsOutput = runCommand("bash", "-c",
                        "docker stats --no-stream --format '{{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}' 2>/dev/null");

                // Build the container information map
                Map<String, JSONObject> containerMap = new LinkedHashMap<>();
                String[] psLines = psOutput.split("\n");
                for (String line : psLines) {
                    line = line.trim();
                    if (line.isEmpty()) {
                        continue;
                    }
                    String[] parts = line.split("\t");
                    if (parts.length < 3) {
                        continue;
                    }

                    String containerName = parts[0].toLowerCase();
                    if(containerName.indexOf("data-agent-app") < 0){
                        continue;
                    }

                    JSONObject container = new JSONObject();
                    container.put("name", parts[0]);
                    container.put("image", parts.length > 1 ? parts[1] : "");
                    String statusStr = parts.length > 2 ? parts[2] : "";
                    String status = statusStr.toLowerCase().startsWith("up ") ? "running" : statusStr;
                    container.put("status", status);
                    container.put("ports", parts.length > 3 ? parts[3] : "");
                    container.put("cpu_percent", 0);
                    container.put("memory_mb", 0);
                    container.put("uptime_seconds", 0);

                    // Parse the running time
                    if (parts.length > 4) {
                        container.put("uptime_seconds", parseDockerRunningFor(parts[4]));
                    }
                    containerMap.put(parts[0], container);
                }

                // Fill in the CPU and memory data
                if (statsOutput != null && !statsOutput.trim().isEmpty()) {
                    String[] statsLines = statsOutput.split("\n");
                    for (String line : statsLines) {
                        line = line.trim();
                        if (line.isEmpty()) {
                            continue;
                        }
                        String[] parts = line.split("\t");
                        if (parts.length < 2) {
                            continue;
                        }
                        JSONObject container = containerMap.get(parts[0]);
                        if (container != null) {
                            String cpuStr = parts[1].replace("%", "").trim();
                            try {
                                container.put("cpu_percent", Double.parseDouble(cpuStr));
                            } catch (NumberFormatException e) {
                                // keep default
                            }
                            if (parts.length >= 3) {
                                container.put("memory_mb", parseDockerMemMb(parts[2]));
                            }
                        }
                    }
                }
                for (JSONObject c : containerMap.values()) {
                    containers.add(c);
                }
            } catch (Exception e) {
                // return empty containers
            }
            docker.put("containers", containers);
            frontend.put("docker", docker);
            return frontend;
        }


    /**
     * Restarts the frontend containers via docker compose up -d
     * @param composePath path of the directory containing docker-compose.yml and the .env file
     * @return JSON object containing the execution result
     */
    public JSONObject restartFrontend(String composePath) {
        JSONObject result = new JSONObject();
        result.put("success", false);

        if (composePath == null || composePath.isEmpty()) {
            result.put("message", "compose path is required");
            return result;
        }

        try {
            Path composeDir = Paths.get(composePath);
            Path composeFile = composeDir.resolve("docker-compose.yml");
            if (!Files.exists(composeFile)) {
                result.put("message", "docker-compose.yml not found at: " + composeFile);
                return result;
            }

            ProcessBuilder pb = new ProcessBuilder(
                    "docker", "compose", "up", "-d");
            pb.directory(composeDir.toFile());
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String output = readProcessOutput(p);
            boolean finished = p.waitFor(60, java.util.concurrent.TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                result.put("message", "Docker compose command timed out");
                return result;
            }
            int exitCode = p.exitValue();
            result.put("success", exitCode == 0);
            result.put("exitCode", exitCode);
            result.put("output", output != null ? output.trim() : "");
            result.put("message", exitCode == 0
                    ? "Frontend containers restarted successfully" : "Restart failed");
        } catch (Exception e) {
            result.put("success", false);
            result.put("message", e.getMessage());
        }
        return result;
    }

        // ======================== Helper methods ========================

        /**
         * Builds the default service JSON object (status is stopped)
         * @param name service name
         * @param actions supported action types
         * @return default service JSON
         */
        private JSONObject getDefaultServiceJson(String name, String[] actions) {
            JSONObject svc = new JSONObject();
            svc.put("name", name);
            svc.put("status", "stopped");
            svc.put("pid", "");
            svc.put("user", "matrix");
            svc.put("cpu_percent", 0);
            svc.put("memory_mb", 0);
            svc.put("uptime_seconds", 0);
            svc.put("actions", actions);
            return svc;
        }

        /**
         * Gets the CPU, memory, running time and user information of the specified process via the ps command
         * @param pid process ID
         * @return JSON object containing the process details
         */
        private JSONObject getServiceDetail(String pid) {
            JSONObject detail = new JSONObject();
            detail.put("cpu_percent", 0);
            detail.put("memory_mb", 0);
            detail.put("uptime_seconds", 0);
            detail.put("user", "");
            try {
                String output = runCommand("ps", "--no-headers", "-p", pid, "-o", "pcpu,rss,etime,user");
                if (output != null && !output.trim().isEmpty()) {
                    String[] parts = output.trim().split("\\s+");
                    if (parts.length >= 3) {
                        detail.put("cpu_percent", Double.parseDouble(parts[0]));
                        long rssKb = Long.parseLong(parts[1]);
                        detail.put("memory_mb", Math.round(rssKb / 1024.0 * 100.0) / 100.0);
                        detail.put("uptime_seconds", parseEtimeToSeconds(parts[2]));
                    }
                    if (parts.length >= 4) {
                        detail.put("user", parts[3]);
                    }
                }
            } catch (Exception e) {
                // keep defaults
            }
            return detail;
        }

        /**
         * Gets the current hostname
         * @return hostname string, returns "unknown" when retrieval fails
         */
        private String getHostname() {
            try {
                return InetAddress.getLocalHost().getHostName();
            } catch (Exception e) {
                try {
                    String output = runCommand("hostname");
                    if (output != null) {
                        return output.trim();
                    }
                } catch (Exception ignored) {
                }
                return "unknown";
            }
        }

        // ======================== Parsing utility methods ========================

        /**
         * Converts the running time in ps etime format to seconds
         * Format examples: 1-02:30:45 / 02:30:45 / 30:45
         * @param etime running time string output by ps
         * @return total seconds
         */
        private long parseEtimeToSeconds(String etime) {
            if (etime == null || etime.isEmpty()) {
                return 0;
            }
            Matcher m = ETIME_PATTERN.matcher(etime);
            if (m.find()) {
                long total = 0;
                String daysStr = m.group(1);
                String hoursStr = m.group(2);
                String minsStr = m.group(3);
                String secsStr = m.group(4);
                if (daysStr != null) {
                    total += Long.parseLong(daysStr) * 86400;
                }
                if (hoursStr != null) {
                    total += Long.parseLong(hoursStr) * 3600;
                }
                total += Long.parseLong(minsStr) * 60;
                total += Long.parseLong(secsStr);
                return total;
            }
            return 0;
        }

        /**
         * Converts the running time description output by Docker to seconds
         * Supports year/month/week/day/hour/minute/second and descriptions such as "About a minute ago"
         * @param runningFor running time field output by Docker ps
         * @return total seconds
         */
        private long parseDockerRunningFor(String runningFor) {
            if (runningFor == null || runningFor.isEmpty()) {
                return 0;
            }
            long seconds = 0;
            Pattern p = Pattern.compile("(\\d+)\\s*(year|month|week|day|hour|minute|second)s?",
                    Pattern.CASE_INSENSITIVE);
            Matcher m = p.matcher(runningFor);
            while (m.find()) {
                long val = Long.parseLong(m.group(1));
                String unit = m.group(2).toLowerCase();
                switch (unit) {
                    case "year":
                        seconds += val * 365 * 86400;
                        break;
                    case "month":
                        seconds += val * 30 * 86400;
                        break;
                    case "week":
                        seconds += val * 7 * 86400;
                        break;
                    case "day":
                        seconds += val * 86400;
                        break;
                    case "hour":
                        seconds += val * 3600;
                        break;
                    case "minute":
                        seconds += val * 60;
                        break;
                    case "second":
                        seconds += val;
                        break;
                }
            }
            // Special cases of Docker such as "About a minute ago"
            if (seconds == 0) {
                if (runningFor.toLowerCase().contains("less than a second")) {
                    return 1;
                }
                if (runningFor.toLowerCase().contains("about a minute")) {
                    return 60;
                }
            }
            return seconds;
        }

        /**
         * Parses the Docker memory usage string, extracts the used part and converts it to MB
         * Format example: 123.4MiB / 1.5GiB
         * @param memUsage memory field output by Docker stats
         * @return used memory (MB)
         */
        private long parseDockerMemMb(String memUsage) {
            if (memUsage == null || memUsage.isEmpty()) {
                return 0;
            }
            int slashIdx = memUsage.indexOf('/');
            String usedPart = slashIdx >= 0 ? memUsage.substring(0, slashIdx).trim() : memUsage.trim();
            return parseSizeToMb(usedPart);
        }

        /**
         * Converts a memory size string with a unit to an MB value
         * Supports suffixes such as GiB/GB/MiB/MB/KiB/KB/B
         * @param sizeStr size string
         * @return MB value
         */
        private long parseSizeToMb(String sizeStr) {
            if (sizeStr == null || sizeStr.isEmpty()) {
                return 0;
            }
            sizeStr = sizeStr.trim().toUpperCase();
            try {
                if (sizeStr.endsWith("GIB") || sizeStr.endsWith("GB")) {
                    double val = Double.parseDouble(sizeStr.replaceAll("[^\\d.]", ""));
                    return Math.round(val * 1024);
                } else if (sizeStr.endsWith("MIB") || sizeStr.endsWith("MB")) {
                    double val = Double.parseDouble(sizeStr.replaceAll("[^\\d.]", ""));
                    return Math.round(val);
                } else if (sizeStr.endsWith("KIB") || sizeStr.endsWith("KB")) {
                    double val = Double.parseDouble(sizeStr.replaceAll("[^\\d.]", ""));
                    return Math.round(val / 1024);
                } else if (sizeStr.endsWith("B")) {
                    double val = Double.parseDouble(sizeStr.replaceAll("[^\\d.]", ""));
                    return Math.round(val / 1024 / 1024);
                }
                return Math.round(Double.parseDouble(sizeStr) / 1024 / 1024);
            } catch (NumberFormatException e) {
                return 0;
            }
        }

        /**
         * Parses the JVM memory parameter value and converts it to GB
         * @param value numeric part
         * @param unit unit (G/M/K, or empty meaning bytes)
         * @return GB integer value
         */
        private int parseJvmSizeToGb(String value, String unit) {
            double number = Double.parseDouble(value);
            if (unit == null || unit.isEmpty()) {
                return (int) Math.round(number / 1024.0 / 1024.0 / 1024.0);
            }
            switch (unit.toLowerCase()) {
                case "g":
                    return (int) Math.round(number);
                case "m":
                    return (int) Math.round(number / 1024.0);
                case "k":
                    return (int) Math.round(number / 1024.0 / 1024.0);
                default:
                    return (int) Math.round(number / 1024.0 / 1024.0 / 1024.0);
            }
        }

        /**
         * Recursively finds the value of the specified key in the YAML parsing result
         * @param map Map parsed from YAML
         * @param key key to find
         * @return the found value, or null when not found
         */
        @SuppressWarnings("unchecked")
        private Object findYamlKey(Map<String, Object> map, String key) {
            if (map.containsKey(key)) {
                return map.get(key);
            }
            for (Object value : map.values()) {
                if (value instanceof Map) {
                    Object result = findYamlKey((Map<String, Object>) value, key);
                    if (result != null) {
                        return result;
                    }
                }
            }
            return null;
        }

        // ======================== Command line utility methods ========================

        /**
         * Executes a system command and returns the output content
         * @param cmd the command and its arguments
         * @return command output, or null when execution fails
         */
        private String runCommand(String... cmd) {
            try {
                ProcessBuilder pb = new ProcessBuilder(cmd);
                pb.redirectErrorStream(true);
                Process p = pb.start();
                String output = readProcessOutput(p);
                p.waitFor(10, java.util.concurrent.TimeUnit.SECONDS);
                return output;
            } catch (Exception e) {
                return null;
            }
        }

        /**
         * Reads the output stream of the process and returns the string content
         * @param p system process object
         * @return process output content
         * @throws IOException thrown when reading fails
         */
        private String readProcessOutput(Process p) throws IOException {
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append("\n");
                }
            }
            return sb.toString();
        }

        // ======================== main entry ========================

        /**
         * Program entry, parses the command line arguments and performs system monitoring data collection
         * Supported arguments: --root/-r <path>  specifies the ONNStore root directory
         *          --output/-o <path> specifies the output file path (optional; when not specified, output goes to the console)
         */
        public static void main(String[] args) {
            String onnStoreRoot = null;
            String outputPath = null;

            for (int i = 0; i < args.length; i++) {
                if ("--root".equals(args[i]) && i + 1 < args.length) {
                    onnStoreRoot = args[++i];
                } else if ("--output".equals(args[i]) && i + 1 < args.length) {
                    outputPath = args[++i];
                } else if ("-r".equals(args[i]) && i + 1 < args.length) {
                    onnStoreRoot = args[++i];
                } else if ("-o".equals(args[i]) && i + 1 < args.length) {
                    outputPath = args[++i];
                }
            }

            MaintenanceUtil monitor = new MaintenanceUtil();
            JSONObject result = monitor.collectAll(onnStoreRoot);

            if (outputPath != null && !outputPath.isEmpty()) {
                try {
                    monitor.saveToFile(result, outputPath);
                    System.out.println("Monitor data saved to: " + outputPath);
                } catch (IOException e) {
                    System.err.println("Failed to save file: " + e.getMessage());
                    System.out.println(result.toString());
                }
            } else {
                System.out.println(result.toString());
            }
        }
}
