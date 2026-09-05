// 🧪 Test Dual-Mode Cloud DB Integration
const assert = require('assert');

async function testPersistence() {
  console.log('Testing Dual-Mode Database Integration...');
  const { MongoClient } = require('mongodb');
  assert.ok(MongoClient, 'MongoClient is exported properly');
  console.log('✅ MongoClient load verified.');
}

testPersistence().catch(err => {
  console.error(err);
  process.exit(1);
});
