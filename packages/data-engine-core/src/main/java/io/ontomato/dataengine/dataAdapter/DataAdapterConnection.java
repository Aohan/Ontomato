package io.ontomato.dataengine.dataAdapter;

import lombok.Data;

/** Saved connection of one data adapter type; an adapter reads only the fields its provider declares. */
@Data
public class DataAdapterConnection {
	private String url;
	private String user;
	private String password;
}
