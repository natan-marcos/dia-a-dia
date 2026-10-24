CREATE TABLE `reference_items` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`revision` integer NOT NULL,
	`summary` text NOT NULL,
	`payload` text NOT NULL,
	`write_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `reference_vaults`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reference_vaults` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`salt` text NOT NULL,
	`iterations` integer NOT NULL,
	`verifier` text NOT NULL,
	`created_at` text NOT NULL
);
