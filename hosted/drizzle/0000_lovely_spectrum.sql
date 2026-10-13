CREATE TABLE `credential_settings` (
	`platform` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`checked_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`doc_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`error` text,
	`updated` text NOT NULL,
	`phase` text DEFAULT 'research' NOT NULL,
	`research` text,
	`lease` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`key` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`platform` text NOT NULL,
	`status` text NOT NULL,
	`state` text NOT NULL,
	`error` text,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
