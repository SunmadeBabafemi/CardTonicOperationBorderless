import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateEnv } from '@core/core.env';
import { databaseOptions } from './database.options';

const config = validateEnv(process.env);
export default new DataSource({
  ...databaseOptions(config.DATABASE_URL, config.DATABASE_POOL_MAX),
  migrationsRun: false,
});
