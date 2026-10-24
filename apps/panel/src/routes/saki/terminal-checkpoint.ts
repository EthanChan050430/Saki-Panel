/** Undo is supplementary to a command whose account, workspace and approval checks already passed. */
export async function optionalTerminalCheckpoint<T>(operation: () => Promise<T>, phase: "capture" | "finalize") {
  try {
    return { value: await operation(), warning: "" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { value: undefined, warning: `File undo is unavailable for this terminal call: workspace checkpoint ${phase} failed (${reason}).` };
  }
}
