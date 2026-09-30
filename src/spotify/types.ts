export interface SpotifyTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface SpotifyProfile {
  account_id?: string;
  id?: string;
  display_name?: string | null;
}

export interface SpotifyPlaylistMetadata {
  id: string;
  name: string;
  description: string | null;
  snapshot_id: string;
  external_urls: { spotify?: string };
  images: Array<{ url: string; height?: number | null; width?: number | null }>;
  owner: { display_name?: string | null };
  items?: { total: number };
}

export interface SpotifyPlaylistItem {
  added_at: string | null;
  item: {
    uri: string;
    name: string;
    type: string;
    external_urls?: { spotify?: string };
    artists?: Array<{ name: string }>;
  } | null;
}

export interface SpotifyItemsPage {
  items: SpotifyPlaylistItem[];
  next: string | null;
  total: number;
}
