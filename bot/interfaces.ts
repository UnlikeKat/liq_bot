export interface UserPosition {
    address: string;
    healthFactor: bigint;
    totalCollateralBase: bigint;
    totalDebtBase: bigint;
    availableBorrowsBase: bigint;
    lastUpdate: number;
}

export interface LiquidationTarget {
    user: string;
    collateralAsset: string;
    debtAsset: string;
    debtToCover: bigint;
    expectedProfit: bigint;
    healthFactor: number;
    flashSource?: { source: number, pool?: string, label?: string };
}

export interface ReserveData {
    liquidityIndex: bigint;
    variableBorrowIndex: bigint;
    liquidityRate: bigint;
    variableBorrowRate: bigint;
}
