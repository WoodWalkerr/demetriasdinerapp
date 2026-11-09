// Optional: create the tables ahead of time.
//   DATABASE_URL=... npm run db:init
import { ensureSchema } from '../lib/db.js';
await ensureSchema();
console.log('Database is ready.');
