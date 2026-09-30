package io.ontomato.dataengine.util;

public class ShortCodeGenerator {
	
	private static final String BASE36_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

	public static String gerenate() {
        long timestamp = System.currentTimeMillis();
        int random = Double.valueOf(Math.random() * 10000D).intValue();
        return encode(timestamp * random);
    }
	
	// decimal to Base36
    private static String encode(long number) {
        if (number < 0) {
        	number = Long.MAX_VALUE + number;
        }
        StringBuilder result = new StringBuilder();
        while (number > 0) {
            result.insert(0, BASE36_CHARS.charAt((int) (number % 36)));
            number /= 36;
        }
        return result.toString();
    }

    // Base36 to decimal
//    private static long decode(String str) {
//        long result = 0;
//        for (char c : str.toCharArray()) {
//            int value = BASE36_CHARS.indexOf(c);
//            if (value < 0) throw new IllegalArgumentException("Invalid Base36 string");
//            result = result * 36 + value;
//        }
//        return result;
//    }
	
}
