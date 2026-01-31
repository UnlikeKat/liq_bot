# Tenderly Fork Testing Setup Guide

## Quick Setup (5 minutes)

### 1. Create Free Tenderly Account
1. Go to https://tenderly.co
2. Click "Sign Up" (it's free)
3. Create your account

### 2. Get Your API Credentials
1. After logging in, click your profile (top right)
2. Go to **Settings** → **Authorization**
3. Click **Generate Access Token**
4. Copy the token

### 3. Get Your Account & Project Info
- **Account Name**: Found in your profile/URL (e.g., `https://dashboard.tenderly.co/YOUR_ACCOUNT`)
- **Project Name**: Create a new project or use existing (default: "project")

###  4. Add to `.env` File
Add these three lines to your `.env`:
```
TENDERLY_ACCESS_KEY=your_access_token_here
TENDERLY_ACCOUNT=your_username_here
TENDERLY_PROJECT=project
```

### 5. Run the Tests
```bash
npx tsx test/tenderly_fork_test.ts
```

## What It Does

1. **Creates Fork**: Spins up an isolated Base mainnet copy at block N-3
2. **Checks HF**: Validates health factor < 1.1 (bot would detect)
3. **Discovers Assets**: Finds best collateral/debt pair
4. **Executes Liquidation**: Submits real transaction to fork
5. **Measures Performance**: Compares bot block vs real liquidation block
6. **Cleans Up**: Deletes fork after test

## Results

Results saved to:
- `test/results/tenderly_fork_results.json` - Full details
- Console output - Real-time progress

## FAQ

**Q: Is Tenderly free?**  
A: Yes! Free tier includes fork simulations.

**Q: How is this different from Hardhat?**  
A: Tenderly is cloud-based (no local setup), works on Windows natively, and has better debugging tools.

**Q: Can I see the transactions?**  
A: Yes! Each fork gets a dashboard URL in Tenderly where you can view transactions.

**Q: How many tests can I run?**  
A: Free tier has generous limits. Start with 5 tests (default), then increase `MAX_TESTS`.

## Troubleshooting

**"TENDERLY_ACCESS_KEY not set"**  
→ Make sure you added the credentials to `.env`

**"Failed to create fork"**  
→ Check your API key is valid and account/project names are correct

**"Asset discovery failed"**  
→ Normal for some tests - trying to discover on old blocks can have state mismatches
