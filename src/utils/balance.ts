import chalk from "chalk";
import { UnlockedAccount } from "./session";
import { fetchMinaAccount } from "@zkusd/core";

/**
 * @notice Checks the MINA balance of a wallet
 * @dev Retrieves the wallet state and checks the balance
 * @param unlockedAccount The unlocked account to check
 * @return Promise resolving to the wallet balance
 */
export async function checkMinaBalance(unlockedAccount: UnlockedAccount) {
  try {
    const account = await fetchMinaAccount({
      publicKey: unlockedAccount.keyPair.publicKey,
    });

    if (!account.account) {
      throw new Error(
        "Account not found \nPlease check your account address and network configuration"
      );
    }

    if (account.account.balance.toBigInt() === 0n) {
      throw new Error(
        "Account has no balance \nPlease send MINA to the account and try again"
      );
    }
  } catch (error) {
    console.error(chalk.red(`${error}`));
    process.exit(1);
  }
}
