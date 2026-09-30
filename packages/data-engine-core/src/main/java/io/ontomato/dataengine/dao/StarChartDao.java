package io.ontomato.dataengine.dao;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("starChartDao")
public class StarChartDao {

	private String dirName = "starChart";
	
	public void writeWholeData(JSONObject data, String mode, String suffix, String domainId) {
		FileOutputStream fos = null;
		try {
			File file = new File("conf/" + dirName + "/wholeData-" + mode + "-" + suffix + "-" + domainId + ".json");
			file.getParentFile().mkdirs();
			fos = new FileOutputStream(file);
			fos.write(JSON.toJSONString(data, Feature.WriteMapNullValue).getBytes("utf-8"));
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
	
	public JSONObject readWholeData(String mode, String suffix, String domainId) {
		FileInputStream fis = null;
		try {
			fis = new FileInputStream(new File("conf/" + dirName + "/wholeData-" + mode + "-" + suffix + "-" + domainId + ".json"));
			JSONObject data = JSONObject.parseObject(new String(fis.readAllBytes(), "utf-8"));
			return data;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return null;
		} finally {
			if (fis != null) {
				try {
					fis.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}
	
}
