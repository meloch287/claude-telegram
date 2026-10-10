-- Схема bb 0.45 (только нужные синхронизации таблицы), снята с боевой базы.
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`host_id` text NOT NULL,
	`path` text,
	`is_git_repo` integer DEFAULT false NOT NULL,
	`is_worktree` integer DEFAULT false NOT NULL,
	`branch_name` text,
	`base_branch` text,
	`default_branch` text,
	`merge_base_branch` text,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, `name` text, `environment_provider_id` text, `environment_provider_plugin_id` text, `provider_owns_path` integer DEFAULT false NOT NULL, `environment_provider_selection` text, `environment_provider_instance_key` text, `retire_at` integer, `teardown_attempt` integer DEFAULT 0 NOT NULL, `teardown_status` text, `teardown_message` text, `resource` text, `owner_thread_id` text, `attempt` integer DEFAULT 0 NOT NULL, `status_message` text, `pending_log` text DEFAULT '' NOT NULL, `claim_path` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`destroyed_at` integer,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
, `last_rejected_protocol_version` integer, `connect_machine_id` text, `max_permission_mode` text DEFAULT 'full' NOT NULL, `machine_provider_id` text, `launch_key` text, `machine_inputs` text, `machine_attempt` integer DEFAULT 0 NOT NULL, `pending_log` text DEFAULT '' NOT NULL, `machine_operation_id` text, `server_access_provider_id` text, `server_access_grant_id` text, `resource` text, `phase` text DEFAULT 'active' NOT NULL, `suspended_at` integer, `status_message` text, `suspend_retry_at` integer, `remove_retry_at` integer, `teardown_attempt` integer DEFAULT 0 NOT NULL, `teardown_status` text);
CREATE TABLE `project_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`host_id` text,
	`path` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, `owns_path` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_sources_shape_check" CHECK((
        "project_sources"."type" = 'local_path' AND "project_sources"."host_id" IS NOT NULL AND "project_sources"."path" IS NOT NULL
      ))
);
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
, `sort_key` text DEFAULT 'V' NOT NULL, `kind` text DEFAULT 'standard' NOT NULL, `deleted_at` integer, `git_remote_url` text);
CREATE TABLE "events" (
  `id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `environment_id` text,
  `scope_kind` text NOT NULL,
  `turn_id` text,
  `provider_thread_id` text,
  `sequence` integer NOT NULL,
  `type` text NOT NULL,
  `item_id` text,
  `item_kind` text,
  `data` text DEFAULT '{}' NOT NULL,
  `created_at` integer NOT NULL, `parent_tool_call_id` text,
  FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `events_scope_shape_check` CHECK (
    (
      (`scope_kind` = 'turn' AND `turn_id` IS NOT NULL)
      OR
      (`scope_kind` = 'thread' AND `turn_id` IS NULL)
    )
  )
);
CREATE TABLE "threads" (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text,
	`provider_id` text NOT NULL,
	`model_override` text,
	`reasoning_level_override` text,
	`title` text,
	`title_fallback` text,
	`status` text DEFAULT 'starting' NOT NULL,
	`parent_thread_id` text,
	`archived_at` integer,
	`pinned_at` integer,
	`pin_sort_key` text,
	`deleted_at` integer,
	`last_read_at` integer,
	`latest_attention_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, `source_thread_id` text REFERENCES `threads`(`id`) ON DELETE set null, `origin_kind` text, "section_id" text REFERENCES "thread_sections"(id) ON DELETE SET NULL, `origin_plugin_id` text, `visibility` text DEFAULT 'visible' NOT NULL, "startup_context" text, `storage_deleted_at` integer, `lifecycle_owner_thread_id` text REFERENCES threads(id) ON DELETE RESTRICT,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE "thread_sections" (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `environments_project_idx` ON `environments` (`project_id`);
CREATE INDEX `environments_status_idx` ON `environments` (`status`);
CREATE INDEX `hosts_last_seen_idx` ON `hosts` (`last_seen_at`);
CREATE INDEX `project_sources_project_idx` ON `project_sources` (`project_id`);
CREATE INDEX `project_sources_host_idx` ON `project_sources` (`host_id`);
CREATE UNIQUE INDEX `project_sources_project_host_idx` ON `project_sources` (`project_id`,`host_id`);
CREATE UNIQUE INDEX `project_sources_default_project_idx`
ON `project_sources` (`project_id`)
WHERE `is_default` = 1;
CREATE INDEX `projects_updated_idx` ON `projects` (`updated_at`);
CREATE INDEX `projects_sort_idx` ON `projects` (`sort_key`,`id`);
CREATE UNIQUE INDEX `projects_personal_singleton_idx` ON `projects` (`kind`) WHERE "projects"."kind" = 'personal';
CREATE INDEX `projects_deleted_idx` ON `projects` (`deleted_at`);
CREATE UNIQUE INDEX `events_thread_sequence_idx` ON `events` (`thread_id`,`sequence`);
CREATE INDEX `events_thread_type_item_kind_sequence_idx` ON `events` (`thread_id`,`type`,`item_kind`,`sequence`);
CREATE INDEX `events_thread_type_sequence_idx` ON `events` (`thread_id`,`type`,`sequence`);
CREATE INDEX `events_thread_turn_type_item_sequence_idx` ON `events` (`thread_id`,`turn_id`,`type`,`item_id`,`sequence`);
CREATE INDEX `events_environment_idx` ON `events` (`environment_id`);
CREATE INDEX `events_completed_item_truncation_idx` ON `events` (`item_kind`,`created_at`,`id`) WHERE `type` = 'item/completed';
CREATE INDEX `threads_project_updated_idx` ON `threads` (`project_id`,`updated_at`);
CREATE INDEX `threads_project_archived_deleted_idx` ON `threads` (`project_id`,`archived_at`,`deleted_at`,`id`);
CREATE INDEX `threads_pin_sort_idx` ON `threads` (`archived_at`,`deleted_at`,`pin_sort_key`,`id`) WHERE "threads"."pinned_at" IS NOT NULL;
CREATE INDEX `threads_environment_idx` ON `threads` (`environment_id`);
CREATE INDEX `threads_parent_idx` ON `threads` (`parent_thread_id`);
CREATE INDEX `threads_archived_status_idx` ON `threads` (`archived_at`,`status`);
CREATE INDEX `threads_environment_archived_deleted_idx` ON `threads` (`environment_id`,`archived_at`,`deleted_at`);
CREATE INDEX `threads_active_maintenance_idx` ON `threads` (`status`) WHERE "threads"."deleted_at" IS NULL;
CREATE INDEX `threads_source_origin_idx` ON `threads` (`source_thread_id`, `origin_kind`);
CREATE UNIQUE INDEX `thread_sections_name_idx` ON `thread_sections` (`name`);
CREATE INDEX `threads_section_archived_deleted_idx` ON `threads` (`section_id`,`archived_at`,`deleted_at`,`id`);
CREATE INDEX `threads_origin_plugin_archived_idx` ON `threads` (`origin_plugin_id`,`archived_at`);
CREATE UNIQUE INDEX `environments_project_host_path_idx` ON `environments` (`project_id`,`host_id`,`path`);
CREATE INDEX `environments_host_path_lookup_idx` ON `environments` (`host_id`,`path`);
CREATE INDEX `events_background_task_thread_type_item_sequence_idx` ON `events` (`thread_id`,`type`,`item_id`,`sequence`) WHERE "events"."item_kind" = 'backgroundTask';
CREATE INDEX `events_item_lifecycle_thread_item_sequence_idx` ON `events` (`thread_id`,`item_id`,`sequence`) WHERE "events"."type" IN ('item/started', 'item/completed', 'item/backgroundTask/completed');
CREATE INDEX `events_parent_tool_call_thread_parent_sequence_idx` ON `events` (`thread_id`,`parent_tool_call_id`,`sequence`) WHERE "events"."parent_tool_call_id" IS NOT NULL;
CREATE INDEX `events_thread_state_thread_sequence_idx` ON `events` (`thread_id`,`sequence`) WHERE "events"."type" IN ('thread/goal/updated', 'thread/goal/cleared', 'thread/extensionState/updated');
CREATE INDEX `events_delegating_item_lookup_idx` ON `events` (`thread_id`,`item_id`,`sequence`,`item_kind`) WHERE "events"."item_kind" IN ('toolCall', 'delegation');
CREATE INDEX `events_plan_steps_thread_sequence_idx` ON `events` (`thread_id`,`sequence`) WHERE ("events"."item_kind" = 'planSteps' AND "events"."type" = 'item/completed') OR "events"."type" = 'turn/plan/updated';
CREATE INDEX `environments_provider_instance_idx` ON `environments` (`environment_provider_id`,`environment_provider_instance_key`);
CREATE INDEX `environments_claim_idx` ON `environments` (`host_id`,`claim_path`);
CREATE UNIQUE INDEX `hosts_live_launch_key_idx` ON `hosts` (`launch_key`) WHERE "hosts"."destroyed_at" is null;
CREATE INDEX `threads_lifecycle_owner_idx` ON `threads` (`lifecycle_owner_thread_id`);
CREATE INDEX `threads_project_id_idx` ON `threads` (`project_id`,`id`);
CREATE INDEX `events_provider_identity_idx` ON `events` (`provider_thread_id`,`created_at`) WHERE "events"."type" = 'thread/identity';
CREATE INDEX `environments_provider_lifecycle_idx` ON `environments` (`environment_provider_id`) WHERE "environments"."status" <> 'destroyed' OR "environments"."teardown_status" IS NOT 'removed';
CREATE UNIQUE INDEX `environments_owner_thread_idx` ON `environments` (`owner_thread_id`) WHERE "environments"."owner_thread_id" IS NOT NULL;
