/** @type import('hardhat/config').HardhatUserConfig */
export default {
    solidity: {
        compilers: [
            { version: "0.8.19" },
            { version: "0.8.20" },
            { version: "0.8.24" }
        ]
    },
    paths: {
        sources: "./src",
        artifacts: "./artifacts"
    }
};
