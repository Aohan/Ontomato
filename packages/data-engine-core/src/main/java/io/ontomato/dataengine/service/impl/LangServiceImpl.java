package io.ontomato.dataengine.service.impl;

import java.util.HashMap;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.util.FileUtil;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class LangServiceImpl implements LangService {
	
	private static final String DEFAULT_LANG = "en";

	private Map<String, JSONArray> langMap = new HashMap<String, JSONArray>();
	
	@PostConstruct
	public void initService() {
		try {
			// Both file name and content are taken from the classpath: the same directory has only one way of being located, not dependent on the process working directory
			for (String langFileName : FileUtil.listResourceNames("lang")) {
				if (langFileName.endsWith(".json")) {
					String lang = langFileName.substring(0, langFileName.length() - 5);
					String content = FileUtil.getResourceFileLoadAll("lang/" + langFileName, "utf-8");
					JSONArray array = JSONArray.parseArray(content);
					langMap.put(lang, array);
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	// The requested pack, then the installed English pack, then the key itself: an edition installs only
	// the packs it ships (open source: en only), so a request for another language must not fail.
	@Override
	public String get(String lang, String key) {
		String value = find(langMap.get(lang), key);
		if (value == null) {
			value = find(langMap.get(DEFAULT_LANG), key);
		}
		return value == null ? key : value;
	}

	private static String find(JSONArray array, String key) {
		if (array == null) {
			return null;
		}
		for (int i = 0; i < array.size(); i++) {
			JSONObject obj = array.getJSONObject(i);
			if (obj.getString("key").equals(key)) {
				return obj.getString("value");
			}
		}
		return null;
	}

}
