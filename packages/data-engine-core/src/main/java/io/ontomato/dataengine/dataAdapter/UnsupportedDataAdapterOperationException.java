package io.ontomato.dataengine.dataAdapter;

public class UnsupportedDataAdapterOperationException extends UnsupportedOperationException {

	private final String adapterType;
	private final String operation;

	public UnsupportedDataAdapterOperationException(String adapterType, String operation) {
		super(adapterType + " data source does not support " + operation);
		this.adapterType = adapterType;
		this.operation = operation;
	}

	public String getAdapterType() {
		return adapterType;
	}

	public String getOperation() {
		return operation;
	}
}
