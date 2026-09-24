package io.ontomato.dataengine.tools;

import java.io.File;
import java.io.FileInputStream;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.logging.AgentCallContext;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("actionCodeExplainerSkillTools")
public class ActionCodeExplainerSkillTools {

	@Tool("Read code\n" +
            "Input:  start line, end line (the line number of the first line is 1; when the start line is null, all code is returned)\n" +
            "Output: code content or error ")
    public String readCode(@P("start line") Integer startLine, @P("end line") Integer endLine) {
		String ret = "";
		FileInputStream fis = null;
		
		try {
			AgentCallContext callContext = AgentCallContext.current();
			String sessionId = callContext.getSessionId();
			
			File codeFile = new File(new File(ServiceConst.CODE_EXPLAIN_BASE), sessionId + ".py");
			if (codeFile.exists()) {
				// Read the entire file content and split it by line (the line number of the first line is 1)
				fis = new FileInputStream(codeFile);
				String allCode = new String(fis.readAllBytes(), "utf-8");
				String[] lines = allCode.split("\n", -1);
				
				if (startLine == null) {
					// Return all code
					ret = allCode;
				} else {
					if (startLine >= 1) {
						if (endLine == null) {
							// Return the code from the start line to the end
							ret = joinLines(lines, startLine - 1, lines.length);
						} else {
							if (startLine <= endLine) {
								// Return the code within the specified range
								ret = joinLines(lines, startLine - 1, Math.min(endLine, lines.length));
							} else {
								throw new Exception("The start line cannot be greater than the end line");
							}
						}
					} else {
						throw new Exception("The start line cannot be less than 1");
					}
				}
			} else {
				throw new Exception("The code file does not exist");
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret = "Failed to get code: " + e.getMessage();
		} finally {
			// Close the stream
			if (fis != null) {
				try {
					fis.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
		return ret;
	}
	
	// Concatenate the lines between lines[from..to), separated by \n
	private String joinLines(String[] lines, int from, int to) {
		StringBuilder sb = new StringBuilder();
		for (int i = from; i < to; i++) {
			if (i > from) {
				sb.append("\n");
			}
			sb.append(lines[i]);
		}
		return sb.toString();
	}
	
}
