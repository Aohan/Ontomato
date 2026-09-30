import argparse

import sympy as sp
from mcp.server.fastmcp import FastMCP


def parse_args():
    parser = argparse.ArgumentParser(description="DataRAG MCP calculation service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18500)
    return parser.parse_args()


args = parse_args()
mcp = FastMCP("my testing mcp server", host=args.host, port=args.port)


@mcp.tool()
async def basicArithmeticOperations(expression: str) -> float:
    """Basic arithmetic operations.
    Args:
        expression: arithmetic expression
    """
    print(f"Arithmetic expression:{expression}\n")
    result1 = sp.sympify(expression)
    print(f"Result:{result1}\n")
    return float(result1)


if __name__ == "__main__":
    mcp.run(transport='sse')
