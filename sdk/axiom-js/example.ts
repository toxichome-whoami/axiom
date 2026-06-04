import { Axiom } from './src';

async function run() {
  console.log('Testing Axiom JS SDK...');
  const axiom = new Axiom({
    url: 'http://localhost:4500',
    projectId: 'admin',
    apiKey: 'admin:secret'
  });

  try {
    // Test DB List
    const tables = await axiom.db.select('localdb', 'sqlite_master');
    console.log('Success! Connected to Axiom and fetched tables:', tables.length);
  } catch (err: any) {
    console.error('Failed to connect:', err.message);
  }
}

run();
