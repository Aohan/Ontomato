package io.ontomato.dataengine.dao;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.AfterCalculatorEvaluation;
import io.ontomato.dataengine.bean.DslCookerEvaluation;
import io.ontomato.dataengine.bean.DslCookerEvaluation.Illegal;
import io.ontomato.dataengine.bean.QuestionSpliterEvaluation;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("evaluationDao")
public class EvaluationDao {
	
	private String dirName = "evaluation";
	
	public void saveQuestionSpliterEvaluation(QuestionSpliterEvaluation evaluation) {
		FileOutputStream fos = null;
		try {
			File taskDir = new File("conf/" + dirName + "/" + evaluation.getSessionId());
			taskDir.mkdirs();
			File file = new File(taskDir, "questionSpliter.json");
			fos = new FileOutputStream(file);
			fos.write(JSON.toJSONString(evaluation, JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue).getBytes("utf-8"));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}
	
	public void saveDslCookerEvaluation(DslCookerEvaluation evaluation, int index) {
		FileOutputStream fos = null;
		try {
			File taskDir = new File("conf/" + dirName + "/" + evaluation.getSessionId());
			taskDir.mkdirs();
			File file = new File(taskDir, "dslCooker_" + index + ".json");
			fos = new FileOutputStream(file);
			fos.write(JSON.toJSONString(evaluation, JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue).getBytes("utf-8"));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}
	
	public DslCookerEvaluation readDslCookerEvaluation(String sessionId, Integer index) {
		FileInputStream fis = null;
		try {
			File taskDir = new File("conf/" + dirName + "/" + sessionId);
			File file = new File(taskDir, "dslCooker_" + index + ".json");
			if (file.exists()) {
				fis = new FileInputStream(file);
				JSONObject obj = JSONObject.parseObject(new String(fis.readAllBytes(), "utf-8"));
				DslCookerEvaluation evaluation = new DslCookerEvaluation();
				evaluation.setSessionId(obj.getString("sessionId"));
				evaluation.setQuestion(obj.getString("question"));
				evaluation.setUserMessage(obj.getString("userMessage"));
				evaluation.setUserMessageWithoutExample(obj.getString("userMessageWithoutExample"));
				evaluation.setAbcQuestion(obj.getString("abcQuestion"));
				evaluation.setDslStr(obj.getString("dslStr"));
				evaluation.setPass(obj.getBoolean("pass"));
				List<Illegal> illegals = new ArrayList<Illegal>();
				JSONArray illegalArray = obj.getJSONArray("illegals");
				for (int i = 0; i < illegalArray.size(); i++) {
					JSONObject illegalObj = illegalArray.getJSONObject(i);
					Illegal illegal = evaluation.new Illegal();
					illegal.setType(illegalObj.getString("type"));
					illegal.setConclusion(illegalObj.getString("conclusion"));
					illegals.add(illegal);
				}
				evaluation.setIllegals(illegals);
				return evaluation;
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		} finally {
			if (fis != null) {
				try {
					fis.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
		return null;
	}
	
	public void saveAfterCalculatorEvaluation(AfterCalculatorEvaluation evaluation) {
		FileOutputStream fos = null;
		try {
			File taskDir = new File("conf/" + dirName + "/" + evaluation.getSessionId());
			taskDir.mkdirs();
			File file = new File(taskDir, "afterCalculator.json");
			fos = new FileOutputStream(file);
			fos.write(JSON.toJSONString(evaluation, JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue).getBytes("utf-8"));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}
	
	public void deleteEvaluation(String sessionId) {
		File taskDir = new File("conf/" + dirName + "/" + sessionId);
		if (taskDir.exists()) {
			if (taskDir.isDirectory()) {
				File[] evaluationFiles = taskDir.listFiles();
				for (File evaluationFile : evaluationFiles) {
					evaluationFile.delete();
				}
			}
			taskDir.delete();
		}
	}
	
	public List<File> readEvaluationDirs() {
		List<File> taskFiles = new ArrayList<File>();
		File baseDir = new File("conf/" + dirName);
		File[] taskDirs = baseDir.listFiles();
		if (taskDirs != null) {
			for (File taskDir : taskDirs) {
				if (taskDir.isDirectory()) {
					taskFiles.add(taskDir);
				}
			}
		}
		return taskFiles;
	}

}
