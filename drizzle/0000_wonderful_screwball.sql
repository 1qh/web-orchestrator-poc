CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`parent_run_id` text,
	`mode` text NOT NULL,
	`agent` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`error_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_runs_thread_time_idx` ON `agent_runs` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_idx` ON `agent_runs` (`status`);--> statement-breakpoint
CREATE TABLE `background_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`run_id` text,
	`task_type` text NOT NULL,
	`agent` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`input_json` text NOT NULL,
	`output_json` text,
	`error_text` text,
	`trigger_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `background_tasks_thread_time_idx` ON `background_tasks` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `background_tasks_status_idx` ON `background_tasks` (`status`);--> statement-breakpoint
CREATE TABLE `compactions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`summary` text NOT NULL,
	`compacted_until_message_id` text,
	`token_budget` integer NOT NULL,
	`compacted_token_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compactions_thread_time_idx` ON `compactions` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`plain_text` text NOT NULL,
	`parts_json` text NOT NULL,
	`metadata_json` text,
	`model` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`compacted_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_thread_time_idx` ON `messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_thread_compacted_idx` ON `messages` (`thread_id`,`compacted_at`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`reminder_type` text NOT NULL,
	`status` text NOT NULL,
	`target_background_task_id` text,
	`payload_json` text NOT NULL,
	`trigger_at` integer NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_background_task_id`) REFERENCES `background_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reminders_thread_status_idx` ON `reminders` (`thread_id`,`status`);--> statement-breakpoint
CREATE INDEX `reminders_trigger_at_idx` ON `reminders` (`trigger_at`);--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`step_type` text NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_steps_run_idx` ON `run_steps` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `threads_last_activity_idx` ON `threads` (`last_activity_at`);--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`source_background_task_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_background_task_id`) REFERENCES `background_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `todos_thread_status_idx` ON `todos` (`thread_id`,`status`);--> statement-breakpoint
CREATE TABLE `usage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`run_id` text,
	`model` text NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`total_tokens` integer NOT NULL,
	`reasoning_tokens` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_snapshots_thread_time_idx` ON `usage_snapshots` (`thread_id`,`created_at`);