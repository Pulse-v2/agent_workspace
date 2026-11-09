import { z } from "zod";
import { describeValues, evaluateExpression, ExpressionError, percentChange } from "./calculator/expression.js";
import { defineTool, ToolInputError } from "./types.js";

const finite = z.number().refine(Number.isFinite, "Must be a finite number.");

export const calculateInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("expression"),
    expression: z.string().trim().min(1).max(500)
      .describe("Arithmetic using numbers, + - * / % ^, parentheses, pi, e, and abs, sqrt, round, floor, ceil, min, max, ln, log10, exp, pow."),
  }),
  z.object({ kind: z.literal("statistics"), values: z.array(finite).min(1).max(10_000) }),
  z.object({ kind: z.literal("percent_change"), from: finite, to: finite }),
]);

const statisticsSchema = z.object({
  count: z.number(), sum: z.number(), mean: z.number(), median: z.number(), min: z.number(), max: z.number(),
  variance: z.number(), std_dev: z.number(),
});

export const calculateOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("expression"), expression: z.string(), result: z.number() }),
  z.object({ kind: z.literal("statistics"), result: statisticsSchema }),
  z.object({ kind: z.literal("percent_change"), from: z.number(), to: z.number(), result: z.number() }),
]);
type CalculateOutput = z.infer<typeof calculateOutputSchema>;

const round = (value: number) => Number(value.toPrecision(12));

export function calculate(input: z.infer<typeof calculateInputSchema>): CalculateOutput {
  try {
    switch (input.kind) {
      case "expression":
        return { kind: "expression", expression: input.expression, result: round(evaluateExpression(input.expression)) };
      case "statistics": {
        const stats = describeValues(input.values);
        return {
          kind: "statistics",
          result: {
            count: stats.count, sum: round(stats.sum), mean: round(stats.mean), median: round(stats.median),
            min: stats.min, max: stats.max, variance: round(stats.variance), std_dev: round(stats.std_dev),
          },
        };
      }
      case "percent_change":
        return { kind: "percent_change", from: input.from, to: input.to, result: round(percentChange(input.from, input.to)) };
    }
  } catch (error) {
    if (error instanceof ExpressionError) throw new ToolInputError(error.message);
    throw error;
  }
}

export const calculateTool = defineTool({
  name: "calculate",
  title: "Calculate",
  description: "Perform exact arithmetic, descriptive statistics, or percent change. Use it instead of doing math yourself.",
  stepType: "tool",
  inputSchema: calculateInputSchema,
  outputSchema: calculateOutputSchema,
  allowedRoles: ["admin", "member"],
  requiresApproval: false,
  async execute(input) {
    return calculate(input);
  },
  summarize(output) {
    switch (output.kind) {
      case "expression": return `${output.expression} = ${output.result}`;
      case "percent_change": return `Change from ${output.from} to ${output.to} = ${output.result}%`;
      case "statistics": return `Statistics: ${JSON.stringify(output.result)}`;
    }
  },
});
