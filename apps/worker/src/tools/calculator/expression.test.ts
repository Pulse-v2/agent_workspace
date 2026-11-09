import { describe, expect, it } from "vitest";
import { calculate, calculateInputSchema } from "../calculate.js";
import { ToolInputError } from "../types.js";
import { describeValues, evaluateExpression, ExpressionError, percentChange } from "./expression.js";

describe("evaluateExpression", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["2 ^ 3 ^ 2", 512],
    ["-2 ^ 2", -4],
    ["10 % 4", 2],
    ["1.5e3 / 3", 500],
    ["round(10 / 3, 2)", 3.33],
    ["max(1, 7, 3) - min(4, 2)", 5],
    ["sqrt(16) + abs(-2)", 6],
    ["2 * pi", 2 * Math.PI],
    ["((((1))))", 1],
  ])("evaluates %s", (expression, expected) => {
    expect(evaluateExpression(expression)).toBeCloseTo(expected);
  });

  it.each([
    ["1 / 0", /Division by zero/],
    ["sqrt(-1)", /negative/],
    ["", /empty/],
    ["2 +", /Unexpected end/],
    ["1 2", /Unexpected input/],
    ["foo(1)", /Unknown function/],
    ["round(1, 2, 3)", /expects/],
    ["10 ^ 400", /finite/],
  ])("rejects %s", (expression, message) => {
    expect(() => evaluateExpression(expression)).toThrow(message);
  });

  it("never executes code", () => {
    for (const attack of ["process.exit()", "constructor.constructor('x')()", "this", "a=1", "`x`", "require('fs')", "1;2"]) {
      expect(() => evaluateExpression(attack)).toThrow(ExpressionError);
    }
  });

  it("limits length and nesting", () => {
    expect(() => evaluateExpression("1+".repeat(300) + "1")).toThrow();
    expect(() => evaluateExpression("(".repeat(60) + "1" + ")".repeat(60))).toThrow(/nested too deeply/);
  });
});

describe("statistics helpers", () => {
  it("describes values", () => {
    expect(describeValues([2, 4, 4, 4, 5, 5, 7, 9])).toMatchObject({ count: 8, sum: 40, mean: 5, median: 4.5, min: 2, max: 9, std_dev: 2 });
  });

  it("computes percent change and rejects a zero baseline", () => {
    expect(percentChange(80, 100)).toBe(25);
    expect(percentChange(-50, -25)).toBe(50);
    expect(() => percentChange(0, 5)).toThrow();
  });
});

describe("calculate tool", () => {
  it("validates input shapes", () => {
    expect(calculateInputSchema.safeParse({ kind: "expression", expression: "1+1" }).success).toBe(true);
    expect(calculateInputSchema.safeParse({ kind: "statistics", values: [] }).success).toBe(false);
    expect(calculateInputSchema.safeParse({ kind: "eval", code: "1" }).success).toBe(false);
  });

  it("returns structured results and converts math errors into model-correctable errors", () => {
    expect(calculate({ kind: "percent_change", from: 200, to: 230 })).toEqual({ kind: "percent_change", from: 200, to: 230, result: 15 });
    expect(() => calculate({ kind: "expression", expression: "1/0" })).toThrow(ToolInputError);
  });
});
