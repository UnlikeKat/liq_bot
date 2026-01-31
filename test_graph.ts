const URLS = [
    'https://gateway.thegraph.com/api/deploy_key/subgraphs/id/GQFbb9-bRyXqF',
    'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base',
    'https://api.studio.thegraph.com/query/48427/aave-v3-base/version/latest',
];

const QUERY = JSON.stringify({
    query: `{
        liquidationCalls(first: 1) {
            id
        }
    }`
});

const MESSARI_QUERY = JSON.stringify({
    query: `{
        liquidations(first: 1) {
            id
        }
    }`
});

async function test() {
    for (const url of URLS) {
        process.stdout.write(`Testing ${url}... `);
        try {
            // Try standard query
            let res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: QUERY
            });
            let json = await res.json();

            if (json.data && json.data.liquidationCalls) {
                console.log(`✅ SUCCESS (Standard)!`);
                console.log(`   Use this URL: ${url}`);
                console.log(`   Result: ${JSON.stringify(json.data.liquidationCalls)}`);
                process.exit(0);
            }

            // Try Messari query
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: MESSARI_QUERY
            });
            json = await res.json();

            if (json.data && json.data.liquidations) {
                console.log(`✅ SUCCESS (Messari)!`);
                console.log(`   Use this URL: ${url}`);
                console.log(`   Result: ${JSON.stringify(json.data.liquidations)}`);
                process.exit(0);
            }

            console.log(`❌ Invalid Schema.`);
        } catch (e: any) {
            console.log(`❌ Failed: ${e.message}`);
        }
    }
    console.log('😭 All endpoints failed.');
}

test();
