# Foundry Installation Guide for Windows

## Recommended: WSL (Windows Subsystem for Linux)

Foundry works best on Linux/WSL. This is the most reliable method for Windows users.

### Step 1: Install WSL
```powershell
# Run in PowerShell as Administrator
wsl --install
```

**Restart your computer** after installation.

### Step 2: Open WSL Terminal
```powershell
# Launch Ubuntu
wsl
```

### Step 3: Install Foundry in WSL
```bash
# Download and install Foundry
curl -L https://foundry.paradigm.xyz | bash

# Restart your terminal or run:
source ~/.bashrc

# Install Foundry tools
foundryup
```

### Step 4: Verify Installation
```bash
anvil --version
forge --version
cast --version
```

You should see version numbers for all three tools.

## Alternative: Windows Native (Experimental)

If you cannot use WSL, try the Windows native build:

```powershell
# Download foundryup for Windows
# Note: This is less stable than WSL
iwr -useb https://raw.githubusercontent.com/foundry-rs/foundry/master/foundryup/install | iex
```

## After Installation

### Test Anvil
```bash
# Start a local fork of Base mainnet
anvil --fork-url YOUR_RPC_URL --fork-block-number 41000000
```

You should see output like:
```
Available Accounts
==================
(0) 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000.000000000000000000 ETH)
...

Listening on 127.0.0.1:8545
```

Press `Ctrl+C` to stop Anvil.

## Troubleshooting

### WSL Not Working
- Ensure Virtualization is enabled in BIOS
- Update Windows to latest version (WSL requires Windows 10 version 2004+)
- Run: `wsl --update`

### Permission Denied
```bash
chmod +x ~/.foundry/bin/*
```

### Path Not Found
Add to `~/.bashrc`:
```bash
export PATH="$HOME/.foundry/bin:$PATH"
```

Then restart terminal or run: `source ~/.bashrc`

## Next Steps

Once Foundry is installed:
1. Navigate to your project directory in WSL:
   ```bash
   cd /mnt/c/Users/Power/Desktop/celo/aave-liquidation-forensics
   ```

2. Install Node.js dependencies (if in WSL):
   ```bash
   npm install
   ```

3. Run the fork tests:
   ```bash
   npx tsx test/fork_test.ts
   ```

## Important Notes

- **RPC URL:** You'll need your BASE_RPC_URL in the WSL environment
- **Private Key:** Make sure your `.env` file is accessible in WSL
- **File Paths:** WSL can access Windows files via `/mnt/c/...`
