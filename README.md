# Fizk Protocol CLI

A command-line interface for interacting with the Fizk Protocol on the Mina blockchain.

## Overview

The Fizk Protocol CLI provides a simple way to interact with Fizk's decentralized stablecoin system on the Mina blockchain. It allows you to create and manage vaults, deposit and withdraw collateral, mint and repay zkUSD stablecoins, and more.

## Features

- **Account Management**: Import a Mina account, which is encrypted and stored on disk, no need to store your private key in an env file.
- **Network Selection**: Select the network you want to use, either devnet, lightnet or mainnet.
- **Vault Operations**: Create, deposit to, withdraw from, and manage vaults.
- **Prover**: Start a local client-side prover for transaction proving.
- **Lightnet Configuration**: If you are testing with lightnet, you can set the price of zkUSD to any value you want.

## Installation

### Prerequisites

- Node.js v18 or later
- npm or yarn

#### Platform-specific requirements

**Linux**:
This tool uses the system keychain for storing passwords, so you may need to install `libsecret` before installing the CLI:

- Debian/Ubuntu: `sudo apt-get install libsecret-1-dev`
- Red Hat-based: `sudo yum install libsecret-devel`
- Arch Linux: `sudo pacman -S libsecret`

**Windows**:
Make sure you have the latest Visual Studio build tools installed:

- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- During installation, select the "Desktop development with C++" workload

### Global Installation

```bash
# Install globally with npm
npm install -g @zkusd/cli

# Or with yarn
yarn global add @zkusd/cli
```

## Quick Start

1. **Set up your network**:

   Before you start, you need to set the network you want to use.

   ```bash
   zkusd network use devnet
   ```

2. **Import your account**:

   You will also need to import an account that can be used by the CLI. The account's private key will be encrypted and stored on disk. The tool uses your devices keychain to store the password during sessions.

   ```bash
   zkusd account import
   ```

3. **Unlock your account**:

   You can unlock your account by running the following command:

   ```bash
   zkusd account unlock your-account-name
   ```

4. **Start the local prover**:

   To create the necessary zk proofs for interacting with the fizk protocol, you will need to run a local prover in a separate terminal session.

   ```bash
   zkusd start-prover
   ```

5. **Create a vault**:

   ```bash
   zkusd vault create
   ```

6. **Deposit collateral**:

   ```bash
   zkusd vault deposit <your-vault-address> -a <amount>
   ```

7. **Mint zkUSD**:
   ```bash
   zkusd vault mint <your-vault-address> -a <amount>
   ```

## Command Reference

### Account Commands

```bash
# Import a Mina account
zkusd account import

# List all accounts
zkusd account list

# Unlock an account
zkusd account unlock <account-name>

# Lock the current account
zkusd account lock

# Show account status
zkusd account status

# Remove an account
zkusd account remove <account-name>
```

### Network Commands

```bash
# Show current network
zkusd network current

# List available networks
zkusd network list

# Switch to a different network
zkusd network use <network>
```

### Vault Commands

```bash
# Create a new vault
zkusd vault create

# List all vaults owned by your account
zkusd vault list

# Show vault details
zkusd vault show <vault-address>

# Deposit MINA to a vault
zkusd vault deposit <vault-address> -a <amount>

# Withdraw MINA from a vault
zkusd vault withdraw <vault-address> -a <amount>

# Mint zkUSD stablecoins
zkusd vault mint <vault-address> -a <amount>

# Repay zkUSD debt
zkusd vault repay <vault-address> -a <amount>

# Liquidate an undercollateralized vault
zkusd vault liquidate <vault-address>

# List vault aliases
zkusd vault alias-list

# Create an alias for a vault
zkusd vault alias-set <vault-address> <alias-name>

# Remove an alias for a vault
zkusd vault alias-remove <alias-name>

# List all vaults in the protocol with a health factor gt or lt than a given value
zkusd vault list-hf <operator> <value>

# List all vaults in the protocol that can be liquidated
zkusd vault list-liquidatable

```

### Prover Commands

```bash
# Start a local prover
zkusd start-prover

# Start with custom port
zkusd start-prover -p 3970
```

### Lightnet Commands

```bash
# Set price for lightnet environment
zkusd lightnet set-price -p 1.25

# Show lightnet configuration
zkusd lightnet show
```

## Environments

- **Lightnet**: Local testing environment with configurable prices
- **Devnet**: Working with the devnet network
- **Mainnet**: Main Mina blockchain network

## Security

- All private keys are stored encrypted in your local keystore
- Passwords are securely stored in your system's keychain
- Session timeouts ensure your account is locked after a period of inactivity

## Support

If you need help, please reach out to us on the [Fizk Discord](https://discord.gg/q6q3EXRPpA).

You can also join our telegram channel [here](https://t.me/fizk_protocol).

## License

[Apache License 2.0](LICENSE)
