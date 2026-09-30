package io.ontomato.dataengine.dataAdapter;

public class UnsupportedDataAdapterOperationException extends UnsupportedOperationException {

	public UnsupportedDataAdapterOperationException(String adapterType, String operation) {
		super(adapterType + " data source does not support " + operation);
	}
}
