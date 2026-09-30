package io.ontomato.dataengine.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "ontomato.monitor")
public class MonitorConfig {

    private String m3db;

	private String m3auth;
	
	private String m3classprefix;
	
	private String envName;

	public String getM3db() {
		return m3db;
	}

	public void setM3db(String m3db) {
		this.m3db = m3db;
	}

    public String getM3auth() {
        return m3auth;
    }

    public void setM3auth(String m3auth) {
        this.m3auth = m3auth;
    }
	
	public String getM3classprefix() {
		return m3classprefix;
	}

	public void setM3classprefix(String m3classprefix) {
		this.m3classprefix = m3classprefix;
	}

	public String getEnvName() {
		return envName;
	}

	public void setEnvName(String envName) {
		this.envName = envName;
	}

}
