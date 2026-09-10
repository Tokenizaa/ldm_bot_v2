export interface Product {
  id: string;
  product_identity_key: string;
  product_name: string;
  brand?: string;
  category?: string;
  sku?: string;
  original_url: string;
  affiliate_url: string;
  current_price: number;
  previous_price?: number;
  lowest_price?: number;
  image_url?: string;
  active: boolean;
  last_scraped_at: string;
  created_at: string;
  updated_at: string;
}

export type PublicationStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface Publication {
  id: string;
  product_id: string;
  product?: Product;
  scheduled_at: string;
  status: PublicationStatus;
  content: string;
  facebook_group_url?: string;
  facebook_post_url?: string;
  published_at?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface PriceHistory {
  id: string;
  product_id: string;
  price: number;
  checked_at: string;
}

export interface AppSettings {
  facebook_group_url: string;
  daily_limit: number;
  monthly_limit: number;
  daily_hours: string[]; // e.g. ["08:00", "11:00", "14:00", "17:00", "20:00"]
  crawler_categories: string[];
  crawler_target_urls: string[];
  nvidia_model: string;
}

export interface OperationalQuota {
  current_month: string; // e.g. "2026-09"
  monthly_publication_count: number;
  monthly_limit: number;
  daily_publication_count: number;
  daily_limit: number;
  remaining_month: number;
  today_date: string;
}

export interface DashboardStats {
  products_found: number;
  products_valid: number;
  products_published: number;
  published_today: number;
  published_this_month: number;
  monthly_limit: number;
  daily_limit: number;
  remaining_month: number;
  failures: number;
  next_publication?: Publication;
}

export interface CrawlerRunResult {
  found: number;
  valid: number;
  new: number;
  updated: number;
}

export interface FacebookSessionStatus {
  connected: boolean;
  status: 'connected' | 'requires_reauth' | 'disconnected';
  last_authenticated_at?: string;
  configured_group_url?: string;
  group_accessible?: boolean;
  connected_user?: string;
  profile_dir: string;
  details?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  source: 'Crawler' | 'AI' | 'Scheduler' | 'Facebook' | 'Supabase' | 'Auth' | 'System';
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
}
