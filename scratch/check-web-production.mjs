import https from 'node:https';

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    }).on('error', reject);
  });
}

async function checkWeb() {
  console.log('--- CHECKING https://la-taba.pages.dev/runtime-config.js ---');
  const rcRes = await fetchText('https://la-taba.pages.dev/runtime-config.js');
  console.log(`Status: ${rcRes.status}`);
  console.log(`Content length: ${rcRes.body.length}`);
  console.log(`Body preview:\n${rcRes.body.slice(0, 500)}`);

  const hasProductionRef = rcRes.body.includes('wwcpogltfgzgkrlilbcd');
  const hasStagingRef = rcRes.body.includes('ukxqbgswjlibmnjemrzd') || rcRes.body.includes('ucbtjcurawxjwjdvvcvj');

  console.log(`Contains production ref (wwcpogltfgzgkrlilbcd): ${hasProductionRef}`);
  console.log(`Contains staging ref (ukxqbgswjlibmnjemrzd / ucbtjcurawxjwjdvvcvj): ${hasStagingRef}`);

  console.log('\n--- CHECKING https://la-taba.pages.dev/ ---');
  const homeRes = await fetchText('https://la-taba.pages.dev/');
  console.log(`Status: ${homeRes.status}`);
  console.log(`Home content length: ${homeRes.body.length}`);

  const hasStagingInHome = homeRes.body.includes('ukxqbgswjlibmnjemrzd') || homeRes.body.includes('ucbtjcurawxjwjdvvcvj');
  console.log(`Staging references in index.html: ${hasStagingInHome}`);
}

checkWeb().catch(err => {
  console.error('Web check failed:', err);
  process.exit(1);
});
