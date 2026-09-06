const app = require('./app');
const runMigrate = require('./scripts/migrate');
const PORT = process.env.PORT || 3000;

runMigrate().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  Walton Family Server running on http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('❌ Migration failed, server not started:', err.message);
  process.exit(1);
});
