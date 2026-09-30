package io.ontomato.dataengine.bean.abcHarness;

import java.util.List;

import lombok.Data;

@Data
public class ABCHarnessProgram {

	private String question;
	private String code;
	private List<ABCHarnessProgramOutKeyRef> outKeyRefs;
	
}
