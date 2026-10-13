import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const documents=sqliteTable('documents',{id:text('id').primaryKey(),data:text('data').notNull(),updated:text('updated').notNull()});
export const publications=sqliteTable('publications',{key:text('key').primaryKey(),docId:text('doc_id').notNull(),platform:text('platform').notNull(),status:text('status').notNull(),state:text('state').notNull(),error:text('error'),updated:text('updated').notNull()});
export const credentials=sqliteTable('credential_settings',{platform:text('platform').primaryKey(),encrypted:text('encrypted').notNull(),checkedAt:text('checked_at'),lastError:text('last_error')});
export const jobs=sqliteTable('generation_jobs',{docId:text('doc_id').primaryKey(),status:text('status').notNull(),stage:text('stage').notNull(),error:text('error'),updated:text('updated').notNull(),phase:text('phase').notNull().default('research'),research:text('research'),lease:integer('lease').notNull().default(0)});
export const settings=sqliteTable('settings',{key:text('key').primaryKey(),value:text('value').notNull()});
