export interface KduRule {
  id?: number;
  city: string;
  bg_size: number;
  max_sqm: number;
  max_bruttokalt_eur: number;
  extra_person_sqm: number;
  extra_person_eur: number;
  is_extrapolated?: boolean;
}

export interface ListingItem {
  id: string;
  external_id: string;
  portal: 'kleinanzeigen' | 'immowelt' | 'immoscout' | 'other';
  title: string;
  url: string;
  city: string;
  district: string | null;
  zipcode: string | null;
  cold_rent: number | null;
  additional_costs: number;
  heating_costs: number;
  calculated_bruttokalt: number;
  sqm: number | null;
  rooms: number | null;
  is_private_landlord: boolean;
  wbs_required: boolean;
  matched_min_bg_size: number | null;
  first_seen_at: string;
  last_seen_at: string;
  compliance_status: 'compliant' | 'produkttheorie' | 'tolerance';
  eigenanteil_eur: number;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  has_direct_contact?: boolean;
}

export type PortalKey =
  | 'kleinanzeigen'
  | 'immowelt'
  | 'ohne_makler'
  | 'ggw'
  | 'immoscout';

export interface PortalLinkEntry {
  linked: boolean;
  account_label: string;
  updated_at?: string | null;
}

export type PortalLinkMap = Record<PortalKey, PortalLinkEntry>;

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  preferred_city: string;
  bg_size: number;
  benefit_type: 'sgb2' | 'sgb12';
  move_in_date: string;
  personal_note: string;
  emphasize_direct_transfer: boolean;
  address_schufa_directly: boolean;
  linked_portals: PortalLinkMap;
  status: 'active' | 'blocked';
  account_type?: 'user' | 'organization';
  org_status?: 'none' | 'active' | 'expired' | 'revoked';
  org_name?: string;
  org_subtitle?: string;
  org_logo_url?: string;
  org_contact?: string;
  org_license_unlimited?: boolean;
  org_license_expires_at?: string | null;
  org_key_prefix?: string | null;
  last_login_at?: string | null;
  created_at?: string;
}

export type ApplicationStatus =
  | 'saved'
  | 'contacted'
  | 'viewing'
  | 'accepted'
  | 'rejected';

export interface UserApplication {
  id: string;
  listing_id: string;
  portal: string;
  application_status: ApplicationStatus;
  message_text: string | null;
  notes: string | null;
  contacted_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  url: string;
  city: string;
  district: string | null;
  zipcode: string | null;
  cold_rent: number | null;
  additional_costs: number;
  calculated_bruttokalt: number | null;
  sqm: number | null;
  rooms: number | null;
  is_private_landlord: boolean;
  wbs_required: boolean;
  listing_status: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
}

export type ReportReasonCode =
  | 'no_jobcenter'
  | 'wrong_description'
  | 'already_rented'
  | 'wrong_price'
  | 'spam_fraud'
  | 'other';

export interface HiddenListingItem {
  id: string;
  listing_id: string;
  created_at: string;
  title: string;
  url: string;
  portal: string;
  city: string;
  district: string | null;
  zipcode: string | null;
  calculated_bruttokalt: number | null;
  sqm: number | null;
  rooms: number | null;
  listing_status: string;
}

export interface HousingListResponse {
  organization: {
    name: string;
    subtitle: string;
    logo_url: string;
    contact: string;
    license_unlimited: boolean;
    license_expires_at: string | null;
  };
  filters: {
    city: string;
    bg_size: number;
    benefit_type: 'sgb2' | 'sgb12';
    private_only: boolean;
    include_tolerance: boolean;
    district: string;
    wbs: string;
    require_direct_contact: boolean;
    sort: string;
    search: string;
  };
  rule: KduRule | null;
  total: number;
  total_all: number;
  total_direct_contact: number;
  districts: string[];
  items: ListingItem[];
}

export interface ListingsResponse {
  city: string;
  bg_size: number;
  benefit_type: 'sgb2' | 'sgb12';
  rule: KduRule;
  tolerance_limit_eur: number;
  include_tolerance: boolean;
  total: number;
  private_count: number;
  strict_count: number;
  page: number;
  limit: number;
  districts: string[];
  items: ListingItem[];
}
