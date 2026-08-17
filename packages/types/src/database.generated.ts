/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced from infra/migrations/ by infra/scripts/generate-db-types.mjs.
 * Regenerate with `pnpm db:types`; CI fails if this file is stale.
 *
 * `Row` is what a SELECT returns. `Insert` marks nullable and defaulted columns
 * optional. `Update` makes everything optional, matching a PATCH.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/** `public.ai_characters` */
export interface AiCharactersRow {
  id: string;
  slug: string;
  display_name: string;
  tagline: string;
  description: string;
  prompt_version: string;
  allowed_age_groups: string[];
  voice_id: string | null;
  avatar_key: string | null;
  status: 'active' | 'beta' | 'retired';
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AiCharactersInsert {
  id?: string;
  slug: string;
  display_name: string;
  tagline: string;
  description?: string;
  prompt_version: string;
  allowed_age_groups?: string[];
  voice_id?: string | null;
  avatar_key?: string | null;
  status?: 'active' | 'beta' | 'retired';
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export type AiCharactersUpdate = Partial<AiCharactersInsert>;

/** `public.analytics_events` */
export interface AnalyticsEventsRow {
  id: string;
  parent_id: string | null;
  child_id: string | null;
  parent_ref: string;
  child_ref: string | null;
  event_name: string;
  properties: Json;
  app_version: string | null;
  platform: 'ios' | 'android' | 'web' | null;
  occurred_at: string;
  created_at: string;
}

export interface AnalyticsEventsInsert {
  id?: string;
  parent_id?: string | null;
  child_id?: string | null;
  parent_ref: string;
  child_ref?: string | null;
  event_name: string;
  properties?: Json;
  app_version?: string | null;
  platform?: 'ios' | 'android' | 'web' | null;
  occurred_at?: string;
  created_at?: string;
}

export type AnalyticsEventsUpdate = Partial<AnalyticsEventsInsert>;

/** `public.audit_logs` */
export interface AuditLogsRow {
  id: string;
  actor_id: string | null;
  actor_type: 'parent' | 'child_session' | 'system' | 'operator' | 'service_role';
  action: string;
  resource_type: string;
  resource_id: string | null;
  subject_child_id: string | null;
  outcome: 'success' | 'denied' | 'error';
  justification: string | null;
  request_id: string | null;
  source_ip: string | null;
  user_agent: string | null;
  metadata: Json;
  occurred_at: string;
  created_at: string;
}

export interface AuditLogsInsert {
  id?: string;
  actor_id?: string | null;
  actor_type: 'parent' | 'child_session' | 'system' | 'operator' | 'service_role';
  action: string;
  resource_type: string;
  resource_id?: string | null;
  subject_child_id?: string | null;
  outcome: 'success' | 'denied' | 'error';
  justification?: string | null;
  request_id?: string | null;
  source_ip?: string | null;
  user_agent?: string | null;
  metadata?: Json;
  occurred_at?: string;
  created_at?: string;
}

export type AuditLogsUpdate = Partial<AuditLogsInsert>;

/** `public.character_languages` */
export interface CharacterLanguagesRow {
  character_id: string;
  language_code: string;
  voice_id: string | null;
  created_at: string;
}

export interface CharacterLanguagesInsert {
  character_id: string;
  language_code: string;
  voice_id?: string | null;
  created_at?: string;
}

export type CharacterLanguagesUpdate = Partial<CharacterLanguagesInsert>;

/** `public.child_languages` */
export interface ChildLanguagesRow {
  child_id: string;
  language_code: string;
  is_primary: boolean;
  proficiency: 'learning' | 'conversational' | 'fluent' | 'native';
  created_at: string;
  updated_at: string;
}

export interface ChildLanguagesInsert {
  child_id: string;
  language_code: string;
  is_primary?: boolean;
  proficiency?: 'learning' | 'conversational' | 'fluent' | 'native';
  created_at?: string;
  updated_at?: string;
}

export type ChildLanguagesUpdate = Partial<ChildLanguagesInsert>;

/** `public.child_learning_preferences` */
export interface ChildLearningPreferencesRow {
  child_id: string;
  session_length: 'short' | 'medium' | 'long';
  storytelling_enabled: boolean;
  roleplay_enabled: boolean;
  pronunciation_practice: boolean;
  correction_style: 'none' | 'gentle' | 'active';
  created_at: string;
  updated_at: string;
}

export interface ChildLearningPreferencesInsert {
  child_id: string;
  session_length?: 'short' | 'medium' | 'long';
  storytelling_enabled?: boolean;
  roleplay_enabled?: boolean;
  pronunciation_practice?: boolean;
  correction_style?: 'none' | 'gentle' | 'active';
  created_at?: string;
  updated_at?: string;
}

export type ChildLearningPreferencesUpdate = Partial<ChildLearningPreferencesInsert>;

/** `public.child_learning_topics` */
export interface ChildLearningTopicsRow {
  child_id: string;
  topic_key: string;
  created_at: string;
}

export interface ChildLearningTopicsInsert {
  child_id: string;
  topic_key: string;
  created_at?: string;
}

export type ChildLearningTopicsUpdate = Partial<ChildLearningTopicsInsert>;

/** `public.children` */
export interface ChildrenRow {
  id: string;
  parent_id: string;
  display_name: string;
  birth_year: number;
  birth_month: number;
  avatar_key: string | null;
  status: 'active' | 'paused' | 'archived';
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  preferred_character_id: string | null;
  archived_at: string | null;
}

export interface ChildrenInsert {
  id?: string;
  parent_id: string;
  display_name: string;
  birth_year: number;
  birth_month: number;
  avatar_key?: string | null;
  status?: 'active' | 'paused' | 'archived';
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
  preferred_character_id?: string | null;
  archived_at?: string | null;
}

export type ChildrenUpdate = Partial<ChildrenInsert>;

/** `public.consent_records` */
export interface ConsentRecordsRow {
  id: string;
  parent_id: string;
  child_id: string | null;
  consent_type: 'terms_of_service' | 'privacy_policy' | 'child_data_processing' | 'transcript_retention' | 'audio_retention' | 'product_analytics' | 'model_improvement' | 'marketing_email';
  granted: boolean;
  policy_version: string;
  policy_text_hash: string;
  source_ip: string | null;
  user_agent: string | null;
  recorded_at: string;
  created_at: string;
}

export interface ConsentRecordsInsert {
  id?: string;
  parent_id: string;
  child_id?: string | null;
  consent_type: 'terms_of_service' | 'privacy_policy' | 'child_data_processing' | 'transcript_retention' | 'audio_retention' | 'product_analytics' | 'model_improvement' | 'marketing_email';
  granted: boolean;
  policy_version: string;
  policy_text_hash: string;
  source_ip?: string | null;
  user_agent?: string | null;
  recorded_at?: string;
  created_at?: string;
}

export type ConsentRecordsUpdate = Partial<ConsentRecordsInsert>;

/** `public.consent_requirements` */
export interface ConsentRequirementsRow {
  id: string;
  consent_type: 'terms_of_service' | 'privacy_policy' | 'child_data_processing' | 'transcript_retention' | 'audio_retention' | 'product_analytics' | 'model_improvement' | 'marketing_email';
  scope: 'account' | 'child';
  jurisdiction: string;
  min_policy_version: string;
  blocks_conversation: boolean;
  effective_from: string;
  effective_until: string | null;
  rationale: string;
  created_at: string;
  updated_at: string;
}

export interface ConsentRequirementsInsert {
  id?: string;
  consent_type: 'terms_of_service' | 'privacy_policy' | 'child_data_processing' | 'transcript_retention' | 'audio_retention' | 'product_analytics' | 'model_improvement' | 'marketing_email';
  scope: 'account' | 'child';
  jurisdiction?: string;
  min_policy_version: string;
  blocks_conversation?: boolean;
  effective_from?: string;
  effective_until?: string | null;
  rationale: string;
  created_at?: string;
  updated_at?: string;
}

export type ConsentRequirementsUpdate = Partial<ConsentRequirementsInsert>;

/** `public.content_flags` */
export interface ContentFlagsRow {
  id: string;
  child_id: string;
  message_id: string | null;
  conversation_id: string | null;
  layer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  decision: 'allowed' | 'redirected' | 'blocked' | 'escalated';
  categories: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number | null;
  status: 'pending' | 'reviewed' | 'dismissed' | 'escalated';
  reviewed_at: string | null;
  reviewer_ref: string | null;
  parent_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentFlagsInsert {
  id?: string;
  child_id: string;
  message_id?: string | null;
  conversation_id?: string | null;
  layer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  decision: 'allowed' | 'redirected' | 'blocked' | 'escalated';
  categories?: string[];
  severity?: 'low' | 'medium' | 'high' | 'critical';
  confidence?: number | null;
  status?: 'pending' | 'reviewed' | 'dismissed' | 'escalated';
  reviewed_at?: string | null;
  reviewer_ref?: string | null;
  parent_notified_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ContentFlagsUpdate = Partial<ContentFlagsInsert>;

/** `public.conversations` */
export interface ConversationsRow {
  id: string;
  child_id: string;
  character_id: string;
  language_code: string;
  status: 'active' | 'ended' | 'flagged';
  message_count: number;
  total_cost_usd: string;
  started_at: string;
  ended_at: string | null;
  end_reason: 'child_ended' | 'timeout' | 'quota_exhausted' | 'parent_ended' | 'safety_ended' | 'error' | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationsInsert {
  id?: string;
  child_id: string;
  character_id: string;
  language_code?: string;
  status?: 'active' | 'ended' | 'flagged';
  message_count?: number;
  total_cost_usd?: string;
  started_at?: string;
  ended_at?: string | null;
  end_reason?: 'child_ended' | 'timeout' | 'quota_exhausted' | 'parent_ended' | 'safety_ended' | 'error' | null;
  created_at?: string;
  updated_at?: string;
}

export type ConversationsUpdate = Partial<ConversationsInsert>;

/** `public.current_consents` (view) */
export interface CurrentConsentsRow {
  parent_id: string | null;
  child_id: string | null;
  consent_type: string | null;
  granted: boolean | null;
  policy_version: string | null;
  recorded_at: string | null;
}

/** `public.email_verifications` */
export interface EmailVerificationsRow {
  id: string;
  parent_id: string;
  token_hash: string;
  email: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface EmailVerificationsInsert {
  id?: string;
  parent_id: string;
  token_hash: string;
  email: string;
  expires_at: string;
  consumed_at?: string | null;
  created_at?: string;
}

export type EmailVerificationsUpdate = Partial<EmailVerificationsInsert>;

/** `public.learning_events` */
export interface LearningEventsRow {
  id: string;
  child_id: string;
  event_type: 'skill_exposed' | 'skill_practised' | 'skill_succeeded' | 'word_encountered' | 'story_completed' | 'session_completed';
  skill_key: string | null;
  conversation_id: string | null;
  speech_practice_id: string | null;
  payload: Json;
  occurred_at: string;
  created_at: string;
}

export interface LearningEventsInsert {
  id?: string;
  child_id: string;
  event_type: 'skill_exposed' | 'skill_practised' | 'skill_succeeded' | 'word_encountered' | 'story_completed' | 'session_completed';
  skill_key?: string | null;
  conversation_id?: string | null;
  speech_practice_id?: string | null;
  payload?: Json;
  occurred_at?: string;
  created_at?: string;
}

export type LearningEventsUpdate = Partial<LearningEventsInsert>;

/** `public.learning_progress` */
export interface LearningProgressRow {
  id: string;
  child_id: string;
  skill_key: string;
  exposure_count: number;
  success_count: number;
  first_observed_at: string;
  last_observed_at: string;
  created_at: string;
  updated_at: string;
}

export interface LearningProgressInsert {
  id?: string;
  child_id: string;
  skill_key: string;
  exposure_count?: number;
  success_count?: number;
  first_observed_at?: string;
  last_observed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export type LearningProgressUpdate = Partial<LearningProgressInsert>;

/** `public.learning_topics` */
export interface LearningTopicsRow {
  key: string;
  display_name: string;
  description: string;
  age_groups: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LearningTopicsInsert {
  key: string;
  display_name: string;
  description?: string;
  age_groups?: string[];
  sort_order?: number;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type LearningTopicsUpdate = Partial<LearningTopicsInsert>;

/** `public.login_attempts` */
export interface LoginAttemptsRow {
  id: string;
  email_hash: string;
  ip_address: string | null;
  succeeded: boolean;
  user_agent: string | null;
  attempted_at: string;
  created_at: string;
}

export interface LoginAttemptsInsert {
  id?: string;
  email_hash: string;
  ip_address?: string | null;
  succeeded: boolean;
  user_agent?: string | null;
  attempted_at?: string;
  created_at?: string;
}

export type LoginAttemptsUpdate = Partial<LoginAttemptsInsert>;

/** `public.messages` */
export interface MessagesRow {
  id: string;
  conversation_id: string;
  child_id: string;
  role: 'child' | 'companion';
  sequence: number;
  status: 'delivered' | 'blocked' | 'redacted';
  content_ciphertext: Uint8Array;
  content_key_id: string;
  content_length: number;
  stt_confidence: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  latency_ms: number | null;
  created_at: string;
}

export interface MessagesInsert {
  id?: string;
  conversation_id: string;
  child_id: string;
  role: 'child' | 'companion';
  sequence: number;
  status?: 'delivered' | 'blocked' | 'redacted';
  content_ciphertext: Uint8Array;
  content_key_id: string;
  content_length?: number;
  stt_confidence?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: string | null;
  latency_ms?: number | null;
  created_at?: string;
}

export type MessagesUpdate = Partial<MessagesInsert>;

/** `public.notifications` */
export interface NotificationsRow {
  id: string;
  parent_id: string;
  child_id: string | null;
  kind: 'safety_flag' | 'safety_escalation' | 'daily_summary' | 'weekly_summary' | 'quota_reached' | 'subscription_renewed' | 'subscription_failed' | 'data_export_ready' | 'account_deletion_scheduled' | 'security_alert';
  channel: 'in_app' | 'email' | 'push';
  title: string;
  body: string;
  resource_type: string | null;
  resource_id: string | null;
  status: 'pending' | 'sent' | 'read' | 'dismissed' | 'failed';
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationsInsert {
  id?: string;
  parent_id: string;
  child_id?: string | null;
  kind: 'safety_flag' | 'safety_escalation' | 'daily_summary' | 'weekly_summary' | 'quota_reached' | 'subscription_renewed' | 'subscription_failed' | 'data_export_ready' | 'account_deletion_scheduled' | 'security_alert';
  channel?: 'in_app' | 'email' | 'push';
  title: string;
  body: string;
  resource_type?: string | null;
  resource_id?: string | null;
  status?: 'pending' | 'sent' | 'read' | 'dismissed' | 'failed';
  sent_at?: string | null;
  read_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type NotificationsUpdate = Partial<NotificationsInsert>;

/** `public.parental_controls` */
export interface ParentalControlsRow {
  id: string;
  child_id: string;
  daily_minute_limit: number;
  session_minute_limit: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  allowed_character_ids: string[];
  blocked_topics: string[];
  language_lock: string | null;
  transcript_retention_days: number;
  notify_on_safety_flag: boolean;
  notify_on_daily_summary: boolean;
  is_paused: boolean;
  created_at: string;
  updated_at: string;
}

export interface ParentalControlsInsert {
  id?: string;
  child_id: string;
  daily_minute_limit?: number;
  session_minute_limit?: number;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  allowed_character_ids?: string[];
  blocked_topics?: string[];
  language_lock?: string | null;
  transcript_retention_days?: number;
  notify_on_safety_flag?: boolean;
  notify_on_daily_summary?: boolean;
  is_paused?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type ParentalControlsUpdate = Partial<ParentalControlsInsert>;

/** `public.parents` */
export interface ParentsRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  country_code: string;
  locale: string;
  timezone: string;
  status: 'active' | 'suspended' | 'pending_deletion';
  parent_gate_mode: 'arithmetic' | 'device_biometric' | 'pin';
  marketing_opt_in: boolean;
  last_seen_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  role: 'parent' | 'admin' | 'support';
  email_verified_at: string | null;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
}

export interface ParentsInsert {
  id: string;
  email: string;
  password_hash?: string | null;
  display_name?: string | null;
  country_code?: string;
  locale?: string;
  timezone?: string;
  status?: 'active' | 'suspended' | 'pending_deletion';
  parent_gate_mode?: 'arithmetic' | 'device_biometric' | 'pin';
  marketing_opt_in?: boolean;
  last_seen_at?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
  role?: 'parent' | 'admin' | 'support';
  email_verified_at?: string | null;
  last_login_at?: string | null;
  failed_login_count?: number;
  locked_until?: string | null;
}

export type ParentsUpdate = Partial<ParentsInsert>;

/** `public.password_resets` */
export interface PasswordResetsRow {
  id: string;
  parent_id: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  requested_ip: string | null;
  created_at: string;
}

export interface PasswordResetsInsert {
  id?: string;
  parent_id: string;
  token_hash: string;
  expires_at: string;
  consumed_at?: string | null;
  requested_ip?: string | null;
  created_at?: string;
}

export type PasswordResetsUpdate = Partial<PasswordResetsInsert>;

/** `public.payment_events` */
export interface PaymentEventsRow {
  id: string;
  rail: 'stripe' | 'jazzcash' | 'easypaisa' | 'apple_iap' | 'google_play' | 'mock';
  external_event_id: string;
  event_type: string;
  signature_verified: boolean;
  processing_status: 'pending' | 'processed' | 'ignored' | 'failed';
  processing_error: string | null;
  payload: Json;
  subscription_id: string | null;
  parent_id: string | null;
  received_at: string;
  processed_at: string | null;
  created_at: string;
}

export interface PaymentEventsInsert {
  id?: string;
  rail: 'stripe' | 'jazzcash' | 'easypaisa' | 'apple_iap' | 'google_play' | 'mock';
  external_event_id: string;
  event_type: string;
  signature_verified: boolean;
  processing_status?: 'pending' | 'processed' | 'ignored' | 'failed';
  processing_error?: string | null;
  payload?: Json;
  subscription_id?: string | null;
  parent_id?: string | null;
  received_at?: string;
  processed_at?: string | null;
  created_at?: string;
}

export type PaymentEventsUpdate = Partial<PaymentEventsInsert>;

/** `public.pronunciation_results` */
export interface PronunciationResultsRow {
  id: string;
  speech_practice_id: string;
  child_id: string;
  target_text: string;
  sequence: number;
  attempt_number: number;
  overall_score: number;
  phoneme_scores: Json;
  is_correct: boolean;
  duration_ms: number | null;
  created_at: string;
}

export interface PronunciationResultsInsert {
  id?: string;
  speech_practice_id: string;
  child_id: string;
  target_text: string;
  sequence: number;
  attempt_number?: number;
  overall_score: number;
  phoneme_scores?: Json;
  is_correct?: boolean;
  duration_ms?: number | null;
  created_at?: string;
}

export type PronunciationResultsUpdate = Partial<PronunciationResultsInsert>;

/** `public.sessions` */
export interface SessionsRow {
  id: string;
  parent_id: string;
  family_id: string;
  refresh_token_hash: string;
  device_label: string | null;
  user_agent: string | null;
  ip_address: string | null;
  issued_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_reason: 'logout' | 'rotated' | 'reuse_detected' | 'password_changed' | 'account_deleted' | 'expired' | 'admin_revoked' | null;
  replaced_by: string | null;
  created_at: string;
}

export interface SessionsInsert {
  id?: string;
  parent_id: string;
  family_id: string;
  refresh_token_hash: string;
  device_label?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
  issued_at?: string;
  expires_at: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
  revoked_reason?: 'logout' | 'rotated' | 'reuse_detected' | 'password_changed' | 'account_deleted' | 'expired' | 'admin_revoked' | null;
  replaced_by?: string | null;
  created_at?: string;
}

export type SessionsUpdate = Partial<SessionsInsert>;

/** `public.speech_practice` */
export interface SpeechPracticeRow {
  id: string;
  child_id: string;
  language_code: string;
  exercise_key: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  attempt_count: number;
  average_score: number | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpeechPracticeInsert {
  id?: string;
  child_id: string;
  language_code?: string;
  exercise_key: string;
  status?: 'in_progress' | 'completed' | 'abandoned';
  attempt_count?: number;
  average_score?: number | null;
  started_at?: string;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type SpeechPracticeUpdate = Partial<SpeechPracticeInsert>;

/** `public.subscription_plans` */
export interface SubscriptionPlansRow {
  id: string;
  code: string;
  display_name: string;
  description: string;
  tier: 'free' | 'paid';
  price_minor: number;
  currency: string;
  billing_interval: 'month' | 'year' | 'once' | 'none';
  daily_minute_limit: number;
  child_profile_limit: number;
  weekly_story_limit: number | null;
  features: Json;
  available_rails: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlansInsert {
  id?: string;
  code: string;
  display_name: string;
  description?: string;
  tier: 'free' | 'paid';
  price_minor?: number;
  currency?: string;
  billing_interval?: 'month' | 'year' | 'once' | 'none';
  daily_minute_limit: number;
  child_profile_limit: number;
  weekly_story_limit?: number | null;
  features?: Json;
  available_rails?: string[];
  is_active?: boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export type SubscriptionPlansUpdate = Partial<SubscriptionPlansInsert>;

/** `public.subscriptions` */
export interface SubscriptionsRow {
  id: string;
  parent_id: string;
  plan_id: string;
  rail: 'stripe' | 'jazzcash' | 'easypaisa' | 'apple_iap' | 'google_play' | 'mock';
  status: 'free' | 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
  external_id: string | null;
  payment_method_token: string | null;
  payment_method_brand: 'visa' | 'mastercard' | 'amex' | 'unionpay' | 'wallet' | 'other' | null;
  payment_method_last4: string | null;
  currency: string;
  price_minor: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  cancelled_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionsInsert {
  id?: string;
  parent_id: string;
  plan_id: string;
  rail: 'stripe' | 'jazzcash' | 'easypaisa' | 'apple_iap' | 'google_play' | 'mock';
  status?: 'free' | 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
  external_id?: string | null;
  payment_method_token?: string | null;
  payment_method_brand?: 'visa' | 'mastercard' | 'amex' | 'unionpay' | 'wallet' | 'other' | null;
  payment_method_last4?: string | null;
  currency?: string;
  price_minor?: number;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at?: string | null;
  cancelled_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type SubscriptionsUpdate = Partial<SubscriptionsInsert>;

/** `public.supported_languages` */
export interface SupportedLanguagesRow {
  code: string;
  english_name: string;
  native_name: string;
  direction: 'ltr' | 'rtl';
  stt_supported: boolean;
  tts_supported: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tier: 'primary' | 'secondary' | 'regional';
}

export interface SupportedLanguagesInsert {
  code: string;
  english_name: string;
  native_name: string;
  direction?: 'ltr' | 'rtl';
  stt_supported?: boolean;
  tts_supported?: boolean;
  is_active?: boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  tier?: 'primary' | 'secondary' | 'regional';
}

export type SupportedLanguagesUpdate = Partial<SupportedLanguagesInsert>;

/** `public.transactions` */
export interface TransactionsRow {
  id: string;
  subscription_id: string;
  parent_id: string;
  rail: 'stripe' | 'jazzcash' | 'easypaisa' | 'apple_iap' | 'google_play' | 'mock';
  external_id: string;
  kind: 'charge' | 'credit';
  status: 'failed' | 'reversed';
  amount_minor: number;
  currency: string;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  failure_code: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

export interface TransactionsInsert {
  id?: string;
  subscription_id: string;
  parent_id: string;
  rail: 'stripe' | 'jazzcash' | 'easypaisa' | 'apple_iap' | 'google_play' | 'mock';
  external_id: string;
  kind: 'charge' | 'credit';
  status: 'failed' | 'reversed';
  amount_minor: number;
  currency: string;
  payment_method_brand?: string | null;
  payment_method_last4?: string | null;
  failure_code?: string | null;
  occurred_at: string;
  created_at?: string;
  updated_at?: string;
}

export type TransactionsUpdate = Partial<TransactionsInsert>;

/** Supabase-shaped schema map: `createClient<Database>(...)`. */
export interface Database {
  public: {
    Tables: {
      ai_characters: { Row: AiCharactersRow; Insert: AiCharactersInsert; Update: AiCharactersUpdate };
      analytics_events: { Row: AnalyticsEventsRow; Insert: AnalyticsEventsInsert; Update: AnalyticsEventsUpdate };
      audit_logs: { Row: AuditLogsRow; Insert: AuditLogsInsert; Update: AuditLogsUpdate };
      character_languages: { Row: CharacterLanguagesRow; Insert: CharacterLanguagesInsert; Update: CharacterLanguagesUpdate };
      child_languages: { Row: ChildLanguagesRow; Insert: ChildLanguagesInsert; Update: ChildLanguagesUpdate };
      child_learning_preferences: { Row: ChildLearningPreferencesRow; Insert: ChildLearningPreferencesInsert; Update: ChildLearningPreferencesUpdate };
      child_learning_topics: { Row: ChildLearningTopicsRow; Insert: ChildLearningTopicsInsert; Update: ChildLearningTopicsUpdate };
      children: { Row: ChildrenRow; Insert: ChildrenInsert; Update: ChildrenUpdate };
      consent_records: { Row: ConsentRecordsRow; Insert: ConsentRecordsInsert; Update: ConsentRecordsUpdate };
      consent_requirements: { Row: ConsentRequirementsRow; Insert: ConsentRequirementsInsert; Update: ConsentRequirementsUpdate };
      content_flags: { Row: ContentFlagsRow; Insert: ContentFlagsInsert; Update: ContentFlagsUpdate };
      conversations: { Row: ConversationsRow; Insert: ConversationsInsert; Update: ConversationsUpdate };
      email_verifications: { Row: EmailVerificationsRow; Insert: EmailVerificationsInsert; Update: EmailVerificationsUpdate };
      learning_events: { Row: LearningEventsRow; Insert: LearningEventsInsert; Update: LearningEventsUpdate };
      learning_progress: { Row: LearningProgressRow; Insert: LearningProgressInsert; Update: LearningProgressUpdate };
      learning_topics: { Row: LearningTopicsRow; Insert: LearningTopicsInsert; Update: LearningTopicsUpdate };
      login_attempts: { Row: LoginAttemptsRow; Insert: LoginAttemptsInsert; Update: LoginAttemptsUpdate };
      messages: { Row: MessagesRow; Insert: MessagesInsert; Update: MessagesUpdate };
      notifications: { Row: NotificationsRow; Insert: NotificationsInsert; Update: NotificationsUpdate };
      parental_controls: { Row: ParentalControlsRow; Insert: ParentalControlsInsert; Update: ParentalControlsUpdate };
      parents: { Row: ParentsRow; Insert: ParentsInsert; Update: ParentsUpdate };
      password_resets: { Row: PasswordResetsRow; Insert: PasswordResetsInsert; Update: PasswordResetsUpdate };
      payment_events: { Row: PaymentEventsRow; Insert: PaymentEventsInsert; Update: PaymentEventsUpdate };
      pronunciation_results: { Row: PronunciationResultsRow; Insert: PronunciationResultsInsert; Update: PronunciationResultsUpdate };
      sessions: { Row: SessionsRow; Insert: SessionsInsert; Update: SessionsUpdate };
      speech_practice: { Row: SpeechPracticeRow; Insert: SpeechPracticeInsert; Update: SpeechPracticeUpdate };
      subscription_plans: { Row: SubscriptionPlansRow; Insert: SubscriptionPlansInsert; Update: SubscriptionPlansUpdate };
      subscriptions: { Row: SubscriptionsRow; Insert: SubscriptionsInsert; Update: SubscriptionsUpdate };
      supported_languages: { Row: SupportedLanguagesRow; Insert: SupportedLanguagesInsert; Update: SupportedLanguagesUpdate };
      transactions: { Row: TransactionsRow; Insert: TransactionsInsert; Update: TransactionsUpdate };
    };
    Views: {
      current_consents: { Row: CurrentConsentsRow };
    };
  };
}
