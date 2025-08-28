import chalk from "chalk";
import { UnlockedAccount } from "./session";
import { ZkusdEngineClient } from "@zkusd/core/build/src/client/engine";

/**
 * @notice Checks the MINA balance of a wallet
 * @dev Retrieves the wallet state and checks the balance
 * @param client The ZkusdEngineClient instance
 * @param unlockedAccount The unlocked account to check
 * @return Promise resolving to the wallet balance
 */
export async function checkMinaBalance(client: ZkusdEngineClient, unlockedAccount: UnlockedAccount) {
  try {
    const publicKey = unlockedAccount.keyPair.publicKey.toBase58();
    const account = await client.fetchMinaAccount(publicKey);

    const pkey = unlockedAccount.keyPair.publicKey.toBase58();

    if (!account) {
      throw new Error(
        `No on-chain account on with public key ${pkey} found \nPlease check your account address and network configuration`
      );
    }

    if (account.balance.toBigInt() === 0n) {
      throw new Error(
        `Account with public key ${pkey} has no balance \nPlease send MINA to the account and try again`
      );
    }
  } catch (error) {
    console.error(chalk.red(`${error}`));
    process.exit(1);
  }
}
