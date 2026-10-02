import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './database.module';

/** Standalone data source used by the TypeORM CLI for migrations. */
export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number.parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER ?? 'vpsguard',
  password: process.env.POSTGRES_PASSWORD ?? 'vpsguard',
  database: process.env.POSTGRES_DB ?? 'vpsguard',
  entities: ENTITIES,
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
