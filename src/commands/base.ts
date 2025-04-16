/**
 * @title CommandBase - Base class for all CLI commands
 * @notice This abstract class provides the foundation for all command implementations
 * @dev All command implementations should extend this class and implement the register method
 */
import { Command } from "commander";

export abstract class CommandBase {
  /**
   * @notice Name of the command
   * @dev This property is used to identify the command in logs and debugging
   */
  protected name: string;

  /**
   * @notice Description of what the command does
   * @dev This will be displayed in the CLI help output
   */
  protected description: string;

  /**
   * @param name The name of the command
   * @param description A brief description of the command's purpose
   */
  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  /**
   * @notice Register this command with the provided command program
   * @dev Implementations should define the command structure, options, and actions
   * @param program The Commander program or command to register with
   */
  public abstract register(program: Command): void;
}
