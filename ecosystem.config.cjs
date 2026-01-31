module.exports = {
    apps: [{
        name: "liquidation-bot",
        script: "bot/index.ts",
        interpreter: "./node_modules/.bin/tsx",
        args: "--no-gui", // Monitor mode for server
        autorestart: true,
        watch: false,
    }, {
        name: "liquidation-ui",
        cwd: "./ui",
        script: "npm",
        args: "run dev",
        autorestart: true,
        watch: false,
    }]
};
