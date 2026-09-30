package io.ontomato.dataengine.bean.function;

import java.util.List;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;

import lombok.Data;

@Data
public class ReturnDef {

	private List<ABCHarnessProgramOutKeyRef> outKeyRefs;
	private Boolean isVoid;
	private JSONObject value;
	private List<String> classNames;
	
}
