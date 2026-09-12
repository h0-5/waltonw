const axios = require('axios');

const RAILWAY_TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID;

async function redeploy() {
  try {
    console.log(`[${new Date().toISOString()}] Triggering redeploy...`);
    
    const response = await axios.post(
      'https://backboard.railway.app/graphql/v2',
      {
        query: `mutation { projectTokenDeploy(input: { projectId: "${PROJECT_ID}" }) { id } }`
      },
      {
        headers: {
          'Authorization': `Bearer ${RAILWAY_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Redeploy triggered:', response.data);
  } catch (err) {
    console.error('❌ Redeploy failed:', err.message);
  }
}

// Run every 5 minutes
console.log('🔄 Auto-refresh started (every 5 minutes)');
redeploy();
setInterval(redeploy, 5 * 60 * 1000);
