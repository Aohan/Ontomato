package io.ontomato.dataengine.util;

import java.util.ArrayList;
import java.util.List;

public class MathExpressionParser {
    private final List<String> tokens;
    private int pos;

    public MathExpressionParser(List<String> tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    private String currentToken() {
        return pos < tokens.size() ? tokens.get(pos) : null;
    }

    private void nextToken() {
        pos++;
    }

    public double parse() {
        return parseExpression();
    }

    private double parseExpression() {
        double result = parseTerm();
        while (currentToken() != null && (currentToken().equals("+") || currentToken().equals("-"))) {
            String op = currentToken();
            nextToken();
            double term = parseTerm();
            if (op.equals("+")) {
                result += term;
            } else {
                result -= term;
            }
        }
        return result;
    }

    private double parseTerm() {
        double result = parseFactor();
        while (currentToken() != null && (currentToken().equals("*") || currentToken().equals("/"))) {
            String op = currentToken();
            nextToken();
            double factor = parseFactor();
            if (op.equals("*")) {
                result *= factor;
            } else {
                if (factor == 0.0) {
                    throw new ArithmeticException("Division by zero");
                }
                result /= factor;
            }
        }
        return result;
    }

    private double parseFactor() {
        int sign = 1;
        while (currentToken() != null && (currentToken().equals("+") || currentToken().equals("-"))) {
            if (currentToken().equals("-")) {
                sign *= -1;
            }
            nextToken();
        }

        double result;
        String token = currentToken();
        if (token.equals("(")) {
            nextToken(); // consume '('
            result = parseExpression();
            if (currentToken() == null || !currentToken().equals(")")) {
                throw new RuntimeException("Missing closing parenthesis");
            }
            nextToken(); // consume ')'
        } else {
            try {
                result = Double.parseDouble(token);
            } catch (NumberFormatException e) {
                throw new RuntimeException("Invalid number: " + token);
            }
            nextToken();
        }
        return sign * result;
    }

    public static List<String> tokenize(String exp) {
        List<String> tokens = new ArrayList<>();
        int i = 0;
        while (i < exp.length()) {
            char c = exp.charAt(i);
            if (Character.isDigit(c) || c == '.') {
                int start = i;
                while (i < exp.length() && (Character.isDigit(exp.charAt(i)) || exp.charAt(i) == '.')) {
                    i++;
                }
                tokens.add(exp.substring(start, i));
                continue;
            } else if (c == '+' || c == '-' || c == '*' || c == '/' || c == '(' || c == ')') {
                tokens.add(String.valueOf(c));
            } else {
            	throw new RuntimeException("illegal expr");
            }
            i++;
        }
        return tokens;
    }
    
    public static Double calculate(String exp) {
    	List<String> tokens = tokenize(exp);
    	MathExpressionParser parser = new MathExpressionParser(tokens);
    	return parser.parse();
    }
    
}
