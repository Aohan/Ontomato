package io.ontomato.dataengine.tools;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;

@Component
public class ABCHarnessFileTools {

    /** The path-based execution action immediately following saving, provided by the owning Agent's skill tools (the only parameter is the path). */
    public interface PostSaveAction {
        String run(String path) throws Exception;
    }

    private final AgentWorkspaceService workspaceService;

    /** Agent name -> the follow-up actions available to that Agent; same-named actions of different Agents neither override nor see each other. */
    private final Map<String, Map<String, PostSaveAction>> postSaveActions;

    @Autowired
    public ABCHarnessFileTools(AgentWorkspaceService workspaceService,
            DslSkillTools dslSkillTools,
            SandboxSkillTools sandboxSkillTools,
            ABCProgrammerSkillTools abcProgrammerSkillTools,
            AfterCalculatorSkillTools afterCalculatorSkillTools,
            ReadFunctionMakerSkillTools readFunctionMakerSkillTools,
            ABCProgramDashboardMakerSkillTools abcProgramDashboardMakerSkillTools) {
        this.workspaceService = workspaceService;
        Map<String, Map<String, PostSaveAction>> actions = new HashMap<>();
        actions.put(MultiThreadAIChatService.DSL_COOKER, Map.of("executeDslFile", dslSkillTools::executeDslFile));
        actions.put(MultiThreadAIChatService.ACTION_MAKER, Map.of(
                "executeDslFile", dslSkillTools::executeDslFile,
                "query", sandboxSkillTools::query));
        actions.put(MultiThreadAIChatService.ABC_PROGRAMMER, Map.of(
                "executeDslFile", dslSkillTools::executeDslFile,
                "test", abcProgrammerSkillTools::test));
        actions.put(MultiThreadAIChatService.TOOL_AND_PYTHON_CALCULATOR,
                Map.of("test", afterCalculatorSkillTools::test));
        actions.put(MultiThreadAIChatService.PYTHON_CALCULATOR,
                Map.of("test", afterCalculatorSkillTools::test));
        actions.put(MultiThreadAIChatService.READ_FUNCTION_MAKER,
                Map.of("test", path -> readFunctionMakerSkillTools.test(Boolean.FALSE, path, null)));
        actions.put(MultiThreadAIChatService.METRIC_VIEW_MAKER, Map.of(
                "executeDslFile", dslSkillTools::executeDslFile,
                "test", path -> readFunctionMakerSkillTools.test(Boolean.FALSE, path, null)));
        actions.put(MultiThreadAIChatService.ABC_PROGRAM_DASHBOARD_MAKER,
                Map.of("test", path -> abcProgramDashboardMakerSkillTools.test(Boolean.FALSE, path, null)));
        Map<String, Map<String, PostSaveAction>> frozen = new HashMap<>();
        actions.forEach((agent, agentActions) -> frozen.put(agent, Map.copyOf(agentActions)));
        this.postSaveActions = Map.copyOf(frozen);
    }

    private String sessionId() {
        return AgentCallContext.current().getSessionId();
    }

    @Tool("List the files in this workspace; path uses a relative directory, use . for the root directory")
    public List<String> listFiles(@P("relative directory") String path) throws Exception {
        Path directory = workspaceService.resolve(sessionId(), path);
        try (var files = Files.list(directory)) {
            return files.sorted().map(file -> file.getFileName().toString()
                    + (Files.isDirectory(file, java.nio.file.LinkOption.NOFOLLOW_LINKS) ? "/" : "")).toList();
        }
    }

    @Tool("Read the specified lines of a file in this workspace and return the line numbers; by default read 200 lines starting from line 1")
    public String readFile(@P("relative file path") String path,
            @P(value = "start line number, starting from 1", required = false) Integer startLine,
            @P(value = "number of lines to read", required = false) Integer lineCount) throws Exception {
        int start = startLine == null ? 1 : startLine;
        int count = lineCount == null ? 200 : lineCount;
        if (start < 1 || count < 1) throw new IllegalArgumentException("The start line and the line count must be greater than 0");
        List<String> lines = Files.readAllLines(workspaceService.resolve(sessionId(), path));
        StringBuilder result = new StringBuilder();
        int end = (int)Math.min(lines.size(), (long)start - 1 + count);
        for (int i = start - 1; i < end; i++) result.append(i + 1).append(": ").append(lines.get(i)).append('\n');
        return result.append("Total lines: ").append(lines.size()).toString();
    }

    @Tool("Create or completely overwrite a text file in this workspace; prefer editFile to modify existing content")
    public String writeFile(@P("relative file path") String path, @P("full file content") String content,
            @P(value = "the execution action immediately following saving: only fill in the name of a path-based execution action that this Agent already has; if not filled, only save", required = false) String runAfter) throws Exception {
        Path file = workspaceService.resolve(sessionId(), path);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
        return afterSave("File saved", path, runAfter);
    }

    @Tool("Partially modify a file: oldText must match exactly once in the file, replace it with newText, keep the rest unchanged")
    public String editFile(@P("relative file path") String path,
            @P("the original text to be replaced") String oldText, @P("the content after replacement") String newText,
            @P(value = "the execution action immediately following saving: only fill in the name of a path-based execution action that this Agent already has; if not filled, only save", required = false) String runAfter) throws Exception {
        Path file = workspaceService.resolve(sessionId(), path);
        String content = Files.readString(file);
        if (oldText == null || oldText.isEmpty()) throw new IllegalArgumentException("The original text to be replaced must not be empty");
        if (newText == null) throw new IllegalArgumentException("The content after replacement must not be null");
        int start = content.indexOf(oldText);
        if (start < 0 || content.indexOf(oldText, start + 1) >= 0) {
            throw new IllegalArgumentException("The original text must match exactly once, please read the relevant lines and provide enough context");
        }
        Files.writeString(file, content.substring(0, start) + newText + content.substring(start + oldText.length()));
        return afterSave("File modified", path, runAfter);
    }

    private String afterSave(String saved, String path, String runAfter) {
        if (runAfter == null || runAfter.isBlank()) return saved;
        Map<String, PostSaveAction> actions = postSaveActions.get(AgentCallContext.current().getAgentName());
        PostSaveAction action = actions == null ? null : actions.get(runAfter);
        if (action == null) return saved + "\nUnknown follow-up action: " + runAfter + ", not executed";
        try {
            return saved + "\n" + action.run(path);
        } catch (Exception e) {
            return saved + "\nExecution error: " + e.getMessage();
        }
    }
}
