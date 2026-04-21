/**
 * Database definition — creates the DB instance and exports it.
 * DB() auto-registers on the app. Entities register on this db instance.
 */
import { DB } from '../../src';

export const db = DB({
  type: 'sqlite',
  database: ':memory:',
  filename: ':memory:'
});
