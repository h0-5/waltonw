const { execSync } = require('child_process');

const CHECK_INTERVAL = 60 * 1000; // 1 minute

async function checkAndUpdate() {
  try {
    console.log(`[${new Date().toISOString()}] Checking for updates...`);
    
    execSync('git fetch origin main', { stdio: 'pipe' });
    
    const local = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const remote = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
    
    if (local !== remote) {
      console.log(`[${new Date().toISOString()}] New update found! Pulling...`);
      execSync('git pull origin main', { stdio: 'pipe' });
      console.log(`[${new Date().toISOString()}] Update pulled. Restarting...`);
      process.exit(0);
    } else {
      console.log(`[${new Date().toISOString()}] No updates found.`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
  }
}

console.log('🔄 Auto-updater started (checks every 1 minute)');
checkAndUpdate();
setInterval(checkAndUpdate, CHECK_INTERVAL);
