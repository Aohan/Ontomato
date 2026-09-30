package io.ontomato.dataengine.dao;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.util.ShortCodeGenerator;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("subQueryWorkspaceDao")
public class SubQueryWorkspaceDao {

	private String dirName = "subQueryWorkspace";
	
	@PostConstruct
	public void initDao() {
		new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeout = 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						File dir = new File("conf/" + dirName);
						if (dir.exists()) {
							File[] childFiles = dir.listFiles();
							if (childFiles != null) {
								for (File childFile : childFiles) {
									if (childFile.lastModified() < now - timeout) {
										childFile.delete();
									}
								}
							}
						}
						Thread.sleep(5 * 60 * 1000);
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
				}
			}
		}).start();
	}
	
	public String writeResult(JSONObject result) {
		String id = ShortCodeGenerator.gerenate();
		try (FileOutputStream fos = new FileOutputStream(newWorkspaceFile(id))) {
			JSONObject workspace = new JSONObject();
			workspace.put("id", id);
			workspace.put("result", result);
			fos.write(JSON.toJSONString(workspace, JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue).getBytes("utf-8"));
			return id;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new IllegalStateException("Failed to save card result snapshot", e);
		}
	}

	private File newWorkspaceFile(String id) {
		File file = new File("conf/" + dirName + "/" + id + ".json");
		if (!file.getParentFile().exists()) {
			file.getParentFile().mkdirs();
		}
		return file;
	}
	
	public JSONObject readResult(String id) throws IOException {
		Path file = Path.of("conf", dirName, id + ".json");
		final byte[] bytes;
		try {
			bytes = Files.readAllBytes(file);
		} catch (NoSuchFileException e) {
			return null;
		}
		JSONObject obj = JSONObject.parseObject(new String(bytes, StandardCharsets.UTF_8));
		JSONObject result = obj == null ? null : obj.getJSONObject("result");
		if (result == null) {
			throw new IOException("Card result snapshot has no result");
		}
		return result;
	}
	
}
