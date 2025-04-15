import chalk from "chalk";

// Helper functions for formatting the output
export function formatHealthFactor(healthFactor: number): string {
  if (healthFactor === Number.MAX_SAFE_INTEGER) return "∞ (No debt)";
  return `${healthFactor.toFixed(2)}`;
}

export function formatCollateralizationRatio(ratio: number): string {
  if (ratio === Number.MAX_SAFE_INTEGER) return "∞ (No debt)";
  return `${ratio.toFixed(2)}%`;
}

export function formatLiquidationRisk(healthFactor: number): string {
  if (healthFactor === Number.MAX_SAFE_INTEGER) {
    return chalk.green("NONE");
  } else if (healthFactor >= 150) {
    return chalk.green("SAFE");
  } else if (healthFactor >= 130) {
    return chalk.blue("MODERATE");
  } else if (healthFactor >= 120) {
    return chalk.yellow("CAUTION");
  } else if (healthFactor >= 100) {
    return chalk.red("HIGH RISK");
  } else {
    return chalk.bgRed(chalk.white("LIQUIDATABLE"));
  }
}
