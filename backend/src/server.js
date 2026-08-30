import app from './app.js';
import { config } from './config/index.js';
import fs from 'fs';
import path from 'path';

const uploadDir = path.resolve(config.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

app.listen(config.port, () => {
  console.log(`ATLAS API running on http://localhost:${config.port}`);
});
