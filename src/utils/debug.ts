let chalk: typeof import("chalk") | null = null;

async function getChalk() {
  if (!chalk) {
    try {
      chalk = await import("chalk");
    } catch {
      chalk = null; // Silently fail if chalk cannot be imported
    }
  }
  return chalk;
}

/**
 * Prints the top `n` lines of the error stack (default: 3), optionally with color.
 */
export async function printErrorStack(error: any, n: number = 3): Promise<void> {
  if (error?.stack) {
    const lines = error.stack.split("\n").slice(0, n + 1); // +1 to include the message line
    const chalkModule = await getChalk(); // chalkModule is of type `typeof import("chalk") | null`
    const output = lines.join("\n");

    // Corrected part:
    // Check if chalkModule and its default export are available,
    // and if the .gray method exists on the default export.
    if (chalkModule && chalkModule.default && typeof chalkModule.default.gray === 'function') {
      console.error(chalkModule.default.gray(output));
    } else {
      console.error(output); // Fallback to uncolored output if chalk or .default.gray is not available
    }
  }
}
