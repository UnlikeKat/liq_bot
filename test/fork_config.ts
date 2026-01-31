import { config } from 'dotenv';

config();

// Minimalist config for fork testing - no side effects
export const FORK_TEST_CONFIG = {
    RPC_URL_PREMIUM: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    AAVE_POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    AAVE_DATA_PROVIDER: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac',
    FLASH_LIQUIDATOR: process.env.FLASH_LIQUIDATOR_ADDRESS || '0x45bca5dc943501124060762efC143BAb0647f3E5',
    DISCOVERY_THRESHOLD: 1.1,
    LIQUIDATION_THRESHOLD: 1.0,
};
