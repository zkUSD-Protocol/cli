/**
 * @title Command Factory
 * @notice Factory for creating and registering CLI commands
 * @dev Simplifies the process of managing multiple command classes
 */
import { Command } from "commander";
import { CommandBase } from "./base.js";

/**
 * @title CommandFactory
 * @notice Factory for creating and registering command modules
 * @dev Provides a centralized way to register all command modules
 */
export class CommandFactory {
  /**
   * @notice Registry of available command modules
   * @dev Maps command names to their implementation classes
   */
  private commands: Map<string, CommandBase>;

  /**
   * @notice Create a new command factory
   */
  constructor() {
    this.commands = new Map<string, CommandBase>();
  }

  /**
   * @notice Register a command with the factory
   * @param command The command implementation to register
   * @return The factory instance for chaining
   */
  public registerCommand(command: CommandBase): CommandFactory {
    this.commands.set(command.constructor.name, command);
    return this;
  }

  /**
   * @notice Register all commands with the provided program
   * @param program The Commander program to register commands with
   */
  public registerAll(program: Command): void {
    this.commands.forEach((command) => {
      command.register(program);
    });
  }
}

/**
 * @notice Create a new factory with the provided commands
 * @param commands Array of command implementations to register
 * @return A command factory with the commands registered
 */
export function createCommandFactory(commands: CommandBase[]): CommandFactory {
  const factory = new CommandFactory();
  commands.forEach((command) => factory.registerCommand(command));
  return factory;
}
