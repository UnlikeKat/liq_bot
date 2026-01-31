// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";

contract CheckCode is Test {
    function testCheckCode() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));
        console.log("Block Number:", block.number);
        
        string[] memory labels = new string[](6);
        labels[0] = "SR02-Custom";
        labels[1] = "SR02-Search";
        labels[2] = "UR-V1";
        labels[3] = "UR-V2";
        labels[4] = "SR01";
        labels[5] = "USDC";

        string[] memory addrStrings = new string[](6);
        addrStrings[0] = "0x2626664c2616e668e2f2666f84d63503fea21741e481";
        addrStrings[1] = "0x2626664c2603336e57b271c5c0b26f421741e481";
        addrStrings[2] = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
        addrStrings[3] = "0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC";
        addrStrings[4] = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
        addrStrings[5] = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

        for (uint i = 0; i < addrStrings.length; i++) {
            try this.parseAndLog(labels[i], addrStrings[i]) {} catch {
                console.log(labels[i], "FAILED PARSE");
            }
        }
        
        console.log("Pool Length:", address(0x7279c08A36333e12c3Fc81747963264c100D66fB).code.length);
        console.log("Vault Length:", address(0xBA12222222228d8Ba445958a75a0704d566BF2C8).code.length);
        console.log("WETH Length:", address(0x4200000000000000000000000000000000000006).code.length);
    }

    function testUniversalSwap() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));
        
        address router = 0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC;
        address weth = 0x4200000000000000000000000000000000000006;
        address usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        
        deal(weth, address(this), 1 ether);
        
        // Transfer tokens to Router first (Bypasses Permit2 pull)
        IERC20(weth).transfer(router, 1 ether);
        
        // Universal Router V3_SWAP_EXACT_IN (0x00)
        // input: recipient, amountIn, amountOutMin, path, payerIsUser
        bytes memory path = abi.encodePacked(weth, uint24(500), usdc);
        bytes memory commands = hex"00";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(this), 1 ether, 0, path, false); // payerIsUser = false
        
        console.log("Attempting WETH -> USDC swap via UR (Direct Transfer, No Permit2)...");
        try IUniversalRouter(router).execute(commands, inputs, block.timestamp) {
            console.log("Swap Success via UR (Direct)!");
            console.log("USDC Received:", IERC20(usdc).balanceOf(address(this)));
        } catch Error(string memory reason) {
            console.log("UR Direct Failed. Reason:", reason);
        } catch (bytes memory raw) {
            console.log("UR Direct Failed (Raw). Length:", raw.length);
            console.logBytes(raw);
        }
    }

    function parseAndLog(string memory label, string memory addrStr) public {
        address a = vm.parseAddress(addrStr);
        console.log(label, "Length:", a.code.length);
    }
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

