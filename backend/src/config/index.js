import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 5001,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  metaAutomation: {
    webAppUrl: process.env.META_AUTOMATION_WEBAPP_URL,
    apiKey: process.env.META_AUTOMATION_API_KEY,
  },
};
