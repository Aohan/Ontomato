package io.ontomato.dataengine.bean.abcHarness;

import java.util.List;

import lombok.Data;

@Data
public class ABCHarnessDashboard {

	private String title;
	private String code;
	private List<ABCHarnessProgramOutKeyRef> outKeyRefs;
	private List<ABCHarnessDashboardParameter> parameters;
	
}
