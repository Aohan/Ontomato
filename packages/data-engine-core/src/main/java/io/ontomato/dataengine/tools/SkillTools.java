package io.ontomato.dataengine.tools;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

import java.io.File;

@Slf4j
public class SkillTools {

    private String skill_dir = "";

    public SkillTools(String skill_dir) {
        this.skill_dir = skill_dir;
    }

    @Tool("Execute the Skill's Python script (*.py). " +
            "Input: relative path of the Skill's Python script, composed of the skill name + script path and parameters. " +
            "Output: execution output of the Skill's Python script.")
    public String executePythonFile(@P("Relative path of the Skill's Python script, composed of the skill name + script path. For example pdf/scripts/torun.py") String pythonfile,
                                    @P("Execution parameters of the Skill's Python script. For example '-f input.json' or '-d JSONDATA' , if there are no parameters pass an empty string ''") String parameter) {
        try {
            String scriptFile = "";
            File filePythonFile = new File(pythonfile);
            if (!filePythonFile.exists()) {
                String fullPath = null;
                if(this.skill_dir.endsWith("/")){
                    fullPath = this.skill_dir+pythonfile;
                } else {
                    fullPath = this.skill_dir+"/"+pythonfile;
                }
                File fileFullPath = new File(fullPath);
                if (!fileFullPath.exists()){
                    return "{\"error\": \"File not found: " + pythonfile + "\"}";
                } else {
                    scriptFile = fullPath;
                }
            } else {
                scriptFile = pythonfile;
            }

            // Execute Python script
            String sParameter = parameter.trim();
            log.info("executePythonFile:{} ,{}",scriptFile, sParameter);
            ProcessBuilder pb = new ProcessBuilder("python", scriptFile, sParameter);
            pb.redirectErrorStream(true);
            Process process = pb.start();

            String output = new String(process.getInputStream().readAllBytes());
            int exitCode = process.waitFor();

            if (exitCode != 0) {
                return "Error executing Python code:\n" + output;
            }

            return output.trim();

        } catch (Exception e) {
            return "Error: " + e.getMessage();
        }
    }

}
