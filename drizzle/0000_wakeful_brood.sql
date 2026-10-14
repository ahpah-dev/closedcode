CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`agent` text NOT NULL,
	`project` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_owner_updated_idx` ON `sessions` (`owner_id`,`updated_at`);